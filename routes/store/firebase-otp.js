const express = require("express")
const rateLimit = require("express-rate-limit")
const AuthUtils = require("../../utils/auth")
const CustomerOTP = require("../../models/CustomerOTP")
const { getFirebaseAuth, getUserByPhone, createUserWithPhone, createCustomToken } = require("../../config/firebase")
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

      let firebaseUid = null

      // For registration, create Firebase user if doesn't exist
      if (purpose === "registration" && !firebaseUser.success) {
        const newFirebaseUser = await createUserWithPhone(phone, {
          displayName: name || "User",
        })

        if (!newFirebaseUser.success) {
          return res.status(500).json({
            error: "Failed to create Firebase user",
            details: newFirebaseUser.error,
            code: "FIREBASE_USER_CREATION_ERROR",
          })
        }

        firebaseUid = newFirebaseUser.user.uid
        console.log(`✅ Firebase user created: ${phone} (UID: ${firebaseUid})`)
      } else if (firebaseUser.success) {
        firebaseUid = firebaseUser.user.uid
      }

      // Generate 6-digit OTP
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString()

      // Store OTP in database with Firebase UID
      const otp = await CustomerOTP.createOTP(
        phone,
        req.tenantId,
        purpose,
        {
          userAgent: req.get("User-Agent"),
          ip: req.ip,
          storeId: req.storeId,
          firebaseUid: firebaseUid,
        },
        10,
        otpCode,
      )

      console.log(`✅ Firebase OTP created for ${phone}: ${otpCode}`)

      // In a real implementation, you would send SMS here
      // For now, we'll return the OTP for testing (remove in production)
      res.json({
        success: true,
        message: "OTP generated successfully",
        phone: phone,
        purpose: purpose,
        method: "firebase_admin",
        provider: "firebase",
        expiresIn: "10 minutes",
        // Remove this in production - only for testing
        testOTP: otpCode,
        firebaseUid: firebaseUid,
      })
    } catch (error) {
      console.error("❌ Error generating Firebase OTP:", error)
      res.status(500).json({
        error: "Failed to generate OTP",
        details: error.message,
        code: "OTP_GENERATION_ERROR",
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
    const { phone, otp, purpose = "login", name, email, rememberMe } = req.body

    console.log(`🔍 Firebase OTP verification for store: ${req.storeId}, phone: ${phone}`)

    // Validation
    if (!phone || !otp) {
      return res.status(400).json({
        error: "Phone number and OTP are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    // Verify OTP from database
    const otpVerification = await CustomerOTP.verifyOTP(phone, otp, req.tenantId, purpose)

    if (!otpVerification.success) {
      return res.status(400).json({
        error: otpVerification.error || "Invalid or expired OTP",
        code: "INVALID_OTP",
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
