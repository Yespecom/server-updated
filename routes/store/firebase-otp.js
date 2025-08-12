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

      // Return success - client will handle Firebase phone auth
      res.json({
        success: true,
        message: "Ready for Firebase phone verification",
        phone: phone,
        purpose: purpose,
        method: "firebase_phone_auth",
        instructions: "Use Firebase client SDK to send verification code",
        firebaseConfig: {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        },
      })
    } catch (error) {
      console.error("❌ Error preparing Firebase OTP:", error)
      res.status(500).json({
        error: "Failed to prepare phone verification",
        details: error.message,
        code: "FIREBASE_PREP_ERROR",
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

// Verify Firebase ID token (after client completes phone auth)
router.post("/verify-otp", async (req, res) => {
  try {
    const { idToken, purpose = "login", name, email, rememberMe } = req.body

    console.log(`🔍 Firebase ID token verification for store: ${req.storeId}`)

    // Validation
    if (!idToken) {
      return res.status(400).json({
        error: "Firebase ID token is required",
        code: "MISSING_ID_TOKEN",
      })
    }

    if (!req.tenantDB) {
      return res.status(500).json({
        error: "Database not initialized",
        code: "DB_NOT_INITIALIZED",
      })
    }

    const tokenVerification = await verifyFirebaseToken(idToken)
    if (!tokenVerification.success) {
      return res.status(400).json({
        error: "Invalid Firebase token",
        details: tokenVerification.error,
        code: "INVALID_FIREBASE_TOKEN",
      })
    }

    const { uid, phone, email: firebaseEmail, name: firebaseName } = tokenVerification

    if (!phone) {
      return res.status(400).json({
        error: "Phone number not found in Firebase token",
        code: "MISSING_PHONE_IN_TOKEN",
      })
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
      const customerName = name || firebaseName || "User"
      const customerEmail = email || firebaseEmail || ""

      customer = new Customer({
        name: customerName.trim(),
        phone: phone,
        email: customerEmail,
        firebaseUid: uid, // Store Firebase UID
        totalSpent: 0,
        totalOrders: 0,
        isActive: true,
        isVerified: true,
        phoneVerified: true,
        emailVerified: !!customerEmail,
        preferences: {
          notifications: true,
          marketing: false,
          newsletter: false,
          smsUpdates: true,
        },
      })

      await customer.save()
      console.log(`👤 New customer registered via Firebase: ${phone}`)
    } else {
      // Update existing customer
      customer.phoneVerified = true
      customer.isVerified = true
      customer.lastLoginAt = new Date()
      customer.firebaseUid = uid // Update Firebase UID

      if (name && name.trim()) {
        customer.name = name.trim()
      }
      if (email && email.trim()) {
        customer.email = email.trim()
        customer.emailVerified = true
      }

      await customer.save()
      console.log(`✅ Existing customer authenticated via Firebase: ${phone}`)
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
        firebaseUid: customer.firebaseUid,
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
    }

    console.log("✅ Firebase phone authentication successful")
    res.json(response)
  } catch (error) {
    console.error("❌ Firebase token verification error:", error)
    res.status(500).json({
      error: "Failed to verify Firebase token",
      details: error.message,
      code: "TOKEN_VERIFICATION_ERROR",
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

module.exports = router
