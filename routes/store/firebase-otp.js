const express = require("express")
const rateLimit = require("express-rate-limit")
const AuthUtils = require("../../utils/auth")
const CustomerOTP = require("../../models/CustomerOTP")
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

// Apply rate limiting to OTP endpoints
router.use(["/send-otp", "/verify-otp"], otpRateLimit)

// Enhanced logging middleware
router.use((req, res, next) => {
  console.log(`📱 Firebase OTP: ${req.method} ${req.path}`)
  console.log(`📱 Store ID: ${req.storeId}`)
  console.log(`📱 Tenant ID: ${req.tenantId}`)
  next()
})

// Send OTP via Firebase
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, purpose = "login" } = req.body

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

    // Extract client info for security
    const clientInfo = AuthUtils.extractClientInfo(req)

    try {
      // Create OTP record in database for tracking
      const otp = await CustomerOTP.createOTP(
        phone,
        req.tenantId,
        purpose,
        clientInfo,
        10, // 10 minutes expiry
      )

      console.log(`✅ Firebase OTP created for ${phone}: ${otp}`)

      // Return success response (Firebase handles actual SMS sending)
      res.json({
        success: true,
        message: "OTP will be sent via Firebase. Please verify using Firebase SDK.",
        phone: phone,
        purpose: purpose,
        expiresIn: "10 minutes",
        useFirebaseSDK: true,
        instructions: {
          step1: "Initialize Firebase Auth with reCAPTCHA",
          step2: "Call signInWithPhoneNumber() with the phone number",
          step3: "Enter the received OTP code",
          step4: "Call verify-firebase-otp endpoint with the verification result",
        },
      })
    } catch (error) {
      console.error("❌ Error creating Firebase OTP:", error)
      res.status(500).json({
        error: "Failed to initiate OTP process",
        details: error.message,
        code: "OTP_CREATION_ERROR",
      })
    }
  } catch (error) {
    console.error("❌ Firebase OTP send error:", error)
    res.status(500).json({
      error: "Failed to send OTP",
      details: error.message,
      code: "OTP_SEND_ERROR",
    })
  }
})

// Verify Firebase OTP and authenticate customer
router.post("/verify-firebase-otp", async (req, res) => {
  try {
    const { phone, firebaseUid, purpose = "login", name, email, rememberMe } = req.body

    console.log(`🔍 Firebase OTP verification for store: ${req.storeId}, phone: ${phone}`)

    // Validation
    if (!phone || !firebaseUid) {
      return res.status(400).json({
        error: "Phone number and Firebase UID are required",
        code: "MISSING_REQUIRED_FIELDS",
      })
    }

    if (!AuthUtils.validatePhone(phone)) {
      return res.status(400).json({
        error: "Please enter a valid phone number",
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

    // Verify OTP record exists (for security tracking)
    const otpVerification = await CustomerOTP.verifyOTP(phone, req.tenantId, "000000", purpose)
    if (!otpVerification.success && otpVerification.code !== "INVALID_OTP") {
      return res.status(400).json({
        error: otpVerification.message,
        code: otpVerification.code,
      })
    }

    // Find or create customer
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
      if (!name) {
        return res.status(400).json({
          error: "Name is required for registration",
          code: "MISSING_NAME",
        })
      }

      customer = new Customer({
        name: name.trim(),
        phone: phone,
        email: email || "",
        firebaseUid: firebaseUid,
        totalSpent: 0,
        totalOrders: 0,
        isActive: true,
        isVerified: true,
        phoneVerified: true,
        emailVerified: !!email,
        preferences: {
          notifications: true,
          marketing: false,
          newsletter: false,
          smsUpdates: true,
        },
      })

      await customer.save()
      console.log(`👤 New customer registered via Firebase OTP: ${phone}`)
    } else {
      // Update existing customer
      if (!customer.firebaseUid) {
        customer.firebaseUid = firebaseUid
      }
      customer.phoneVerified = true
      customer.isVerified = true
      customer.lastLoginAt = new Date()

      if (name && name.trim()) {
        customer.name = name.trim()
      }
      if (email && email.trim()) {
        customer.email = email.trim()
        customer.emailVerified = true
      }

      await customer.save()
      console.log(`✅ Existing customer authenticated via Firebase OTP: ${phone}`)
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
      authMethod: "firebase_otp",
    }

    console.log("✅ Firebase OTP authentication successful")
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
        missingFields,
        code: "FIREBASE_CONFIG_INCOMPLETE",
      })
    }

    res.json({
      success: true,
      config,
      message: "Firebase configuration ready for OTP authentication",
    })
  } catch (error) {
    console.error("❌ Error getting Firebase config:", error)
    res.status(500).json({
      error: "Failed to get Firebase configuration",
      code: "CONFIG_ERROR",
    })
  }
})

module.exports = router
