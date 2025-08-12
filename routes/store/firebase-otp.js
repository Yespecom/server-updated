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

      const firebaseSMSResult = await sendFirebaseOTP(phone)

      if (!firebaseSMSResult.success) {
        console.error("❌ Firebase SMS sending failed:", firebaseSMSResult.error)
        return res.status(500).json({
          error: "Failed to send OTP via Firebase",
          details: firebaseSMSResult.error,
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
          firebaseUid: firebaseUid,
          firebaseSessionInfo: firebaseSMSResult.sessionInfo, // Store Firebase session info
        },
        10,
        null, // No custom OTP - Firebase handles this
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
        firebaseUid: firebaseUid,
        sessionInfo: firebaseSMSResult.sessionInfo, // Return session info for verification
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

async function sendFirebaseOTP(phoneNumber) {
  try {
    const auth = getFirebaseAuth()

    const { GoogleAuth } = require("google-auth-library")
    const googleAuth = new GoogleAuth({
      credentials: {
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      },
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    })

    const authClient = await googleAuth.getClient()
    const accessToken = await authClient.getAccessToken()

    if (!accessToken.token) {
      throw new Error("Failed to get access token")
    }

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken.token}`,
        },
        body: JSON.stringify({
          phoneNumber: phoneNumber,
          recaptchaToken: "bypass", // Use bypass for server-side requests
        }),
      },
    )

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error?.message || "Firebase SMS API error")
    }

    console.log(`📱 Firebase SMS sent successfully to ${phoneNumber}`)

    return {
      success: true,
      sessionInfo: result.sessionInfo,
    }
  } catch (error) {
    console.error("❌ Firebase SMS sending error:", error)
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

    // Validation
    if (!phone || !otp) {
      return res.status(400).json({
        error: "Phone number and OTP are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    if (sessionInfo) {
      const firebaseVerification = await verifyFirebaseOTP(phone, otp, sessionInfo)

      if (!firebaseVerification.success) {
        return res.status(400).json({
          error: "Invalid or expired OTP",
          details: firebaseVerification.error,
          code: "FIREBASE_OTP_INVALID",
        })
      }

      console.log(`✅ Firebase OTP verified for ${phone}`)
    } else {
      // Fallback to database verification
      const otpVerification = await CustomerOTP.verifyOTP(phone, otp, req.tenantId, purpose)

      if (!otpVerification.success) {
        return res.status(400).json({
          error: otpVerification.error || "Invalid or expired OTP",
          code: "INVALID_OTP",
        })
      }
    }

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
    const { GoogleAuth } = require("google-auth-library")
    const googleAuth = new GoogleAuth({
      credentials: {
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      },
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    })

    const authClient = await googleAuth.getClient()
    const accessToken = await authClient.getAccessToken()

    if (!accessToken.token) {
      throw new Error("Failed to get access token")
    }

    // Verify OTP via Firebase Identity Toolkit API
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken.token}`,
        },
        body: JSON.stringify({
          sessionInfo: sessionInfo,
          code: code,
        }),
      },
    )

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error?.message || "Firebase OTP verification failed")
    }

    console.log(`✅ Firebase OTP verification successful for ${phoneNumber}`)

    return {
      success: true,
      idToken: result.idToken,
      refreshToken: result.refreshToken,
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

module.exports = router
