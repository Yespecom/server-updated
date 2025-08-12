const jwt = require("jsonwebtoken")
const User = require("../models/User")
const { getTenantDB } = require("../config/tenantDB")
const AuthUtils = require("../utils/auth")

const authMiddleware = async (req, res, next) => {
  try {
    console.log("🔐 Auth middleware started")

    const authHeader = req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ No valid authorization header")
      return res.status(401).json({
        error: "Access denied. No valid token provided.",
        code: "NO_TOKEN",
      })
    }

    const token = authHeader.replace("Bearer ", "")

    // Verify token
    let decoded
    try {
      decoded = AuthUtils.verifyToken(token)
      console.log("✅ Token verified:", { email: decoded.email, userId: decoded.userId })
    } catch (tokenError) {
      console.log("❌ Token verification failed:", tokenError.message)

      if (tokenError.message.includes("expired")) {
        return res.status(401).json({
          error: "Token has expired. Please login again.",
          code: "TOKEN_EXPIRED",
        })
      }

      return res.status(401).json({
        error: "Invalid token. Please login again.",
        code: "INVALID_TOKEN",
      })
    }

    // Validate token type
    if (decoded.type !== "admin") {
      console.log("❌ Invalid token type:", decoded.type)
      return res.status(401).json({
        error: "Invalid token type for admin access.",
        code: "INVALID_TOKEN_TYPE",
      })
    }

    // Get main user for tenant lookup
    const mainUser = await User.findOne({
      email: decoded.email,
      isActive: true,
    })

    if (!mainUser) {
      console.log("❌ Main user not found for email:", decoded.email)
      return res.status(401).json({
        error: "User not found or inactive.",
        code: "USER_NOT_FOUND",
      })
    }

    console.log("✅ Main user found:", {
      tenantId: mainUser.tenantId,
      storeId: mainUser.storeId,
    })

    // Check if password was changed after token was issued
    if (mainUser.passwordChangedAt && decoded.iat) {
      const passwordChangedTimestamp = Math.floor(mainUser.passwordChangedAt.getTime() / 1000)
      if (passwordChangedTimestamp > decoded.iat) {
        console.log("❌ Password changed after token was issued")
        return res.status(401).json({
          error: "Password was changed. Please login again.",
          code: "PASSWORD_CHANGED",
        })
      }
    }

    // Get tenant database connection
    let tenantDB
    try {
      console.log("🔍 Getting tenant database for:", mainUser.tenantId)
      tenantDB = await getTenantDB(mainUser.tenantId)

      if (!tenantDB) {
        console.error("❌ getTenantDB returned null/undefined")
        return res.status(500).json({
          error: "Database connection failed.",
          code: "DB_CONNECTION_FAILED",
        })
      }

      console.log("✅ Tenant DB connection successful:", {
        readyState: tenantDB.readyState,
        name: tenantDB.name,
      })
    } catch (dbError) {
      console.error("❌ Tenant DB connection error:", dbError)
      return res.status(500).json({
        error: "Database connection failed.",
        details: dbError.message,
        code: "DB_CONNECTION_ERROR",
      })
    }

    // Get tenant user data
    try {
      console.log("🔍 Loading tenant user model...")
      const TenantUser = require("../models/tenant/User")(tenantDB)

      console.log("🔍 Finding tenant user with ID:", decoded.userId)
      const tenantUser = await TenantUser.findById(decoded.userId)

      if (!tenantUser) {
        console.log("❌ Tenant user not found for ID:", decoded.userId)
        return res.status(401).json({
          error: "User data not found.",
          code: "TENANT_USER_NOT_FOUND",
        })
      }

      if (!tenantUser.isActive) {
        console.log("❌ Tenant user is inactive:", decoded.userId)
        return res.status(401).json({
          error: "User account is inactive.",
          code: "USER_INACTIVE",
        })
      }

      console.log("✅ Tenant user found:", tenantUser.email)

      // Set all required properties on req object
      req.user = AuthUtils.sanitizeUser(tenantUser)
      req.tenantId = mainUser.tenantId
      req.storeId = mainUser.storeId
      req.tenantDB = tenantDB
      req.authToken = token
      req.tokenPayload = decoded

      // Update last login time
      tenantUser.lastLoginAt = new Date()
      await tenantUser.save()

      console.log("✅ Auth middleware completed successfully")
      next()
    } catch (userError) {
      console.error("❌ Error loading tenant user:", userError)
      return res.status(500).json({
        error: "Failed to load user data.",
        details: userError.message,
        code: "USER_LOAD_ERROR",
      })
    }
  } catch (error) {
    console.error("❌ Auth middleware error:", error)
    res.status(500).json({
      error: "Authentication failed.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
      code: "AUTH_MIDDLEWARE_ERROR",
    })
  }
}

module.exports = authMiddleware
