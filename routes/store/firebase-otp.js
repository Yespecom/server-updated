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
  max: 10, // Increased limit for testing
  message: {
    error: "Too many OTP requests",
    code: "OTP_RATE_LIMIT_EXCEEDED",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Apply rate limiting to OTP endpoints
router.use(["/send-otp", "/verify-otp"], otpRateLimit)

// Enhanced logging middleware
router.use((req, res, next) => {
  console.log(`📱 Firebase OTP: ${req.method} ${req.path}`)
  console.log(`📱 Store ID: ${req.storeId}`)
  console.log(`📱 Tenant ID: ${req.tenantId}`)
  next()
})

// This endpoint is now just for logging - Firebase client SDK handles actual OTP sending
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, purpose = "login", name } = req.body

    console.log(`📱 Firebase OTP request for store: ${req.storeId}, phone: ${phone}`)

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

    // Store OTP request in database for tracking
    const otpRecord = await CustomerOTP.createOTP(
      phone,
      req.tenantId,
      purpose,
      {
        userAgent: req.get("User-Agent"),
        ip: req.ip,
        storeId: req.storeId,
        method: "firebase_client_direct",
      },
      10, // 10 minutes expiry
      "FIREBASE_CLIENT_DIRECT", // Placeholder since Firebase handles OTP generation
    )

    console.log(`✅ OTP request logged for ${phone}`)

    res.json({
      success: true,
      message: "Ready for Firebase phone authentication. Use Firebase client SDK to send OTP.",
      phone: phone,
      purpose: purpose,
      method: "firebase_client_direct",
      provider: "firebase",
      expiresIn: "10 minutes",
      otpId: otpRecord._id,
      instructions: "Use Firebase signInWithPhoneNumber() on client side to send real SMS",
    })
  } catch (error) {
    console.error("❌ Firebase OTP request error:", error)
    res.status(500).json({
      error: "Failed to process OTP request",
      details: error.message,
      code: "OTP_INIT_ERROR",
    })
  }
})

// Verify Firebase ID token (after client-side OTP verification)
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, firebaseIdToken, purpose = "login", name, email, rememberMe } = req.body

    console.log(`🔍 Firebase token verification for store: ${req.storeId}, phone: ${phone}`)
    console.log(`🔥 Firebase ID token received: ${firebaseIdToken ? "Yes" : "No"}`)

    // Validation
    if (!phone || !firebaseIdToken) {
      return res.status(400).json({
        error: "Phone number and Firebase ID token are required",
        code: "MISSING_CREDENTIALS",
        hint: "Use Firebase client SDK to verify OTP and get ID token first",
      })
    }

    // Verify Firebase ID token
    const auth = getFirebaseAuth()
    let decodedToken

    try {
      decodedToken = await auth.verifyIdToken(firebaseIdToken)
      console.log(`✅ Firebase ID token verified for UID: ${decodedToken.uid}`)
      console.log(`📱 Token phone: ${decodedToken.phone_number}`)
    } catch (error) {
      console.error("❌ Firebase ID token verification failed:", error)
      return res.status(400).json({
        error: "Invalid Firebase authentication token",
        details: error.message,
        code: "FIREBASE_TOKEN_INVALID",
      })
    }

    // Verify phone number matches
    if (decodedToken.phone_number !== phone) {
      console.error("❌ Phone number mismatch:", {
        tokenPhone: decodedToken.phone_number,
        requestPhone: phone,
      })
      return res.status(400).json({
        error: "Phone number mismatch between token and request",
        code: "PHONE_MISMATCH",
      })
    }

    console.log(`✅ Firebase phone verification successful for ${phone}`)

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
      const customerName = name || decodedToken.name || "User"
      const customerEmail = email || decodedToken.email || ""

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
        firebaseUid: decodedToken.uid,
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
      customer.firebaseUid = decodedToken.uid

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

    // Create custom token for future Firebase operations
    let customToken = null
    try {
      const tokenResult = await createCustomToken(decodedToken.uid, {
        phone: phone,
        storeId: req.storeId,
        tenantId: req.tenantId,
        customerId: customer._id.toString(),
      })
      if (tokenResult.success) {
        customToken = tokenResult.token
      }
    } catch (error) {
      console.warn("⚠️ Failed to create custom token:", error.message)
    }

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
      authMethod: "firebase_phone_auth",
      firebaseUid: decodedToken.uid,
      firebaseCustomToken: customToken,
    }

    console.log("✅ Firebase phone authentication successful")
    res.json(response)
  } catch (error) {
    console.error("❌ Firebase token verification error:", error)
    res.status(500).json({
      error: "Failed to verify Firebase authentication",
      details: error.message,
      code: "PHONE_VERIFICATION_ERROR",
    })
  }
})

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

// Test endpoint to check Firebase connection
router.get("/test-firebase", async (req, res) => {
  try {
    const auth = getFirebaseAuth()

    // Try to list users (limited to 1) to test connection
    const listUsersResult = await auth.listUsers(1)

    res.json({
      success: true,
      message: "Firebase Admin SDK is working",
      userCount: listUsersResult.users.length,
      projectId: process.env.FIREBASE_PROJECT_ID,
    })
  } catch (error) {
    console.error("❌ Firebase test error:", error)
    res.status(500).json({
      success: false,
      error: "Firebase Admin SDK test failed",
      details: error.message,
      code: "FIREBASE_TEST_FAILED",
    })
  }
})

module.exports = router
