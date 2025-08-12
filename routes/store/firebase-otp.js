const express = require("express")
const admin = require("firebase-admin")
const jwt = require("jsonwebtoken")
const { connectTenantDB } = require("../../config/tenantDB")
const Customer = require("../../models/tenant/Customer")
const storeContext = require("../../middleware/storeContext")

const router = express.Router()

// Apply store context middleware
router.use(storeContext)

// Test Firebase connection
router.get("/test-firebase", async (req, res) => {
  try {
    console.log("🔥 Testing Firebase Admin SDK...")

    // Check if Firebase Admin is initialized
    if (!admin.apps.length) {
      return res.status(500).json({
        error: "Firebase Admin SDK not initialized",
        code: "FIREBASE_NOT_INITIALIZED",
      })
    }

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

    // Check if all required config is present
    const missingConfig = Object.entries(config)
      .filter(([key, value]) => !value)
      .map(([key]) => key)

    if (missingConfig.length > 0) {
      return res.status(400).json({
        error: "Missing Firebase configuration",
        missingConfig,
        code: "MISSING_CONFIG",
      })
    }

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
      purpose,
      storeId,
      tenantId,
      timestamp: new Date().toISOString(),
    })

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
      message: "OTP request processed. Firebase will send SMS directly.",
      phone,
      purpose,
      method: "firebase_client_sdk",
      provider: "firebase",
      expiresIn: "10 minutes",
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Firebase OTP send error:", error)
    res.status(500).json({
      error: "Failed to process OTP request",
      details: error.message,
      code: "OTP_SEND_FAILED",
    })
  }
})

// Verify OTP endpoint
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, firebaseIdToken, purpose = "registration", name, email } = req.body
    const { storeId, tenantId } = req.storeContext

    console.log(`🔍 Firebase OTP verification started:`, {
      phone,
      purpose,
      storeId,
      tenantId,
      hasIdToken: !!firebaseIdToken,
      timestamp: new Date().toISOString(),
    })

    // Validate required fields
    if (!phone || !firebaseIdToken) {
      console.log("❌ Missing required fields:", { phone: !!phone, firebaseIdToken: !!firebaseIdToken })
      return res.status(400).json({
        error: "Phone number and Firebase ID token are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    // Verify Firebase ID token
    console.log("🔥 Verifying Firebase ID token...")
    let decodedToken
    try {
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
    const tokenPhone = decodedToken.phone_number || decodedToken.firebase?.identities?.phone?.[0]
    if (tokenPhone !== phone) {
      console.log("❌ Phone number mismatch:", { tokenPhone, requestPhone: phone })
      return res.status(400).json({
        error: "Phone number does not match Firebase token",
        code: "PHONE_MISMATCH",
      })
    }

    // Connect to tenant database
    console.log(`🔌 Connecting to tenant database: ${tenantId}`)
    await connectTenantDB(tenantId)

    // Check if customer exists
    console.log(`🔍 Searching for existing customer with phone: ${phone}`)
    let customer = await Customer.findOne({ phone })
    let isNewCustomer = false
    let accountStatus = "existing"

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

      // Update existing customer with Firebase UID and last login
      customer.firebaseUid = decodedToken.uid
      customer.lastLoginAt = new Date()

      // Update name and email if provided and not already set
      if (name && (!customer.name || customer.name === "User")) {
        customer.name = name
      }
      if (email && !customer.email) {
        customer.email = email
      }

      await customer.save()
      console.log("✅ Existing customer updated with Firebase UID and login time")
      accountStatus = "existing"
    } else {
      console.log("📝 Creating new customer account...")

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

      await customer.save()
      console.log("✅ New customer created:", {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
      })

      isNewCustomer = true
      accountStatus = "created"
    }

    // Generate JWT token
    const jwtPayload = {
      customerId: customer._id,
      phone: customer.phone,
      name: customer.name,
      storeId,
      tenantId,
      firebaseUid: decodedToken.uid,
    }

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
        phone: customer.phone,
        email: customer.email,
        totalOrders: customer.totalOrders,
        totalSpent: customer.totalSpent,
        tier: customer.tier,
        isActive: customer.isActive,
        createdAt: customer.createdAt,
        lastLoginAt: customer.lastLoginAt,
      },
      isNewCustomer,
      accountStatus,
      storeId,
      tenantId,
      timestamp: new Date().toISOString(),
    }

    console.log(`🎉 Firebase authentication successful:`, {
      customerId: customer._id,
      phone: customer.phone,
      accountStatus,
      isNewCustomer,
    })

    res.json(responseData)
  } catch (error) {
    console.error("❌ Firebase OTP verification error:", error)
    res.status(500).json({
      error: "Firebase OTP verification failed",
      details: error.message,
      code: "VERIFICATION_FAILED",
    })
  }
})

module.exports = router
