const express = require("express")
const rateLimit = require("express-rate-limit")
const AuthUtils = require("../../utils/auth")
const CustomerOTP = require("../../models/CustomerOTP")
const { getFirebaseAuth, verifyFirebaseToken, getUserByPhone, createUserWithPhone } = require("../../config/firebase")
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

// Initialize phone verification (client-side Firebase will handle SMS)
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, purpose = "login", recaptchaToken } = req.body

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

    try {
      // Check if user exists in Firebase
      const firebaseUser = await getUserByPhone(phone)

      if (purpose === "login" && !firebaseUser.success) {
        return res.status(404).json({
          error: "No account found with this phone number",
          code: "USER_NOT_FOUND",
          canRegister: true,
        })
      }

      // For registration, create Firebase user if doesn't exist
      if (purpose === "registration" && !firebaseUser.success) {
        const newFirebaseUser = await createUserWithPhone(phone, {
          displayName: req.body.name || "User",
        })

        if (!newFirebaseUser.success) {
          return res.status(500).json({
            error: "Failed to create Firebase user",
            details: newFirebaseUser.error,
            code: "FIREBASE_USER_CREATION_ERROR",
          })
        }

        console.log(`✅ Firebase user created: ${phone}`)
      }

      const firebaseResult = await sendFirebasePhoneOTP(phone, recaptchaToken)

      if (!firebaseResult.success) {
        return res.status(500).json({
          error: "Failed to send OTP via Firebase",
          details: firebaseResult.error,
          code: "FIREBASE_OTP_SEND_ERROR",
        })
      }

      // Store session info for verification
      const otp = await CustomerOTP.createOTP(phone, req.tenantId, purpose, {
        userAgent: req.get("User-Agent"),
        ip: req.ip,
        storeId: req.storeId,
        sessionInfo: firebaseResult.sessionInfo, // Store Firebase session info
      })

      console.log(`✅ Firebase OTP sent to ${phone}`)

      res.json({
        success: true,
        message: "OTP sent successfully via Firebase",
        phone: phone,
        purpose: purpose,
        method: "firebase_sms",
        provider: "firebase",
        sessionInfo: firebaseResult.sessionInfo,
        expiresIn: "10 minutes",
      })
    } catch (error) {
      console.error("❌ Error sending Firebase OTP:", error)
      res.status(500).json({
        error: "Failed to send OTP",
        details: error.message,
        code: "OTP_SEND_ERROR",
      })
    }
  } catch (error) {
    console.error("❌ Firebase OTP send error:", error)
    res.status(500).json({
      error: "Failed to initialize phone verification",
      details: error.message,
      code: "OTP_INIT_ERROR",
    })
  }
})

router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp, sessionInfo, purpose = "login", name, email, rememberMe } = req.body

    console.log(`🔍 Firebase OTP verification for store: ${req.storeId}, phone: ${phone}`)

    // Validation
    if (!phone || !otp) {
      return res.status(400).json({
        error: "Phone number and OTP are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    if (!sessionInfo) {
      return res.status(400).json({
        error: "Session info is required for Firebase verification",
        code: "MISSING_SESSION_INFO",
      })
    }

    const firebaseVerification = await verifyFirebasePhoneOTP(sessionInfo, otp)

    if (!firebaseVerification.success) {
      return res.status(400).json({
        error: firebaseVerification.error || "Invalid or expired OTP",
        code: "INVALID_OTP",
      })
    }

    console.log(`✅ Firebase OTP verified for ${phone}`)

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
        firebaseUid: firebaseVerification.uid, // Store Firebase UID
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
      customer.firebaseUid = firebaseVerification.uid // Update Firebase UID

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
      authMethod: "firebase_phone_auth",
      firebaseTokens: {
        idToken: firebaseVerification.idToken,
        refreshToken: firebaseVerification.refreshToken,
      },
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

// Firebase REST API function for phone authentication
async function sendFirebasePhoneOTP(phone, recaptchaToken) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumber: phone,
          recaptchaToken: recaptchaToken || "test-token", // For testing purposes
        }),
      },
    )

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error?.message || "Failed to send OTP")
    }

    return {
      success: true,
      sessionInfo: result.sessionInfo,
      provider: "firebase",
    }
  } catch (error) {
    console.error("❌ Firebase phone OTP error:", error)
    return {
      success: false,
      error: error.message,
    }
  }
}

// Firebase OTP verification function
async function verifyFirebasePhoneOTP(sessionInfo, otp) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionInfo: sessionInfo,
          code: otp,
        }),
      },
    )

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error?.message || "Invalid OTP")
    }

    return {
      success: true,
      idToken: result.idToken,
      refreshToken: result.refreshToken,
      uid: result.localId,
    }
  } catch (error) {
    console.error("❌ Firebase OTP verification error:", error)
    return {
      success: false,
      error: error.message,
    }
  }
}

module.exports = router
