const express = require("express")
const admin = require("firebase-admin")
const jwt = require("jsonwebtoken")
const Customer = require("../../models/tenant/Customer")
const { connectTenantDB } = require("../../config/tenantDB")

const router = express.Router()

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  })
}

// Test Firebase connection
router.get("/test-firebase", async (req, res) => {
  try {
    const testToken = "test-token"
    console.log("🔥 Testing Firebase Admin SDK...")

    // Try to verify a dummy token (this will fail but shows Firebase is connected)
    try {
      await admin.auth().verifyIdToken(testToken)
    } catch (error) {
      if (error.code === "auth/argument-error") {
        console.log("✅ Firebase Admin SDK is properly initialized")
        return res.json({
          success: true,
          message: "Firebase Admin SDK is working",
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.substring(0, 20) + "...",
        })
      }
      throw error
    }
  } catch (error) {
    console.error("❌ Firebase Admin SDK error:", error)
    res.status(500).json({
      success: false,
      error: "Firebase Admin SDK not properly configured",
      details: error.message,
    })
  }
})

// Get Firebase client configuration
router.get("/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? "✅ Set" : "❌ Missing",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ? "✅ Set" : "❌ Missing",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? "✅ Set" : "❌ Missing",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ? "✅ Set" : "❌ Missing",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ? "✅ Set" : "❌ Missing",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? "✅ Set" : "❌ Missing",
  })
})

// Send OTP endpoint (Firebase client handles this)
router.post("/send-otp", async (req, res) => {
  try {
    const { phone, purpose } = req.body

    console.log(`📱 OTP request received for ${purpose}:`, phone)

    // This endpoint is just for logging - Firebase client SDK handles actual SMS sending
    res.json({
      success: true,
      message: "OTP request processed. Firebase will send SMS directly.",
      phone,
      purpose,
      method: "firebase_client_sdk",
      provider: "firebase",
      expiresIn: "10 minutes",
    })
  } catch (error) {
    console.error("❌ Error processing OTP request:", error)
    res.status(500).json({
      success: false,
      error: "Failed to process OTP request",
      details: error.message,
    })
  }
})

// Verify OTP endpoint
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, firebaseIdToken, purpose, name, email } = req.body
    const storeId = req.storeId

    console.log(`🔍 Verifying Firebase OTP for ${purpose}:`, phone)

    if (!phone || !firebaseIdToken) {
      return res.status(400).json({
        success: false,
        error: "Phone number and Firebase ID token are required",
        code: "MISSING_CREDENTIALS",
      })
    }

    // Verify Firebase ID token
    console.log("🔥 Verifying Firebase ID token...")
    let decodedToken
    try {
      decodedToken = await admin.auth().verifyIdToken(firebaseIdToken)
      console.log("✅ Firebase ID token verified:", decodedToken.uid)
    } catch (error) {
      console.error("❌ Firebase token verification failed:", error)
      return res.status(401).json({
        success: false,
        error: "Invalid Firebase ID token",
        code: "INVALID_TOKEN",
      })
    }

    // Check if phone number matches
    if (decodedToken.phone_number !== phone) {
      console.error("❌ Phone number mismatch:", {
        tokenPhone: decodedToken.phone_number,
        requestPhone: phone,
      })
      return res.status(400).json({
        success: false,
        error: "Phone number does not match Firebase token",
        code: "PHONE_MISMATCH",
      })
    }

    // Connect to tenant database
    console.log("🔌 Connecting to tenant database...")
    const tenantDB = await connectTenantDB(storeId)
    const CustomerModel = tenantDB.model("Customer", Customer.schema)

    // Check if customer exists
    console.log("👤 Searching for existing customer...")
    let customer = await CustomerModel.findOne({ phone })

    let isNewCustomer = false
    let accountStatus = "existing"

    if (customer) {
      console.log("✅ Existing customer found:", {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
        totalOrders: customer.totalOrders,
        totalSpent: customer.totalSpent,
      })

      // Update existing customer
      customer.firebaseUID = decodedToken.uid
      customer.lastLogin = new Date()
      if (name && name !== "User") customer.name = name
      if (email) customer.email = email
      await customer.save()

      accountStatus = "existing"
    } else {
      console.log("🆕 Creating new customer account...")

      // Create new customer
      customer = new CustomerModel({
        name: name || "User",
        phone,
        email: email || "",
        firebaseUID: decodedToken.uid,
        isActive: true,
        totalOrders: 0,
        totalSpent: 0,
        tier: "bronze",
        createdAt: new Date(),
        lastLogin: new Date(),
      })

      await customer.save()
      isNewCustomer = true
      accountStatus = "created"

      console.log("✅ New customer created:", {
        id: customer._id,
        name: customer.name,
        phone: customer.phone,
      })
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        customerId: customer._id,
        phone: customer.phone,
        storeId,
        firebaseUID: decodedToken.uid,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    )

    console.log(`✅ ${purpose} successful for:`, customer.phone)

    res.json({
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
        lastLogin: customer.lastLogin,
      },
      isNewCustomer,
      accountStatus,
      storeId,
      tenantId: `tenant_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    })
  } catch (error) {
    console.error("❌ Error verifying Firebase OTP:", error)
    res.status(500).json({
      success: false,
      error: "Failed to verify OTP",
      details: error.message,
    })
  }
})

module.exports = router
