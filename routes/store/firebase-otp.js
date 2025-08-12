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
const admin = require("firebase-admin")
const jwt = require("jsonwebtoken")
const { connectTenantDB } = require("../../config/tenantDB")
const Customer = require("../../models/tenant/Customer")
const storeContext = require("../../middleware/storeContext")

// Apply rate limiting to OTP endpoints
router.use(["/send-otp", "/verify-otp"], otpRateLimit)
const router = express.Router()

// Enhanced logging middleware
router.use((req, res, next) => {
  console.log(`📱 Firebase OTP: ${req.method} ${req.path}`)
  console.log(`📱 Store ID: ${req.storeId}`)
  console.log(`📱 Tenant ID: ${req.tenantId}`)
  next()
})
// Apply store context middleware
router.use(storeContext)

// This endpoint is now just for logging - Firebase client SDK handles actual OTP sending
router.post("/send-otp", async (req, res) => {
// Test Firebase connection
router.get("/test-firebase", async (req, res) => {
try {
    const { phone, purpose = "login", name } = req.body

    console.log(`📱 Firebase OTP request for store: ${req.storeId}, phone: ${phone}`)
    console.log("🔥 Testing Firebase Admin SDK...")

    // Validation
    if (!phone) {
      return res.status(400).json({
        error: "Phone number is required",
        code: "MISSING_PHONE",
    // Check if Firebase Admin is initialized
    if (!admin.apps.length) {
      return res.status(500).json({
        error: "Firebase Admin SDK not initialized",
        code: "FIREBASE_NOT_INITIALIZED",
})
}

    if (!AuthUtils.validatePhone(phone)) {
      return res.status(400).json({
        error: "Please enter a valid phone number",
        code: "INVALID_PHONE",
      })
    // Test Firebase Auth
    const auth = admin.auth()
    console.log("✅ Firebase Auth instance created")

    res.json({
      success: true,
      message: "Firebase Admin SDK is working correctly",
      projectId: admin.app().options.projectId,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Firebase test error:", error)
    res.status(500).json({
      error: "Firebase test failed",
      details: error.message,
      code: "FIREBASE_TEST_FAILED",
    })
  }
})

// Get Firebase client configuration
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

    if (!["login", "registration", "order_verification"].includes(purpose)) {
    // Check if all required config is present
    const missingConfig = Object.entries(config)
      .filter(([key, value]) => !value)
      .map(([key]) => key)

    if (missingConfig.length > 0) {
return res.status(400).json({
        error: "Invalid OTP purpose",
        code: "INVALID_PURPOSE",
        error: "Missing Firebase configuration",
        missingConfig,
        code: "MISSING_CONFIG",
})
}

    // Store OTP request in database for tracking
    const otpRecord = await CustomerOTP.createOTP(
    res.json({
      success: true,
      config,
      message: "Firebase client configuration is complete",
    })
  } catch (error) {
    console.error("❌ Firebase config error:", error)
    res.status(500).json({
      error: "Failed to get Firebase configuration",
      details: error.message,
      code: "CONFIG_ERROR",
    })
  }
})

// Send OTP endpoint (for logging purposes - actual SMS sent by Firebase client SDK)
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, purpose = "registration" } = req.body
    const { storeId, tenantId } = req.storeContext

    console.log(`📱 Firebase OTP request received:`, {
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
      storeId,
      tenantId,
      timestamp: new Date().toISOString(),
    })

    console.log(`✅ OTP request logged for ${phone}`)
    if (!phone) {
      return res.status(400).json({
        error: "Phone number is required",
        code: "PHONE_REQUIRED",
      })
    }

    // Log the request (actual SMS is sent by Firebase client SDK)
    console.log(`🔥 Firebase client SDK will send OTP to: ${phone}`)

res.json({
success: true,
      message: "Ready for Firebase phone authentication. Use Firebase client SDK to send OTP.",
      phone: phone,
      purpose: purpose,
      method: "firebase_client_direct",
      message: "OTP request processed. Firebase will send SMS directly.",
      phone,
      purpose,
      method: "firebase_client_sdk",
provider: "firebase",
expiresIn: "10 minutes",
      otpId: otpRecord._id,
      instructions: "Use Firebase signInWithPhoneNumber() on client side to send real SMS",
      timestamp: new Date().toISOString(),
})
} catch (error) {
    console.error("❌ Firebase OTP request error:", error)
    console.error("❌ Firebase OTP send error:", error)
res.status(500).json({
error: "Failed to process OTP request",
details: error.message,
      code: "OTP_INIT_ERROR",
      code: "OTP_SEND_FAILED",
})
}
})

// Verify Firebase ID token (after client-side OTP verification)
// Verify OTP endpoint
router.post("/verify-otp", async (req, res) => {
try {
    const { phone, firebaseIdToken, purpose = "login", name, email, rememberMe } = req.body
    const { phone, firebaseIdToken, purpose = "registration", name, email } = req.body
    const { storeId, tenantId } = req.storeContext

    console.log(`🔍 Firebase token verification for store: ${req.storeId}, phone: ${phone}`)
    console.log(`🔥 Firebase ID token received: ${firebaseIdToken ? "Yes" : "No"}`)
    console.log(`🎯 Purpose: ${purpose}`)
    console.log(`🔍 Firebase OTP verification started:`, {
      phone,
      purpose,
      storeId,
      tenantId,
      hasIdToken: !!firebaseIdToken,
      timestamp: new Date().toISOString(),
    })

    // Validation
    // Validate required fields
if (!phone || !firebaseIdToken) {
      console.log("❌ Missing required fields:", { phone: !!phone, firebaseIdToken: !!firebaseIdToken })
return res.status(400).json({
error: "Phone number and Firebase ID token are required",
code: "MISSING_CREDENTIALS",
        hint: "Use Firebase client SDK to verify OTP and get ID token first",
})
}

// Verify Firebase ID token
    const auth = getFirebaseAuth()
    console.log("🔥 Verifying Firebase ID token...")
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
      decodedToken = await admin.auth().verifyIdToken(firebaseIdToken)
      console.log("✅ Firebase ID token verified:", {
        uid: decodedToken.uid,
        phone_number: decodedToken.phone_number,
        firebase_phone: decodedToken.firebase?.identities?.phone?.[0],
      })
    } catch (firebaseError) {
      console.error("❌ Firebase token verification failed:", firebaseError)
      return res.status(401).json({
        error: "Invalid Firebase ID token",
        details: firebaseError.message,
        code: "INVALID_FIREBASE_TOKEN",
})
}

// Verify phone number matches
    if (decodedToken.phone_number !== phone) {
      console.error("❌ Phone number mismatch:", {
        tokenPhone: decodedToken.phone_number,
        requestPhone: phone,
      })
    const tokenPhone = decodedToken.phone_number || decodedToken.firebase?.identities?.phone?.[0]
    if (tokenPhone !== phone) {
      console.log("❌ Phone number mismatch:", { tokenPhone, requestPhone: phone })
return res.status(400).json({
        error: "Phone number mismatch between token and request",
        error: "Phone number does not match Firebase token",
code: "PHONE_MISMATCH",
})
}

    console.log(`✅ Firebase phone verification successful for ${phone}`)

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    // Connect to tenant database
    console.log(`🔌 Connecting to tenant database: ${tenantId}`)
    await connectTenantDB(tenantId)

    // Find existing customer in local database
    let customer = await Customer.findOne({ phone: phone })
    // Check if customer exists
    console.log(`🔍 Searching for existing customer with phone: ${phone}`)
    let customer = await Customer.findOne({ phone })
let isNewCustomer = false
let accountStatus = "existing"

    console.log(`🔍 Searching for existing customer with phone: ${phone}`)

    if (!customer) {
      // Create new customer account
      console.log(`👤 No existing customer found for ${phone}, creating new account...`)

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
    if (customer) {
      console.log("✅ Existing customer found:", {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        totalOrders: customer.totalOrders,
        totalSpent: customer.totalSpent,
        tier: customer.tier,
        createdAt: customer.createdAt,
})

      await customer.save()
      isNewCustomer = true
      accountStatus = "created"
      console.log(`✅ New customer account created for ${phone} with ID: ${customer._id}`)
    } else {
      // Update existing customer
      console.log(`👤 Found existing customer for ${phone} with ID: ${customer._id}`)
      console.log(`📊 Customer stats - Orders: ${customer.totalOrders}, Spent: ₹${customer.totalSpent}`)

      customer.phoneVerified = true
      customer.isVerified = true
      // Update existing customer with Firebase UID and last login
      customer.firebaseUid = decodedToken.uid
customer.lastLoginAt = new Date()

      // Update Firebase UID if not set
      if (!customer.firebaseUid) {
        customer.firebaseUid = decodedToken.uid
        console.log(`🔗 Updated Firebase UID for existing customer: ${customer._id}`)
      // Update name and email if provided and not already set
      if (name && (!customer.name || customer.name === "User")) {
        customer.name = name
}

      // Update name and email if provided
      if (name && name.trim() && name.trim() !== customer.name) {
        const oldName = customer.name
        customer.name = name.trim()
        console.log(`📝 Updated customer name from "${oldName}" to "${customer.name}"`)
      }

      if (email && email.trim() && email.trim() !== customer.email) {
        const oldEmail = customer.email
        customer.email = email.trim()
        customer.emailVerified = true
        console.log(`📧 Updated customer email from "${oldEmail}" to "${customer.email}"`)
      if (email && !customer.email) {
        customer.email = email
}

await customer.save()
      console.log("✅ Existing customer updated with Firebase UID and login time")
accountStatus = "existing"
      console.log(`✅ Existing customer updated and authenticated: ${phone}`)
    }
    } else {
      console.log("📝 Creating new customer account...")

    // Generate JWT token
    const token = customer.generateAuthToken(req.storeId, req.tenantId, rememberMe)
    const tokenExpiry = AuthUtils.formatTokenExpiry(token)
      // Create new customer
      customer = new Customer({
        name: name || "User",
        phone,
        email: email || "",
        firebaseUid: decodedToken.uid,
        isActive: true,
        totalOrders: 0,
        totalSpent: 0,
        tier: "bronze",
        createdAt: new Date(),
        lastLoginAt: new Date(),
      })

    // Create custom token for future Firebase operations
    let customToken = null
    try {
      const tokenResult = await createCustomToken(decodedToken.uid, {
        phone: phone,
        storeId: req.storeId,
        tenantId: req.tenantId,
        customerId: customer._id.toString(),
      await customer.save()
      console.log("✅ New customer created:", {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
})
      if (tokenResult.success) {
        customToken = tokenResult.token
      }
    } catch (error) {
      console.warn("⚠️ Failed to create custom token:", error.message)

      isNewCustomer = true
      accountStatus = "created"
}

    // Determine appropriate message based on account status
    let message
    if (isNewCustomer) {
      message = purpose === "registration" ? "Registration successful" : "Account created and login successful"
    } else {
      message = purpose === "registration" ? "Account already exists - Login successful" : "Login successful"
    // Generate JWT token
    const jwtPayload = {
      customerId: customer._id,
      phone: customer.phone,
      name: customer.name,
      storeId,
      tenantId,
      firebaseUid: decodedToken.uid,
}

    const response = {
      message: message,
    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: "30d" })
    console.log("✅ JWT token generated for customer:", customer._id)

    // Prepare response
    const responseData = {
      success: true,
      message: isNewCustomer ? "Account created and login successful" : "Login successful",
token,
customer: {
id: customer._id,
name: customer.name,
        email: customer.email,
phone: customer.phone,
        totalSpent: customer.totalSpent,
        email: customer.email,
totalOrders: customer.totalOrders,
        isVerified: customer.isVerified,
        phoneVerified: customer.phoneVerified,
        preferences: customer.preferences,
        tier: customer.tier, // Virtual field from Customer model
        totalSpent: customer.totalSpent,
        tier: customer.tier,
        isActive: customer.isActive,
createdAt: customer.createdAt,
lastLoginAt: customer.lastLoginAt,
},
      storeId: req.storeId,
      tenantId: req.tenantId,
      tokenInfo: tokenExpiry,
      expiresIn: rememberMe ? "365 days" : "90 days",
      authMethod: "firebase_phone_auth",
      firebaseUid: decodedToken.uid,
      firebaseCustomToken: customToken,
      isNewCustomer: isNewCustomer,
      accountStatus: accountStatus, // 'existing', 'created'
    }

    console.log(`✅ Firebase phone authentication successful`)
    console.log(`📊 Account Status: ${accountStatus}`)
    console.log(`👤 Customer ID: ${customer._id}`)
    console.log(`📱 Phone: ${customer.phone}`)
    console.log(`💰 Total Spent: ₹${customer.totalSpent}`)
    console.log(`📦 Total Orders: ${customer.totalOrders}`)

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
      isNewCustomer,
      accountStatus,
      storeId,
      tenantId,
      timestamp: new Date().toISOString(),
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
    console.log(`🎉 Firebase authentication successful:`, {
      customerId: customer._id,
      phone: customer.phone,
      accountStatus,
      isNewCustomer,
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
    res.json(responseData)
} catch (error) {
    console.error("❌ Firebase test error:", error)
    console.error("❌ Firebase OTP verification error:", error)
res.status(500).json({
      success: false,
      error: "Firebase Admin SDK test failed",
      error: "Firebase OTP verification failed",
details: error.message,
      code: "FIREBASE_TEST_FAILED",
      code: "VERIFICATION_FAILED",
})
}
})
