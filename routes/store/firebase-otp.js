const express = require("express")
const rateLimit = require("express-rate-limit")
const AuthUtils = require("../../utils/auth")
const CustomerOTP = require("../../models/CustomerOTP")
const { getFirebaseAuth, getUserByPhone, createUserWithPhone, createCustomToken } = require("../../config/firebase")
const RecaptchaUtils = require("../../utils/recaptcha")
const router = express.Router({ mergeParams: true })

// Rate limiting for OTP endpoints
const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 OTP requests per windowMs
  message: {
    error: "Too many OTP requests",
    code: "OTP_RATE_LIMIT_EXCEEDED",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Apply rate limiting and reCAPTCHA to OTP endpoints
router.use(["/send-otp", "/verify-otp"], otpRateLimit, RecaptchaUtils.middleware(true))

// Enhanced logging middleware
router.use((req, res, next) => {
  console.log(`📱 Firebase OTP: ${req.method} ${req.path}`)
  console.log(`📱 Store ID: ${req.storeId}`)
  console.log(`📱 Tenant ID: ${req.tenantId}`)
  next()
})

router.post("/send-otp", async (req, res) => {
  try {
    const { phone, purpose = "login", name } = req.body

    console.log(`📱 Firebase OTP request for store: ${req.storeId}, phone: ${phone}`)
    console.log(`🔒 reCAPTCHA verified with score: ${req.recaptcha?.score || "N/A"}`)

    // Validation
    if (!phone) {
      return res.status(400).json({
        error: "Phone number is required",
        code: "MISSING_PHONE",
      })
    }

    if (!AuthUtils.validatePhone(phone)) {
      return res.status(400).json({
        error: "Please enter a valid phone number",
        code: "INVALID_PHONE",
      })
    }

    if (!["login", "registration", "order_verification"].includes(purpose)) {
      return res.status(400).json({
        error: "Invalid OTP purpose",
        code: "INVALID_PURPOSE",
      })
    }

    const firebaseResult = await sendFirebaseOTP(phone)

    if (!firebaseResult.success) {
      console.error("❌ Firebase OTP sending failed:", firebaseResult.error)
      return res.status(500).json({
        error: "Failed to send OTP via Firebase",
        details: firebaseResult.error,
        code: "FIREBASE_SMS_ERROR",
      })
    }

    // Store the Firebase session info for verification
    const otp = await CustomerOTP.createOTP(
      phone,
      req.tenantId,
      purpose,
      {
        userAgent: req.get("User-Agent"),
        ip: req.ip,
        storeId: req.storeId,
        firebaseUid: firebaseResult.firebaseUid,
        firebaseSessionInfo: firebaseResult.sessionInfo, // Store Firebase session info
        recaptchaScore: req.recaptcha?.score, // Store reCAPTCHA score for audit
      },
      10,
      firebaseResult.otp, // Use Firebase generated OTP
    )

    console.log(`✅ Firebase OTP sent to ${phone}`)

    res.json({
      success: true,
      message: "OTP sent successfully via Firebase",
      phone: phone,
      purpose: purpose,
      method: "firebase_sms",
      provider: "firebase",
      expiresIn: "10 minutes",
      firebaseUid: firebaseResult.firebaseUid,
      sessionInfo: firebaseResult.sessionInfo, // Return session info for verification
    })
  } catch (error) {
    console.error("❌ Firebase OTP send error:", error)
    res.status(500).json({
      error: "Failed to initialize phone verification",
      details: error.message,
      code: "OTP_INIT_ERROR",
    })
  }
})

async function sendFirebaseOTP(phoneNumber) {
  try {
    const auth = getFirebaseAuth()

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // Create or update user with phone number
    let userRecord
    try {
      userRecord = await auth.getUserByPhoneNumber(phoneNumber)
      console.log(`📱 Existing Firebase user found: ${phoneNumber}`)
    } catch (error) {
      // User doesn't exist, create new user
      userRecord = await auth.createUser({
        phoneNumber: phoneNumber,
        disabled: false,
      })
      console.log(`📱 New Firebase user created: ${phoneNumber} (UID: ${userRecord.uid})`)
    }

    // Create custom token for the user
    const customToken = await auth.createCustomToken(userRecord.uid, {
      phoneNumber: phoneNumber,
      otp: otp,
      timestamp: Date.now(),
    })

    console.log(`📱 Firebase OTP generated for ${phoneNumber}: ${otp}`)

    return {
      success: true,
      otp: otp,
      sessionInfo: customToken,
      firebaseUid: userRecord.uid,
    }
  } catch (error) {
    console.error("❌ Firebase OTP generation error:", error)
    return {
      success: false,
      error: error.message,
    }
  }
}

router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp, sessionInfo, purpose = "login", name, email, rememberMe } = req.body

    console.log(`🔍 Firebase OTP verification for store: ${req.storeId}, phone: ${phone}`)
    console.log(`🔒 reCAPTCHA verified with score: ${req.recaptcha?.score || "N/A"}`)

    // Validation
    if (!phone || !otp) {
      return res.status(400).json({
        error: "Phone number and OTP are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    const firebaseVerification = await verifyFirebaseOTP(phone, otp, sessionInfo)

    if (!firebaseVerification.success) {
      return res.status(400).json({
        error: "Invalid or expired OTP",
        details: firebaseVerification.error,
        code: "FIREBASE_OTP_INVALID",
      })
    }

    console.log(`✅ Firebase OTP verified for ${phone}`)

    // Get Firebase user
    const firebaseUser = await getUserByPhone(phone)
    let firebaseUid = null
    let customToken = null

    if (firebaseUser.success) {
      firebaseUid = firebaseUser.user.uid
      // Create custom token for the user
      const tokenResult = await createCustomToken(firebaseUid, {
        phone: phone,
        storeId: req.storeId,
        tenantId: req.tenantId,
      })
      if (tokenResult.success) {
        customToken = tokenResult.token
      }
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)

    // Find or create customer in local database
    let customer = await Customer.findOne({ phone: phone })

    if (!customer) {
      if (purpose === "login") {
        return res.status(404).json({
          error: "No account found with this phone number",
          code: "CUSTOMER_NOT_FOUND",
          canRegister: true,
        })
      }

      // Create new customer for registration
      const customerName = name || "User"
      const customerEmail = email || ""

      customer = new Customer({
        name: customerName.trim(),
        phone: phone,
        email: customerEmail,
        totalSpent: 0,
        totalOrders: 0,
        isActive: true,
        isVerified: true,
        phoneVerified: true,
        emailVerified: !!customerEmail,
        firebaseUid: firebaseUid,
        preferences: {
          notifications: true,
          marketing: false,
          newsletter: false,
          smsUpdates: true,
        },
      })

      await customer.save()
      console.log(`👤 New customer registered: ${phone}`)
    } else {
      // Update existing customer
      customer.phoneVerified = true
      customer.isVerified = true
      customer.lastLoginAt = new Date()
      customer.firebaseUid = firebaseUid

      if (name && name.trim()) {
        customer.name = name.trim()
      }
      if (email && email.trim()) {
        customer.email = email.trim()
        customer.emailVerified = true
      }

      await customer.save()
      console.log(`✅ Existing customer authenticated: ${phone}`)
    }

    // Generate JWT token
    const token = customer.generateAuthToken(req.storeId, req.tenantId, rememberMe)
    const tokenExpiry = AuthUtils.formatTokenExpiry(token)

    const response = {
      message: purpose === "registration" ? "Registration successful" : "Login successful",
      token,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        totalSpent: customer.totalSpent,
        totalOrders: customer.totalOrders,
        isVerified: customer.isVerified,
        phoneVerified: customer.phoneVerified,
        preferences: customer.preferences,
      },
      storeId: req.storeId,
      tenantId: req.tenantId,
      tokenInfo: tokenExpiry,
      expiresIn: rememberMe ? "365 days" : "90 days",
      authMethod: "firebase_admin_otp",
      firebaseUid: firebaseUid,
      firebaseCustomToken: customToken,
    }

    console.log("✅ Firebase phone authentication successful")
    res.json(response)
  } catch (error) {
    console.error("❌ Firebase OTP verification error:", error)
    res.status(500).json({
      error: "Failed to verify OTP",
      details: error.message,
      code: "OTP_VERIFICATION_ERROR",
    })
  }
})

async function verifyFirebaseOTP(phoneNumber, code, sessionInfo) {
  try {
    const auth = getFirebaseAuth()

    const decodedToken = await auth.verifyIdToken(sessionInfo)

    if (decodedToken.phoneNumber !== phoneNumber) {
      throw new Error("Phone number mismatch")
    }

    if (decodedToken.otp !== code) {
      throw new Error("Invalid OTP")
    }

    // Check if OTP is expired (10 minutes)
    const otpAge = Date.now() - decodedToken.timestamp
    if (otpAge > 10 * 60 * 1000) {
      throw new Error("OTP expired")
    }

    console.log(`✅ Firebase OTP verified for ${phoneNumber}`)

    return {
      success: true,
      firebaseUid: decodedToken.uid,
    }
  } catch (error) {
    console.error("❌ Firebase OTP verification error:", error)
    return {
      success: false,
      error: error.message,
    }
  }
}

// Get Firebase configuration for client
router.get("/firebase-config", (req, res) => {
  try {
    const config = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    }

    // Check if all required fields are present
    const requiredFields = ["apiKey", "authDomain", "projectId"]
    const missingFields = requiredFields.filter((field) => !config[field])

    if (missingFields.length > 0) {
      return res.status(500).json({
        error: "Firebase configuration incomplete",
        missingFields: missingFields,
        code: "FIREBASE_CONFIG_INCOMPLETE",
      })
    }

    res.json({
      success: true,
      config: config,
      message: "Firebase configuration ready for phone authentication",
    })
  } catch (error) {
    console.error("❌ Error getting Firebase config:", error)
    res.status(500).json({
      error: "Failed to get Firebase configuration",
      code: "CONFIG_ERROR",
    })
  }
})

// Get reCAPTCHA configuration for client
router.get("/recaptcha-config", (req, res) => {
  try {
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

    if (!siteKey) {
      return res.status(500).json({
        error: "reCAPTCHA not configured",
        code: "RECAPTCHA_NOT_CONFIGURED",
      })
    }

    res.json({
      success: true,
      siteKey: siteKey,
      message: "reCAPTCHA configuration ready",
    })
  } catch (error) {
    console.error("❌ Error getting reCAPTCHA config:", error)
    res.status(500).json({
      error: "Failed to get reCAPTCHA configuration",
      code: "CONFIG_ERROR",
    })
  }
})

module.exports = router
