const express = require("express")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")
const rateLimit = require("express-rate-limit")
const AuthUtils = require("../../utils/auth")
const router = express.Router({ mergeParams: true })

// Apply rate limiting to authentication endpoints
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: "Too many authentication attempts",
    code: "RATE_LIMIT_EXCEEDED",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

router.use(["/login", "/register"], authRateLimit)

// Enhanced logging middleware
router.use((req, res, next) => {
  console.log(`🔐 Store Auth: ${req.method} ${req.path}`)
  console.log(`🔐 Store ID: ${req.storeId}`)
  console.log(`🔐 Tenant ID: ${req.tenantId}`)
  console.log(`🔐 Client Info:`, AuthUtils.extractClientInfo(req))
  next()
})

// Test endpoint
router.get("/test", (req, res) => {
  res.json({
    message: "Store auth routes are working",
    storeId: req.storeId,
    tenantId: req.tenantId,
    storeName: req.storeInfo?.name || "Unknown Store",
    timestamp: new Date().toISOString(),
  })
})

// Enhanced customer registration with longer token expiration
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone, acceptTerms, rememberMe } = req.body

    console.log(`📝 Customer registration for store: ${req.storeId}, email: ${email}`)

    // Enhanced validation
    const errors = []

    if (!name || name.trim().length < 2) {
      errors.push("Name must be at least 2 characters long")
    }

    if (!email || !AuthUtils.validateEmail(email)) {
      errors.push("Valid email address is required")
    }

    const passwordValidation = AuthUtils.validatePassword(password)
    if (!passwordValidation.isValid) {
      errors.push(...passwordValidation.errors)
    }

    if (phone && !AuthUtils.validatePhone(phone)) {
      errors.push("Valid phone number is required")
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors,
        code: "VALIDATION_ERROR",
      })
    }

    if (!req.tenantDB) {
      console.error("❌ Tenant DB not initialized")
      return res.status(500).json({
        error: "Database not initialized",
        code: "DB_NOT_INITIALIZED",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)

    // Check for existing customer
    const existingCustomer = await Customer.findOne({
      $or: [{ email: email.toLowerCase() }, ...(phone ? [{ phone: phone }] : [])],
    })

    if (existingCustomer) {
      if (!existingCustomer.password) {
        return res.status(400).json({
          error: "An account with this email/phone exists but needs migration",
          code: "ACCOUNT_NEEDS_MIGRATION",
          canMigrate: true,
          migrationData: {
            email: existingCustomer.email,
            phone: existingCustomer.phone,
            name: existingCustomer.name,
          },
        })
      }

      return res.status(400).json({
        error: "An account with this email or phone already exists",
        code: "CUSTOMER_EXISTS",
        canLogin: true,
      })
    }

    // Create new customer
    const customer = new Customer({
      name: name.trim(),
      email: email.toLowerCase(),
      password: password, // Will be hashed by pre-save middleware
      phone: phone || "",
      totalSpent: 0,
      totalOrders: 0,
      isActive: true,
      isVerified: true, // Auto-verify for now
      emailVerified: true,
      phoneVerified: !!phone,
      preferences: {
        notifications: true,
        marketing: false,
        newsletter: true,
        smsUpdates: !!phone,
      },
    })

    await customer.save()
    console.log(`👤 New customer registered: ${email}`)

    // Generate JWT token with longer expiration
    const token = customer.generateAuthToken(req.storeId, req.tenantId, rememberMe)
    const tokenExpiry = AuthUtils.formatTokenExpiry(token)

    const response = {
      message: "Registration successful",
      token,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        totalSpent: customer.totalSpent,
        totalOrders: customer.totalOrders,
        isVerified: customer.isVerified,
        preferences: customer.preferences,
      },
      storeId: req.storeId,
      tenantId: req.tenantId,
      tokenInfo: tokenExpiry,
      expiresIn: rememberMe ? "365 days" : "90 days",
    }

    console.log("✅ Customer registration successful")
    res.status(201).json(response)
  } catch (error) {
    console.error("❌ Customer registration error:", error)

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0]
      return res.status(400).json({
        error: `An account with this ${field} already exists`,
        code: "DUPLICATE_FIELD",
        field,
      })
    }

    res.status(500).json({
      error: "Failed to register customer",
      details: error.message,
      code: "REGISTRATION_ERROR",
    })
  }
})

// Enhanced customer login with longer token expiration
router.post("/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body

    console.log(`🔐 Customer login attempt for store: ${req.storeId}`)
    console.log(`🔐 Email: ${email}, Remember Me: ${rememberMe}`)

    // Validation
    if (!email || !password) {
      console.log("❌ Missing credentials")
      return res.status(400).json({
        error: "Email and password are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    if (!AuthUtils.validateEmail(email)) {
      console.log("❌ Invalid email format")
      return res.status(400).json({
        error: "Please enter a valid email address",
        code: "INVALID_EMAIL",
      })
    }

    if (!req.tenantDB) {
      console.error("❌ Tenant DB not initialized")
      return res.status(500).json({
        error: "Database not initialized",
        code: "DB_NOT_INITIALIZED",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)

    // Use the enhanced authentication method
    const authResult = await Customer.authenticate(email, password, req.storeId, req.tenantId)

    if (!authResult.success) {
      return res.status(401).json({
        error: authResult.error,
        code: authResult.code,
        ...(authResult.lockUntil && { lockUntil: authResult.lockUntil }),
        ...(authResult.code === "NO_PASSWORD_SET" && { canMigrate: true }),
      })
    }

    const { customer } = authResult

    // Generate new token with longer expiration based on rememberMe
    const token = customer.generateAuthToken(req.storeId, req.tenantId, rememberMe)
    const tokenExpiry = AuthUtils.formatTokenExpiry(token)

    console.log(`✅ Customer authentication successful: ${email}`)

    const response = {
      message: "Login successful",
      token,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        totalSpent: customer.totalSpent,
        totalOrders: customer.totalOrders,
        lastOrderDate: customer.lastOrderDate,
        addresses: customer.addresses || [],
        preferences: customer.preferences || {},
        tier: customer.tier, // Virtual field from model
      },
      storeId: req.storeId,
      tenantId: req.tenantId,
      tokenInfo: tokenExpiry,
      expiresIn: rememberMe ? "365 days" : "90 days",
    }

    console.log("✅ Login response prepared successfully")
    res.json(response)
  } catch (error) {
    console.error("❌ Customer login error:", error)
    res.status(500).json({
      error: "Failed to login",
      details: error.message,
      code: "LOGIN_ERROR",
    })
  }
})

// Enhanced account migration
router.post("/migrate-account", async (req, res) => {
  try {
    const { email, phone, password, name, rememberMe } = req.body

    console.log(`🔄 Account migration for store: ${req.storeId}`)

    // Validation
    const passwordValidation = AuthUtils.validatePassword(password)
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: "Password validation failed",
        details: passwordValidation.errors,
        code: "INVALID_PASSWORD",
      })
    }

    if (!email && !phone) {
      return res.status(400).json({
        error: "Either email or phone is required for migration",
        code: "MISSING_IDENTIFIER",
      })
    }

    if (email && !AuthUtils.validateEmail(email)) {
      return res.status(400).json({
        error: "Valid email address is required",
        code: "INVALID_EMAIL",
      })
    }

    if (phone && !AuthUtils.validatePhone(phone)) {
      return res.status(400).json({
        error: "Valid phone number is required",
        code: "INVALID_PHONE",
      })
    }

    if (!req.tenantDB) {
      return res.status(500).json({
        error: "Database not initialized",
        code: "DB_NOT_INITIALIZED",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)

    // Find existing customer
    let customer = null
    if (email) {
      customer = await Customer.findOne({ email: email.toLowerCase() })
    } else if (phone) {
      customer = await Customer.findOne({ phone: phone })
    }

    if (!customer) {
      return res.status(404).json({
        error: "No existing account found with the provided email or phone number",
        code: "CUSTOMER_NOT_FOUND",
        canRegister: true,
      })
    }

    // Check if already migrated
    if (customer.password) {
      return res.status(400).json({
        error: "Account already has password authentication set up",
        code: "ALREADY_MIGRATED",
        canLogin: true,
      })
    }

    // Update customer
    customer.password = password // Will be hashed by pre-save middleware
    if (email && !customer.email) {
      customer.email = email.toLowerCase()
      customer.emailVerified = true
    }
    if (name && name.trim()) {
      customer.name = name.trim()
    }
    customer.passwordChangedAt = new Date()
    customer.isVerified = true

    await customer.save()
    console.log(`🔄 Account migrated successfully: ${customer.email || customer.phone}`)

    // Generate JWT token with longer expiration
    const token = customer.generateAuthToken(req.storeId, req.tenantId, rememberMe)
    const tokenExpiry = AuthUtils.formatTokenExpiry(token)

    const response = {
      message: "Account migrated successfully. You can now use email and password to login.",
      token,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        totalSpent: customer.totalSpent,
        totalOrders: customer.totalOrders,
        lastOrderDate: customer.lastOrderDate,
        isVerified: customer.isVerified,
      },
      storeId: req.storeId,
      tenantId: req.tenantId,
      tokenInfo: tokenExpiry,
      expiresIn: rememberMe ? "365 days" : "90 days",
    }

    res.json(response)
  } catch (error) {
    console.error("❌ Customer migration error:", error)
    res.status(500).json({
      error: "Failed to migrate account",
      details: error.message,
      code: "MIGRATION_ERROR",
    })
  }
})

// Customer authentication middleware with token refresh
const authenticateCustomer = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Access denied. Please login.",
        code: "NO_TOKEN",
      })
    }

    const token = authHeader.replace("Bearer ", "")
    let decoded

    try {
      decoded = AuthUtils.verifyToken(token)
    } catch (tokenError) {
      if (tokenError.name === "TokenExpiredError") {
        return res.status(401).json({
          error: "Session expired. Please login again.",
          code: "TOKEN_EXPIRED",
          expiredAt: tokenError.expiredAt,
        })
      }

      return res.status(401).json({
        error: "Invalid session. Please login again.",
        code: "TOKEN_INVALID",
      })
    }

    if (decoded.type !== "customer") {
      return res.status(401).json({
        error: "Invalid token type",
        code: "INVALID_TOKEN_TYPE",
      })
    }

    // Verify store context
    if (decoded.storeId !== req.storeId) {
      return res.status(401).json({
        error: "Access denied. Token is not valid for this store.",
        code: "INVALID_STORE_CONTEXT",
      })
    }

    if (!req.tenantDB) {
      return res.status(500).json({
        error: "Database not initialized",
        code: "DB_NOT_INITIALIZED",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    const customer = await Customer.findById(decoded.customerId)

    if (!customer) {
      return res.status(401).json({
        error: "Customer not found",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    if (!customer.isActive) {
      return res.status(401).json({
        error: "Account is deactivated",
        code: "ACCOUNT_DEACTIVATED",
      })
    }

    // Check if password was changed after token was issued
    if (customer.password && customer.passwordChangedAt && decoded.iat) {
      const passwordChangedTimestamp = Math.floor(customer.passwordChangedAt.getTime() / 1000)
      if (passwordChangedTimestamp > decoded.iat) {
        return res.status(401).json({
          error: "Password was changed. Please login again.",
          code: "PASSWORD_CHANGED",
        })
      }
    }

    // Check if token should be refreshed and add to response headers
    if (AuthUtils.shouldRefreshToken(token)) {
      const newToken = customer.generateAuthToken(req.storeId, req.tenantId, false)
      res.setHeader("X-New-Token", newToken)
      res.setHeader("X-Token-Refreshed", "true")
      console.log(`🔄 Token refreshed for customer: ${customer.email}`)
    }

    req.customer = customer
    req.customerId = customer._id
    req.authToken = token
    req.tokenPayload = decoded
    next()
  } catch (error) {
    console.error("❌ Customer auth middleware error:", error)
    res.status(500).json({
      error: "Authentication failed",
      code: "AUTH_ERROR",
    })
  }
}

// Get customer profile with token info
router.get("/profile", authenticateCustomer, async (req, res) => {
  try {
    const customer = req.customer
    const tokenExpiry = AuthUtils.formatTokenExpiry(req.authToken)

    res.json({
      message: "Profile retrieved successfully",
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        dateOfBirth: customer.dateOfBirth,
        gender: customer.gender,
        totalSpent: customer.totalSpent,
        totalOrders: customer.totalOrders,
        loyaltyPoints: customer.loyaltyPoints,
        tier: customer.tier, // Virtual field
        lastOrderDate: customer.lastOrderDate,
        addresses: customer.addresses || [],
        preferences: customer.preferences || {},
        isVerified: customer.isVerified,
        emailVerified: customer.emailVerified,
        phoneVerified: customer.phoneVerified,
        createdAt: customer.createdAt,
        lastLoginAt: customer.lastLoginAt,
      },
      tokenInfo: tokenExpiry,
    })
  } catch (error) {
    console.error("❌ Get profile error:", error)
    res.status(500).json({
      error: "Failed to get profile",
      details: error.message,
      code: "PROFILE_ERROR",
    })
  }
})

// Update customer profile
router.put("/profile", authenticateCustomer, async (req, res) => {
  try {
    const { name, phone, dateOfBirth, gender, preferences } = req.body
    const customer = req.customer

    // Validation
    if (name && name.trim().length < 2) {
      return res.status(400).json({
        error: "Name must be at least 2 characters long",
        code: "INVALID_NAME",
      })
    }

    if (phone && !AuthUtils.validatePhone(phone)) {
      return res.status(400).json({
        error: "Valid phone number is required",
        code: "INVALID_PHONE",
      })
    }

    if (dateOfBirth && new Date(dateOfBirth) > new Date()) {
      return res.status(400).json({
        error: "Date of birth cannot be in the future",
        code: "INVALID_DATE_OF_BIRTH",
      })
    }

    if (gender && !["male", "female", "other"].includes(gender)) {
      return res.status(400).json({
        error: "Gender must be male, female, or other",
        code: "INVALID_GENDER",
      })
    }

    // Update fields
    if (name) customer.name = name.trim()
    if (phone) customer.phone = phone
    if (dateOfBirth) customer.dateOfBirth = new Date(dateOfBirth)
    if (gender) customer.gender = gender
    if (preferences) customer.preferences = { ...customer.preferences, ...preferences }

    await customer.save()

    res.json({
      message: "Profile updated successfully",
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        dateOfBirth: customer.dateOfBirth,
        gender: customer.gender,
        preferences: customer.preferences,
      },
    })
  } catch (error) {
    console.error("❌ Update profile error:", error)
    res.status(500).json({
      error: "Failed to update profile",
      details: error.message,
      code: "PROFILE_UPDATE_ERROR",
    })
  }
})

// Change password
router.put("/change-password", authenticateCustomer, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const customer = req.customer

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Current password and new password are required",
        code: "MISSING_PASSWORDS",
      })
    }

    // Validate new password
    const passwordValidation = AuthUtils.validatePassword(newPassword)
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: "New password validation failed",
        details: passwordValidation.errors,
        code: "INVALID_NEW_PASSWORD",
      })
    }

    // Verify current password
    const isCurrentPasswordValid = await customer.comparePassword(currentPassword)
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        error: "Current password is incorrect",
        code: "INCORRECT_CURRENT_PASSWORD",
      })
    }

    // Update password
    customer.password = newPassword // Will be hashed by pre-save middleware
    customer.passwordChangedAt = new Date()
    await customer.save()

    console.log(`🔐 Password changed for customer: ${customer.email}`)

    res.json({
      message: "Password changed successfully. Please login again with your new password.",
      action: "LOGIN_REQUIRED",
    })
  } catch (error) {
    console.error("❌ Change password error:", error)
    res.status(500).json({
      error: "Failed to change password",
      details: error.message,
      code: "PASSWORD_CHANGE_ERROR",
    })
  }
})

// Verify token with detailed info
router.get("/verify-token", authenticateCustomer, async (req, res) => {
  try {
    const customer = req.customer
    const tokenExpiry = AuthUtils.formatTokenExpiry(req.authToken)

    res.json({
      valid: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        totalSpent: customer.totalSpent,
        totalOrders: customer.totalOrders,
        tier: customer.tier,
      },
      tokenInfo: tokenExpiry,
    })
  } catch (error) {
    console.error("❌ Token verification error:", error)
    res.status(500).json({
      error: "Token verification failed",
      details: error.message,
      code: "TOKEN_VERIFICATION_ERROR",
    })
  }
})

// Logout
router.post("/logout", authenticateCustomer, async (req, res) => {
  try {
    // In a production app, you'd add the token to a blacklist
    console.log(`🚪 Customer logged out: ${req.customer.email}`)

    res.json({
      message: "Logged out successfully",
      action: "Please remove the token from your client storage",
    })
  } catch (error) {
    console.error("❌ Logout error:", error)
    res.status(500).json({
      error: "Failed to logout",
      details: error.message,
      code: "LOGOUT_ERROR",
    })
  }
})

// Address management endpoints
router.get("/addresses", authenticateCustomer, async (req, res) => {
  try {
    const customer = req.customer
    res.json({
      message: "Addresses retrieved successfully",
      addresses: customer.addresses || [],
      count: customer.addresses ? customer.addresses.length : 0,
    })
  } catch (error) {
    console.error("❌ Get addresses error:", error)
    res.status(500).json({
      error: "Failed to get addresses",
      details: error.message,
      code: "GET_ADDRESSES_ERROR",
    })
  }
})

router.post("/addresses", authenticateCustomer, async (req, res) => {
  try {
    const { type, name, phone, street, city, state, zipCode, country, isDefault } = req.body
    const customer = req.customer

    // Validation
    if (!name || !street || !city || !state || !zipCode) {
      return res.status(400).json({
        error: "Name, street, city, state, and zip code are required",
        code: "MISSING_ADDRESS_FIELDS",
      })
    }

    if (!/^\d{5,6}$/.test(zipCode)) {
      return res.status(400).json({
        error: "Zip code must be 5-6 digits",
        code: "INVALID_ZIP_CODE",
      })
    }

    const addressData = {
      type: type || "home",
      name: name.trim(),
      phone: phone || customer.phone || "",
      street: street.trim(),
      city: city.trim(),
      state: state.trim(),
      zipCode: zipCode.trim(),
      country: country || "India",
      isDefault: isDefault || false,
    }

    await customer.addAddress(addressData)
    const newAddress = customer.addresses[customer.addresses.length - 1]

    res.status(201).json({
      message: "Address added successfully",
      address: newAddress,
      count: customer.addresses.length,
    })
  } catch (error) {
    console.error("❌ Add address error:", error)
    res.status(500).json({
      error: "Failed to add address",
      details: error.message,
      code: "ADD_ADDRESS_ERROR",
    })
  }
})

router.put("/addresses/:addressId", authenticateCustomer, async (req, res) => {
  try {
    const { addressId } = req.params
    const { type, name, phone, street, city, state, zipCode, country, isDefault } = req.body
    const customer = req.customer

    if (!name || !street || !city || !state || !zipCode) {
      return res.status(400).json({
        error: "Name, street, city, state, and zip code are required",
        code: "MISSING_ADDRESS_FIELDS",
      })
    }

    if (!/^\d{5,6}$/.test(zipCode)) {
      return res.status(400).json({
        error: "Zip code must be 5-6 digits",
        code: "INVALID_ZIP_CODE",
      })
    }

    const updateData = {
      type: type || "home",
      name: name.trim(),
      phone: phone || customer.phone || "",
      street: street.trim(),
      city: city.trim(),
      state: state.trim(),
      zipCode: zipCode.trim(),
      country: country || "India",
      isDefault: isDefault || false,
    }

    const result = await customer.updateAddress(addressId, updateData)
    if (!result) {
      return res.status(404).json({
        error: "Address not found",
        code: "ADDRESS_NOT_FOUND",
      })
    }

    const updatedAddress = customer.addresses.id(addressId)
    res.json({
      message: "Address updated successfully",
      address: updatedAddress,
    })
  } catch (error) {
    console.error("❌ Update address error:", error)
    res.status(500).json({
      error: "Failed to update address",
      details: error.message,
      code: "UPDATE_ADDRESS_ERROR",
    })
  }
})

router.delete("/addresses/:addressId", authenticateCustomer, async (req, res) => {
  try {
    const { addressId } = req.params
    const customer = req.customer

    if (customer.addresses.length <= 1) {
      return res.status(400).json({
        error: "Cannot delete the only address. Please add another address first.",
        code: "CANNOT_DELETE_ONLY_ADDRESS",
      })
    }

    const result = await customer.removeAddress(addressId)
    if (!result) {
      return res.status(404).json({
        error: "Address not found",
        code: "ADDRESS_NOT_FOUND",
      })
    }

    res.json({
      message: "Address deleted successfully",
      count: customer.addresses.length,
    })
  } catch (error) {
    console.error("❌ Delete address error:", error)
    res.status(500).json({
      error: "Failed to delete address",
      details: error.message,
      code: "DELETE_ADDRESS_ERROR",
    })
  }
})

// Forgot password (initiate)
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body

    if (!email || !AuthUtils.validateEmail(email)) {
      return res.status(400).json({
        error: "Valid email address is required",
        code: "INVALID_EMAIL",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    const customer = await Customer.findOne({ email: email.toLowerCase() })

    // Always return success for security (don't reveal if email exists)
    const successResponse = {
      message: "If an account with this email exists, a password reset link has been sent.",
      email,
    }

    if (!customer) {
      console.log(`❌ Customer not found for password reset: ${email}`)
      return res.json(successResponse)
    }

    // Generate password reset token
    const resetToken = customer.createPasswordResetToken()
    await customer.save()

    // In a real app, you'd send an email with the reset link
    console.log(`🔐 Password reset token generated for ${email}: ${resetToken}`)

    res.json(successResponse)
  } catch (error) {
    console.error("❌ Forgot password error:", error)
    res.status(500).json({
      error: "Failed to process password reset request",
      details: error.message,
      code: "FORGOT_PASSWORD_ERROR",
    })
  }
})

// Reset password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body

    if (!token || !newPassword) {
      return res.status(400).json({
        error: "Reset token and new password are required",
        code: "MISSING_FIELDS",
      })
    }

    // Validate new password
    const passwordValidation = AuthUtils.validatePassword(newPassword)
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: "Password validation failed",
        details: passwordValidation.errors,
        code: "INVALID_PASSWORD",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    const customer = await Customer.findByPasswordResetToken(token)

    if (!customer) {
      return res.status(400).json({
        error: "Invalid or expired reset token",
        code: "INVALID_RESET_TOKEN",
      })
    }

    // Update password
    customer.password = newPassword
    customer.passwordResetToken = undefined
    customer.passwordResetExpires = undefined
    customer.passwordChangedAt = new Date()
    await customer.save()

    console.log(`✅ Password reset completed for: ${customer.email}`)

    res.json({
      message: "Password reset successfully. You can now login with your new password.",
      success: true,
    })
  } catch (error) {
    console.error("❌ Reset password error:", error)
    res.status(500).json({
      error: "Failed to reset password",
      details: error.message,
      code: "RESET_PASSWORD_ERROR",
    })
  }
})

// Refresh token endpoint
router.post("/refresh-token", authenticateCustomer, async (req, res) => {
  try {
    const customer = req.customer
    const { rememberMe } = req.body

    // Generate new token
    const newToken = customer.generateAuthToken(req.storeId, req.tenantId, rememberMe)
    const tokenExpiry = AuthUtils.formatTokenExpiry(newToken)

    console.log(`🔄 Token refreshed for customer: ${customer.email}`)

    res.json({
      message: "Token refreshed successfully",
      token: newToken,
      tokenInfo: tokenExpiry,
      expiresIn: rememberMe ? "365 days" : "90 days",
    })
  } catch (error) {
    console.error("❌ Token refresh error:", error)
    res.status(500).json({
      error: "Failed to refresh token",
      details: error.message,
      code: "TOKEN_REFRESH_ERROR",
    })
  }
})

module.exports = router
