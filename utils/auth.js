const jwt = require("jsonwebtoken")
const rateLimit = require("express-rate-limit")

class AuthUtils {
  // JWT Secret (should be in environment variables)
  static JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-this-in-production"

  // Generate JWT token with longer expiration
  static generateToken(payload, expiresIn = "90d") {
    // Increased from 7d to 90d
    try {
      const token = jwt.sign(payload, this.JWT_SECRET, {
        expiresIn,
        issuer: "yesp-platform",
        audience: "yesp-users",
      })
      console.log(
        `🔑 Token generated for user: ${payload.email || payload.phone || "unknown"} - Expires in: ${expiresIn}`,
      )
      return token
    } catch (error) {
      console.error("❌ Token generation error:", error)
      throw new Error("Token generation failed")
    }
  }

  // Generate long-term token for "Remember Me" functionality
  static generateLongTermToken(payload) {
    return this.generateToken(payload, "365d") // 1 year for remember me
  }

  // Generate short-term token for sensitive operations
  static generateShortTermToken(payload) {
    return this.generateToken(payload, "1h") // 1 hour for sensitive operations
  }

  // Rate limiting for OTP endpoints
  static otpRateLimit = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    message: {
      error: "Too many OTP requests",
      code: "OTP_RATE_LIMIT",
      retryAfter: "10 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.log(`🚫 OTP rate limit exceeded for IP: ${req.ip}`)
      res.status(429).json({
        error: "Too many OTP requests",
        code: "OTP_RATE_LIMIT",
        retryAfter: "10 minutes",
      })
    },
  })

  // Verify JWT token with better error handling
  static verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET, {
        issuer: "yesp-platform",
        audience: "yesp-users",
      })

      // Check if token is close to expiry (within 7 days)
      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = decoded.exp - now
      const daysUntilExpiry = timeUntilExpiry / (24 * 60 * 60)

      if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
        console.log(
          `⚠️ Token expires in ${Math.floor(daysUntilExpiry)} days for user: ${decoded.email || decoded.phone || "unknown"}`,
        )
      }

      return decoded
    } catch (error) {
      console.error("❌ Token verification error:", error.message)

      if (error.name === "TokenExpiredError") {
        const expiredError = new Error("Token has expired")
        expiredError.name = "TokenExpiredError"
        expiredError.expiredAt = error.expiredAt
        throw expiredError
      } else if (error.name === "JsonWebTokenError") {
        throw new Error("Invalid token")
      } else if (error.name === "NotBeforeError") {
        throw new Error("Token not active yet")
      }

      throw new Error("Token verification failed")
    }
  }

  // Get token expiry with better formatting
  static getTokenExpiry(token) {
    try {
      const decoded = jwt.decode(token)
      if (!decoded || !decoded.exp) return null

      const expiryDate = new Date(decoded.exp * 1000)
      console.log(`🕒 Token expires at: ${expiryDate.toISOString()}`)
      return expiryDate
    } catch (error) {
      console.error("❌ Token decode error:", error)
      return null
    }
  }

  // Check if token is expired with grace period
  static isTokenExpired(token, gracePeriodMinutes = 5) {
    try {
      const expiry = this.getTokenExpiry(token)
      if (!expiry) return true

      const now = new Date()
      const gracePeriod = gracePeriodMinutes * 60 * 1000 // Convert to milliseconds
      const expiryWithGrace = new Date(expiry.getTime() + gracePeriod)

      const isExpired = expiryWithGrace < now
      if (isExpired) {
        console.log(`⏰ Token expired at: ${expiry.toISOString()}, Current time: ${now.toISOString()}`)
      }

      return isExpired
    } catch (error) {
      console.error("❌ Token expiry check error:", error)
      return true
    }
  }

  // Check if token needs refresh (within 7 days of expiry)
  static shouldRefreshToken(token) {
    try {
      const expiry = this.getTokenExpiry(token)
      if (!expiry) return true

      const now = new Date()
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      return expiry < sevenDaysFromNow
    } catch (error) {
      return true
    }
  }

  // Refresh token if needed
  static refreshTokenIfNeeded(token, payload) {
    try {
      if (this.shouldRefreshToken(token)) {
        console.log(`🔄 Refreshing token for user: ${payload.email || payload.phone || "unknown"}`)
        return this.generateToken(payload)
      }
      return token
    } catch (error) {
      console.error("❌ Token refresh error:", error)
      return this.generateToken(payload)
    }
  }

  // Sanitize user data for response
  static sanitizeUser(user) {
    if (!user) return null

    const sanitized = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      hasStore: user.hasStore,
      storeInfo: user.storeInfo,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      permissions: user.permissions,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }

    // Remove undefined fields
    Object.keys(sanitized).forEach((key) => {
      if (sanitized[key] === undefined) {
        delete sanitized[key]
      }
    })

    return sanitized
  }

  // Email validation
  static validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  // Phone validation
  static validatePhone(phone) {
    // Basic phone validation - adjust regex as needed
    const phoneRegex = /^[+]?[1-9][\d]{0,15}$/
    return phoneRegex.test(phone.replace(/[\s\-()]/g, ""))
  }

  // Password validation
  static validatePassword(password) {
    const errors = []

    if (!password) {
      errors.push("Password is required")
      return { isValid: false, errors }
    }

    if (password.length < 8) {
      errors.push("Password must be at least 8 characters long")
    }

    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter")
    }

    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter")
    }

    if (!/\d/.test(password)) {
      errors.push("Password must contain at least one number")
    }

    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push("Password must contain at least one special character")
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  // Extract client info from request
  static extractClientInfo(req) {
    return {
      ip: req.ip || req.connection.remoteAddress || req.socket.remoteAddress || "unknown",
      userAgent: req.get("User-Agent") || "unknown",
      timestamp: new Date(),
    }
  }

  // Rate limiting for authentication endpoints
  static authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: {
      error: "Too many authentication attempts",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: "15 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.log(`🚫 Rate limit exceeded for IP: ${req.ip}`)
      res.status(429).json({
        error: "Too many authentication attempts",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: "15 minutes",
      })
    },
  })

  // Rate limiting for password reset endpoints
  static passwordResetRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 password reset requests per hour
    message: {
      error: "Too many password reset attempts",
      code: "PASSWORD_RESET_RATE_LIMIT",
      retryAfter: "1 hour",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.log(`🚫 Password reset rate limit exceeded for IP: ${req.ip}`)
      res.status(429).json({
        error: "Too many password reset attempts",
        code: "PASSWORD_RESET_RATE_LIMIT",
        retryAfter: "1 hour",
      })
    },
  })

  // Generate secure random string
  static generateSecureRandom(length = 32) {
    const crypto = require("crypto")
    return crypto.randomBytes(length).toString("hex")
  }

  // Hash sensitive data (for logging purposes)
  static hashForLogging(data) {
    const crypto = require("crypto")
    return crypto.createHash("sha256").update(data).digest("hex").substring(0, 8)
  }

  // Validate tenant ID format
  static validateTenantId(tenantId) {
    const tenantRegex = /^tenant_\d+_[a-z0-9]{6}$/
    return tenantRegex.test(tenantId)
  }

  // Validate store ID format
  static validateStoreId(storeId) {
    const storeRegex = /^[A-Z0-9]{6}$/
    return storeRegex.test(storeId)
  }

  // Generate pagination metadata
  static generatePaginationMeta(page, limit, total) {
    const totalPages = Math.ceil(total / limit)
    const hasNext = page < totalPages
    const hasPrev = page > 1

    return {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: limit,
      hasNext,
      hasPrev,
      nextPage: hasNext ? page + 1 : null,
      prevPage: hasPrev ? page - 1 : null,
    }
  }

  // Format error response
  static formatErrorResponse(error, code = "INTERNAL_ERROR") {
    return {
      error: error.message || "An error occurred",
      code,
      timestamp: new Date().toISOString(),
    }
  }

  // Log security event
  static logSecurityEvent(event, details = {}) {
    console.log(`🔒 SECURITY EVENT: ${event}`, {
      timestamp: new Date().toISOString(),
      ...details,
    })
  }

  // Format token expiry for response
  static formatTokenExpiry(token) {
    const expiry = this.getTokenExpiry(token)
    if (!expiry) return null

    const now = new Date()
    const timeUntilExpiry = expiry.getTime() - now.getTime()
    const daysUntilExpiry = Math.floor(timeUntilExpiry / (24 * 60 * 60 * 1000))
    const hoursUntilExpiry = Math.floor((timeUntilExpiry % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))

    return {
      expiresAt: expiry.toISOString(),
      expiresIn: timeUntilExpiry > 0 ? `${daysUntilExpiry}d ${hoursUntilExpiry}h` : "expired",
      isExpired: timeUntilExpiry <= 0,
      shouldRefresh: this.shouldRefreshToken(token),
    }
  }
}

module.exports = AuthUtils
