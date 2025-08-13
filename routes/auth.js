const express = require("express")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")
const User = require("../models/User")
const PendingRegistration = require("../models/PendingRegistration")
const OTP = require("../models/OTP")
const { getTenantDB } = require("../config/tenantDB")
const { sendOTPEmail, sendWelcomeEmail } = require("../config/email")
const AuthUtils = require("../utils/auth")
const router = express.Router()
const { recaptchaMiddleware } = require("../middleware/recaptcha")

// Cache for tenant models to prevent recompilation
const tenantModels = {}

// Helper function to get tenant models safely
const getTenantModels = async (tenantId) => {
  if (tenantModels[tenantId]) {
    console.log(`♻️ Reusing cached models for tenant: ${tenantId}`)
    return tenantModels[tenantId]
  }

  console.log(`🔧 Creating new models for tenant: ${tenantId}`)
  const tenantDB = await getTenantDB(tenantId)

  const models = {
    User: require("../models/tenant/User")(tenantDB),
    Product: require("../models/tenant/Product")(tenantDB),
    Order: require("../models/tenant/Order")(tenantDB),
    Category: require("../models/tenant/Category")(tenantDB),
    Customer: require("../models/tenant/Customer")(tenantDB),
    Offer: require("../models/tenant/Offer")(tenantDB),
    Payment: require("../models/tenant/Payment")(tenantDB),
    Settings: require("../models/tenant/Settings")(tenantDB),
  }

  tenantModels[tenantId] = models
  console.log(`✅ Models cached for tenant: ${tenantId}`)
  return models
}

// Apply rate limiting to sensitive endpoints
router.use(["/login", "/register/initiate", "/register/complete"], AuthUtils.authRateLimit)
router.use(["/forgot-password", "/reset-password"], AuthUtils.passwordResetRateLimit)

// Enhanced logging middleware
router.use((req, res, next) => {
  console.log(`📍 AUTH ROUTE: ${req.method} ${req.path}`)
  console.log(`🔍 Client Info:`, AuthUtils.extractClientInfo(req))

  if (req.method === "POST" && req.body) {
    console.log(`📦 Request Body:`, {
      ...req.body,
      password: req.body.password ? "[HIDDEN]" : undefined,
    })
  }
  next()
})

// Helper functions
const generateStoreId = async () => {
  let storeId
  let isUnique = false
  while (!isUnique) {
    storeId = Math.random().toString(36).substring(2, 8).toUpperCase()
    const existingUser = await User.findOne({ storeId: storeId })
    if (!existingUser) {
      isUnique = true
    }
  }
  return storeId
}

const generateTenantId = () => {
  return `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

// DEBUG ENDPOINT - Check what's in the database
router.get("/debug/user/:email", async (req, res) => {
  try {
    const { email } = req.params
    console.log(`🔍 DEBUG: Looking for user: ${email}`)

    const user = await User.findOne({ email: email.toLowerCase() })

    if (!user) {
      console.log(`❌ DEBUG: User not found: ${email}`)
      return res.json({
        found: false,
        message: "User not found in database",
      })
    }

    console.log(`✅ DEBUG: User found: ${email}`)

    res.json({
      found: true,
      user: {
        email: user.email,
        tenantId: user.tenantId,
        storeId: user.storeId,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        passwordHash: user.password.substring(0, 30) + "...",
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    })
  } catch (error) {
    console.error("❌ DEBUG error:", error)
    res.status(500).json({
      error: "Debug failed",
      details: error.message,
    })
  }
})

// DEBUG ENDPOINT - Check OTP status
router.get("/debug/otp/:email/:purpose", async (req, res) => {
  try {
    const { email, purpose } = req.params
    console.log(`🔍 DEBUG: Checking OTP for ${email} (${purpose})`)

    const otpStatus = await OTP.getCurrentOTP(email, purpose)

    if (!otpStatus) {
      return res.json({
        found: false,
        message: "No OTP found for this email and purpose",
      })
    }

    res.json({
      found: true,
      otp: otpStatus.otp,
      expiresAt: otpStatus.expiresAt,
      attempts: otpStatus.attempts,
      createdAt: otpStatus.createdAt,
      isExpired: otpStatus.expiresAt < new Date(),
    })
  } catch (error) {
    console.error("❌ DEBUG OTP error:", error)
    res.status(500).json({
      error: "OTP debug failed",
      details: error.message,
    })
  }
})

// DEBUG ENDPOINT - Test password comparison
router.post("/debug/password-test", async (req, res) => {
  try {
    const { email, password } = req.body
    console.log(`🔍 DEBUG: Testing password for: ${email}`)

    const user = await User.findOne({ email: email.toLowerCase() })

    if (!user) {
      return res.json({
        found: false,
        message: "User not found",
      })
    }

    console.log(`🔍 DEBUG: Found user, testing password...`)
    console.log(`🔍 DEBUG: Provided password: "${password}"`)
    console.log(`🔍 DEBUG: Stored hash: ${user.password.substring(0, 30)}...`)

    const isMatch = await bcrypt.compare(password, user.password)
    console.log(`🔑 DEBUG: Password match result: ${isMatch}`)

    res.json({
      found: true,
      passwordMatch: isMatch,
      providedPassword: password,
      storedHashPreview: user.password.substring(0, 30) + "...",
    })
  } catch (error) {
    console.error("❌ DEBUG password test error:", error)
    res.status(500).json({
      error: "Password test failed",
      details: error.message,
    })
  }
})

// Step 1: Initiate Registration (Send OTP) - with reCAPTCHA
router.post("/register/initiate", recaptchaMiddleware.v3.register, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body
    console.log(`📝 Initiate registration request for: ${email}`)

    // Log reCAPTCHA result
    if (req.recaptcha) {
      console.log(`🔒 reCAPTCHA result:`, {
        success: req.recaptcha.success,
        score: req.recaptcha.score,
        action: req.recaptcha.action,
        skipped: req.recaptcha.skipped,
      })
    }

    // Enhanced validation
    const errors = []

    if (!name || name.trim().length < 2) {
      errors.push("Name must be at least 2 characters long")
    }

    if (!email || !AuthUtils.validateEmail(email)) {
      errors.push("Please enter a valid email address")
    }

    const passwordValidation = AuthUtils.validatePassword(password)
    if (!passwordValidation.isValid) {
      errors.push(...passwordValidation.errors)
    }

    if (phone && !AuthUtils.validatePhone(phone)) {
      errors.push("Please enter a valid phone number")
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors,
        code: "VALIDATION_ERROR",
      })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() })
    if (existingUser) {
      return res.status(400).json({
        error: "User already exists with this email",
        code: "USER_EXISTS",
      })
    }

    // Clean up any existing pending registration and OTPs
    await PendingRegistration.deleteOne({ email: email.toLowerCase() })
    await OTP.deleteMany({ email: email.toLowerCase(), purpose: "registration" })

    // Create new pending registration with PLAIN TEXT password (NO HASHING)
    const pendingRegistration = new PendingRegistration({
      name: name.trim(),
      email: email.toLowerCase(),
      phone: phone || "",
      password: password, // Store PLAIN TEXT - will be hashed only when creating final User records
    })
    await pendingRegistration.save()
    console.log(`⏳ Pending registration created for: ${email} (password stored as plain text)`)

    // Generate and send OTP
    const otp = await OTP.createOTP(email, "registration", AuthUtils.extractClientInfo(req))
    await sendOTPEmail(email, otp, "registration")
    console.log(`🔢 Generated and sent OTP for ${email}: ${otp}`)

    res.json({
      message: "OTP sent successfully to your email. Please verify to complete registration.",
      email,
      expiresIn: "10 minutes",
      debug: {
        otpSent: otp, // Remove this in production
      },
    })
  } catch (error) {
    console.error("❌ Initiate registration error:", error)
    res.status(500).json({
      error: "Registration initiation failed",
      details: error.message,
      code: "REGISTRATION_ERROR",
    })
  }
})

// Step 2: Complete Registration (Verify OTP and Create User)
router.post("/register/complete", async (req, res) => {
  try {
    const { email, otp } = req.body
    console.log(`✅ Complete registration request for: ${email}`)

    if (!email || !otp) {
      return res.status(400).json({
        error: "Email and OTP are required",
        code: "MISSING_FIELDS",
      })
    }

    // Check if OTP exists first (for debugging)
    const otpStatus = await OTP.getCurrentOTP(email, "registration")
    console.log(`🔍 Current OTP status for ${email}:`, otpStatus)

    if (!otpStatus) {
      return res.status(400).json({
        error: "No OTP found. Please request a new OTP by initiating registration again.",
        code: "NO_OTP_FOUND",
      })
    }

    // Verify OTP
    const otpVerification = await OTP.verifyOTP(email, otp, "registration")
    if (!otpVerification.success) {
      return res.status(400).json({
        error: otpVerification.message,
        code: otpVerification.code,
      })
    }

    // Retrieve pending registration details
    const pendingRegistration = await PendingRegistration.findOne({ email: email.toLowerCase() })
    if (!pendingRegistration) {
      return res.status(400).json({
        error: "No pending registration found or it has expired. Please initiate registration again.",
        code: "NO_PENDING_REGISTRATION",
      })
    }

    // Double check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() })
    if (existingUser) {
      await PendingRegistration.deleteOne({ email: email.toLowerCase() })
      return res.status(400).json({
        error: "User already exists with this email",
        code: "USER_EXISTS",
      })
    }

    const { name, phone, password: plainTextPassword } = pendingRegistration
    console.log(`🔍 Retrieved plain text password from pending registration for: ${email}`)

    // Generate tenant ID
    const tenantId = generateTenantId()
    console.log(`🏗️ Creating tenant: ${tenantId} for user: ${email}`)

    try {
      // Get tenant models (this handles DB connection and model compilation)
      const models = await getTenantModels(tenantId)
      console.log(`✅ Tenant models ready: ${tenantId}`)

      // Create user in tenant DB with PLAIN TEXT password (will be hashed by pre-save middleware)
      const tenantUser = new models.User({
        name,
        email: email.toLowerCase(),
        phone,
        password: plainTextPassword, // Plain text - will be hashed by pre-save middleware
        role: "owner",
        hasStore: false,
        emailVerified: true,
      })

      await tenantUser.save()
      console.log(`👤 Tenant user created with hashed password: ${email}`)

      // Create user in main DB with PLAIN TEXT password (will be hashed by pre-save middleware)
      const mainUser = new User({
        email: email.toLowerCase(),
        password: plainTextPassword, // Plain text - will be hashed by pre-save middleware
        tenantId,
        emailVerified: true, // Email is verified through OTP
      })

      await mainUser.save()
      console.log(`🔑 Main user created with hashed password: ${email}`)

      // Create default settings
      const defaultSettings = new models.Settings({
        general: {
          storeName: "",
          logo: "",
          banner: "",
          tagline: "Welcome to our store",
          supportEmail: email,
          supportPhone: phone,
        },
        payment: {
          codEnabled: true,
        },
        social: {
          instagram: "",
          whatsapp: phone,
          facebook: "",
        },
        shipping: {
          deliveryTime: "2-3 business days",
          charges: 50,
          freeShippingAbove: 500,
        },
      })
      await defaultSettings.save()
      console.log(`⚙️ Default settings created for tenant: ${tenantId}`)

      // Create default category
      const defaultCategory = new models.Category({
        name: "General",
        description: "General products category",
        isActive: true,
      })
      await defaultCategory.save()
      console.log(`🗂️ Default category created for tenant: ${tenantId}`)

      // Send welcome email
      try {
        await sendWelcomeEmail(email, name)
      } catch (emailError) {
        console.error("❌ Welcome email failed:", emailError)
        // Don't fail registration if email fails
      }

      // Delete the pending registration record
      await PendingRegistration.deleteOne({ email: email.toLowerCase() })
      console.log(`🗑️ Pending registration deleted for: ${email}`)

      // Generate JWT with tenant info
      const token = AuthUtils.generateToken({
        userId: tenantUser._id,
        tenantId: tenantId,
        email: email,
        type: "admin",
      })

      res.status(201).json({
        message: "User registered successfully",
        token,
        tenantId,
        user: AuthUtils.sanitizeUser(tenantUser),
        status: "no_store",
      })
    } catch (dbError) {
      console.error(`❌ Tenant setup error for ${tenantId}:`, dbError)
      throw new Error(`Failed to setup tenant: ${dbError.message}`)
    }
  } catch (error) {
    console.error("❌ Complete registration error:", error)
    res.status(500).json({
      error: "Registration completion failed",
      details: error.message,
      code: "REGISTRATION_COMPLETION_ERROR",
    })
  }
})

// DIRECT LOGIN - Check Main DB then Connect to Tenant DB - with reCAPTCHA
router.post("/login", recaptchaMiddleware.v3.login, async (req, res) => {
  try {
    console.log("🔐 DIRECT LOGIN attempt started")

    const { email, password, rememberMe } = req.body

    // Log reCAPTCHA result
    if (req.recaptcha) {
      console.log(`🔒 reCAPTCHA result:`, {
        success: req.recaptcha.success,
        score: req.recaptcha.score,
        action: req.recaptcha.action,
        skipped: req.recaptcha.skipped,
      })
    }

    // Validate input
    if (!email || !password) {
      console.log("❌ Missing email or password")
      return res.status(400).json({
        error: "Email and password are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    if (!AuthUtils.validateEmail(email)) {
      return res.status(400).json({
        error: "Please enter a valid email address",
        code: "INVALID_EMAIL",
      })
    }

    console.log(`🔍 DIRECT: Looking for user in main DB: ${email}`)

    // Step 1: Find user in main database
    const mainUser = await User.findOne({
      email: email.toLowerCase().trim(),
      isActive: true,
    })

    if (!mainUser) {
      console.log(`❌ DIRECT: User not found in main DB: ${email}`)
      return res.status(401).json({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      })
    }

    console.log(`✅ DIRECT: Found main user: ${email}`)
    console.log(`🔍 DIRECT: Main user tenantId: ${mainUser.tenantId}`)
    console.log(`🔍 DIRECT: Main user password hash: ${mainUser.password.substring(0, 20)}...`)

    // Step 2: Verify password directly using bcrypt
    console.log(`🔍 DIRECT: Comparing password for: ${email}`)
    console.log(`🔍 DIRECT: Provided password: "${password}"`)

    const isPasswordValid = await bcrypt.compare(password, mainUser.password)
    console.log(`🔑 DIRECT: Password comparison result: ${isPasswordValid}`)

    if (!isPasswordValid) {
      console.log(`❌ DIRECT: Password mismatch for: ${email}`)
      return res.status(401).json({
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      })
    }

    console.log(`✅ DIRECT: Password verified for: ${email}`)

    // Step 3: Get tenant models (this handles DB connection safely)
    console.log(`🔍 DIRECT: Getting tenant models for: ${mainUser.tenantId}`)

    const models = await getTenantModels(mainUser.tenantId)
    console.log(`✅ DIRECT: Got tenant models for: ${mainUser.tenantId}`)

    // Step 4: Get tenant user data
    const tenantUser = await models.User.findOne({
      email: email.toLowerCase().trim(),
    })

    if (!tenantUser) {
      console.log(`❌ DIRECT: Tenant user not found: ${email}`)
      return res.status(400).json({
        error: "User data not found in tenant database",
        code: "TENANT_USER_NOT_FOUND",
      })
    }

    if (!tenantUser.isActive) {
      console.log(`❌ DIRECT: Tenant user is inactive: ${email}`)
      return res.status(401).json({
        error: "User account is inactive",
        code: "USER_INACTIVE",
      })
    }

    console.log(`✅ DIRECT: Found tenant user: ${email}`)

    // Step 5: Update last login time
    tenantUser.lastLoginAt = new Date()
    await tenantUser.save()

    // Step 6: Generate JWT token
    const token = AuthUtils.generateToken(
      {
        userId: tenantUser._id,
        tenantId: mainUser.tenantId,
        email: email.toLowerCase(),
        type: "admin",
      },
      rememberMe ? "90d" : "7d",
    )

    // Step 7: Prepare response
    const expiresIn = rememberMe ? "90d" : "7d"
    const response = {
      message: "Login successful",
      token,
      tenantId: mainUser.tenantId,
      storeId: mainUser.storeId || null,
      hasStore: tenantUser.hasStore || false,
      user: AuthUtils.sanitizeUser(tenantUser),
      expiresIn,
      tokenExpiry: AuthUtils.getTokenExpiry(token),
    }

    console.log(`✅ DIRECT: Login successful for: ${email}`)
    console.log(`🎉 DIRECT: Response prepared with token and user data`)

    res.json(response)
  } catch (error) {
    console.error("❌ DIRECT LOGIN error:", error)
    res.status(500).json({
      error: "Login failed",
      details: error.message,
      code: "LOGIN_ERROR",
    })
  }
})

// Forgot Password - with reCAPTCHA
router.post("/forgot-password", recaptchaMiddleware.v3.forgotPassword, async (req, res) => {
  try {
    const { email } = req.body

    console.log(`🔐 Password reset request for: ${email}`)

    // Log reCAPTCHA result
    if (req.recaptcha) {
      console.log(`🔒 reCAPTCHA result:`, {
        success: req.recaptcha.success,
        score: req.recaptcha.score,
        action: req.recaptcha.action,
        skipped: req.recaptcha.skipped,
      })
    }

    if (!email || !AuthUtils.validateEmail(email)) {
      return res.status(400).json({
        error: "Valid email address is required",
        code: "INVALID_EMAIL",
      })
    }

    // Check if user exists
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })

    // Always return success for security (don't reveal if email exists)
    const successResponse = {
      message: "If an account with this email exists, a password reset code has been sent.",
      email,
    }

    if (!user) {
      console.log(`❌ User not found for password reset: ${email}`)
      return res.json(successResponse)
    }

    // Generate and send OTP
    const otp = await OTP.createOTP(email, "password_reset", AuthUtils.extractClientInfo(req))
    await sendOTPEmail(email, otp, "password reset")

    console.log(`🔐 Password reset OTP sent for ${email}`)

    res.json(successResponse)
  } catch (error) {
    console.error("❌ Forgot password error:", error)
    res.status(500).json({
      error: "Password reset request failed",
      details: error.message,
      code: "PASSWORD_RESET_ERROR",
    })
  }
})

// Verify Reset OTP
router.post("/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body

    console.log(`🔍 Verifying reset OTP for: ${email}`)

    if (!email || !otp) {
      return res.status(400).json({
        error: "Email and OTP are required",
        code: "MISSING_FIELDS",
      })
    }

    // Check OTP without consuming it
    const otpCheck = await OTP.checkOTP(email, otp, "password_reset")

    if (!otpCheck.success) {
      return res.status(400).json({
        error: otpCheck.message,
        code: otpCheck.code,
      })
    }

    // Check if user still exists
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    console.log(`✅ Password reset OTP verified for ${email}`)

    res.json({
      message: "OTP verified successfully. You can now reset your password.",
      verified: true,
      email,
    })
  } catch (error) {
    console.error("❌ Verify reset OTP error:", error)
    res.status(500).json({
      error: "OTP verification failed",
      details: error.message,
      code: "OTP_VERIFICATION_ERROR",
    })
  }
})

// Reset Password - with reCAPTCHA
router.post("/reset-password", recaptchaMiddleware.v3.resetPassword, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body

    console.log(`🔐 Password reset attempt for: ${email}`)

    // Log reCAPTCHA result
    if (req.recaptcha) {
      console.log(`🔒 reCAPTCHA result:`, {
        success: req.recaptcha.success,
        score: req.recaptcha.score,
        action: req.recaptcha.action,
        skipped: req.recaptcha.skipped,
      })
    }

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        error: "Email, OTP, and new password are required",
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

    // Verify and consume OTP
    const otpVerification = await OTP.verifyOTP(email, otp, "password_reset")
    if (!otpVerification.success) {
      return res.status(400).json({
        error: otpVerification.message,
        code: otpVerification.code,
      })
    }

    // Find user in main DB
    const mainUser = await User.findOne({ email: email.toLowerCase(), isActive: true })
    if (!mainUser) {
      console.log(`❌ User not found in main DB: ${email}`)
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    console.log(`👤 Found user in main DB: ${email}, tenantId: ${mainUser.tenantId}`)

    // Update password in main DB
    mainUser.password = newPassword // Will be hashed by pre-save middleware
    mainUser.passwordChangedAt = new Date()
    await mainUser.save()
    console.log(`✅ Password updated in main DB for ${email}`)

    // Update password in tenant DB as well
    try {
      const models = await getTenantModels(mainUser.tenantId)
      const tenantUser = await models.User.findOne({ email: email.toLowerCase() })

      if (tenantUser) {
        tenantUser.password = newPassword // Will be hashed by pre-save middleware
        tenantUser.passwordChangedAt = new Date()
        await tenantUser.save()
        console.log(`✅ Password updated in tenant DB for ${email}`)
      } else {
        console.log(`⚠️ Tenant user not found for ${email}`)
      }
    } catch (tenantError) {
      console.error("❌ Error updating tenant password:", tenantError)
      // Don't fail the request if tenant update fails
    }

    console.log(`✅ Password reset completed for ${email}`)

    res.json({
      message: "Password reset successfully. You can now login with your new password.",
      success: true,
    })
  } catch (error) {
    console.error("❌ Reset password error:", error)
    res.status(500).json({
      error: "Password reset failed",
      details: error.message,
      code: "PASSWORD_RESET_FAILED",
    })
  }
})

// Setup Store
router.post("/setup-store", async (req, res) => {
  try {
    const authHeader = req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Access denied. No valid token provided.",
        code: "NO_TOKEN",
      })
    }

    const token = authHeader.replace("Bearer ", "")
    let decoded

    try {
      decoded = AuthUtils.verifyToken(token)
    } catch (tokenError) {
      return res.status(401).json({
        error: "Invalid or expired token",
        code: "INVALID_TOKEN",
      })
    }

    // Get main user for tenant lookup
    const mainUser = await User.findOne({ email: decoded.email, isActive: true })
    if (!mainUser) {
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    // Get tenant models
    const models = await getTenantModels(mainUser.tenantId)
    const tenantUser = await models.User.findById(decoded.userId)

    if (!tenantUser) {
      return res.status(404).json({
        error: "Tenant user not found",
        code: "TENANT_USER_NOT_FOUND",
      })
    }

    if (tenantUser.hasStore) {
      return res.status(400).json({
        error: "Store already exists for this user",
        code: "STORE_EXISTS",
      })
    }

    const { storeName, logo, banner, industry } = req.body

    // Validate store name
    if (!storeName || storeName.trim().length < 2) {
      return res.status(400).json({
        error: "Store name must be at least 2 characters long",
        code: "INVALID_STORE_NAME",
      })
    }

    // Generate unique store ID
    const storeId = await generateStoreId()
    console.log(`🏪 Setting up store with ID: ${storeId} for tenant: ${mainUser.tenantId}`)

    // Update tenant user with store info
    tenantUser.hasStore = true
    tenantUser.storeInfo = {
      name: storeName.trim(),
      logo: logo || "",
      banner: banner || "",
      storeId: storeId,
      industry: industry || "General",
      isActive: true,
    }
    await tenantUser.save()

    // Update main user with store ID
    mainUser.storeId = storeId
    await mainUser.save()

    // Update settings with store info
    const settings = await models.Settings.findOne()
    if (settings) {
      settings.general.storeName = storeName.trim()
      settings.general.logo = logo || ""
      settings.general.banner = banner || ""
      await settings.save()
    }

    console.log(`✅ Store setup completed for: ${storeName} (${storeId})`)

    // Construct URLs
    const baseUrl = `${req.protocol}://${req.get("host")}`

    res.json({
      message: "Store setup completed successfully",
      tenantId: mainUser.tenantId,
      storeId,
      storeUrl: `${baseUrl}/api/${storeId.toLowerCase()}`,
      adminUrl: `${baseUrl}/api/admin`,
      storeInfo: tenantUser.storeInfo,
    })
  } catch (error) {
    console.error("❌ Store setup error:", error)
    res.status(500).json({
      error: "Store setup failed",
      details: error.message,
      code: "STORE_SETUP_ERROR",
    })
  }
})

// Get user status
router.get("/user/status", async (req, res) => {
  try {
    const authHeader = req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Access denied. No token provided.",
        code: "NO_TOKEN",
      })
    }

    const token = authHeader.replace("Bearer ", "")
    let decoded

    try {
      decoded = AuthUtils.verifyToken(token)
    } catch (tokenError) {
      return res.status(401).json({
        error: "Invalid or expired token",
        code: "INVALID_TOKEN",
      })
    }

    console.log("🔍 Getting user status...")

    // Get main user for tenant lookup
    const mainUser = await User.findOne({ email: decoded.email, isActive: true })
    if (!mainUser) {
      console.log("❌ Main user not found")
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    console.log("✅ Main user found:", { tenantId: mainUser.tenantId, storeId: mainUser.storeId })

    // Get tenant user data
    const models = await getTenantModels(mainUser.tenantId)
    const tenantUser = await models.User.findById(decoded.userId)

    if (!tenantUser) {
      console.log("❌ Tenant user not found")
      return res.status(404).json({
        error: "Tenant user not found",
        code: "TENANT_USER_NOT_FOUND",
      })
    }

    console.log("✅ Tenant user found:", { hasStore: tenantUser.hasStore })

    res.json({
      user: AuthUtils.sanitizeUser(tenantUser),
      hasStore: tenantUser.hasStore,
      tenantId: mainUser.tenantId,
      storeId: mainUser.storeId || null,
      tokenExpiry: AuthUtils.getTokenExpiry(token),
      isTokenExpired: AuthUtils.isTokenExpired(token),
    })
  } catch (error) {
    console.error("❌ User status error:", error)
    res.status(500).json({
      error: "Failed to get user status",
      details: error.message,
      code: "USER_STATUS_ERROR",
    })
  }
})

// Refresh token endpoint
router.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(401).json({
        error: "Refresh token is required",
        code: "NO_REFRESH_TOKEN",
      })
    }

    // In a production app, you'd validate the refresh token against a database
    // For now, we'll just verify if it's a valid JWT and not expired
    let decoded
    try {
      decoded = AuthUtils.verifyToken(refreshToken)
    } catch (tokenError) {
      return res.status(401).json({
        error: "Invalid refresh token",
        code: "INVALID_REFRESH_TOKEN",
      })
    }

    // Get user and generate new token
    const mainUser = await User.findOne({ email: decoded.email, isActive: true })
    if (!mainUser) {
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    const newToken = AuthUtils.generateToken({
      userId: decoded.userId,
      tenantId: mainUser.tenantId,
      email: decoded.email,
      type: decoded.type,
    })

    res.json({
      message: "Token refreshed successfully",
      token: newToken,
      tokenExpiry: AuthUtils.getTokenExpiry(newToken),
    })
  } catch (error) {
    console.error("❌ Token refresh error:", error)
    res.status(500).json({
      error: "Token refresh failed",
      details: error.message,
      code: "TOKEN_REFRESH_ERROR",
    })
  }
})

// Logout endpoint (for token invalidation tracking)
router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.header("Authorization")
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "")
      // In a production app, you'd add this token to a blacklist
      console.log(`🚪 User logged out, token should be blacklisted: ${token.substring(0, 20)}...`)
    }

    res.json({
      message: "Logged out successfully",
      action: "Please remove the token from your client storage",
    })
  } catch (error) {
    console.error("❌ Logout error:", error)
    res.status(500).json({
      error: "Logout failed",
      details: error.message,
      code: "LOGOUT_ERROR",
    })
  }
})

module.exports = router
