const { initializeApp } = require("firebase/app")
const {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
} = require("firebase/auth")

// Firebase web configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

let firebaseApp = null
let auth = null

// Initialize Firebase client app
const initializeFirebaseClient = () => {
  try {
    if (firebaseApp) {
      console.log("♻️ Firebase client already initialized")
      return firebaseApp
    }

    console.log("🔥 Initializing Firebase client SDK...")

    // Validate required configuration
    const requiredFields = ["apiKey", "authDomain", "projectId"]
    const missingFields = requiredFields.filter((field) => !firebaseConfig[field])

    if (missingFields.length > 0) {
      console.error(`❌ Missing Firebase client configuration: ${missingFields.join(", ")}`)
      return null
    }

    firebaseApp = initializeApp(firebaseConfig)
    auth = getAuth(firebaseApp)

    console.log("✅ Firebase client SDK initialized successfully")
    return firebaseApp
  } catch (error) {
    console.error("❌ Firebase client initialization error:", error)
    return null
  }
}

// Get Firebase Auth instance
const getFirebaseClientAuth = () => {
  if (!auth) {
    initializeFirebaseClient()
  }
  return auth
}

// Send OTP to phone number
const sendOTPToPhone = async (phoneNumber, recaptchaVerifier) => {
  try {
    console.log(`📱 Sending OTP to phone: ${phoneNumber}`)

    const auth = getFirebaseClientAuth()
    if (!auth) {
      throw new Error("Firebase client not initialized")
    }

    const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier)

    console.log("✅ OTP sent successfully")
    return {
      success: true,
      verificationId: confirmationResult.verificationId,
      confirmationResult,
    }
  } catch (error) {
    console.error("❌ Error sending OTP:", error)
    return {
      success: false,
      error: error.message,
      code: error.code,
    }
  }
}

// Verify OTP code
const verifyOTPCode = async (verificationId, otpCode) => {
  try {
    console.log(`🔍 Verifying OTP code: ${otpCode}`)

    const auth = getFirebaseClientAuth()
    if (!auth) {
      throw new Error("Firebase client not initialized")
    }

    const credential = PhoneAuthProvider.credential(verificationId, otpCode)
    const result = await signInWithCredential(auth, credential)

    console.log("✅ OTP verified successfully")
    return {
      success: true,
      user: result.user,
      phoneNumber: result.user.phoneNumber,
      uid: result.user.uid,
    }
  } catch (error) {
    console.error("❌ Error verifying OTP:", error)
    return {
      success: false,
      error: error.message,
      code: error.code,
    }
  }
}

// Create reCAPTCHA verifier
const createRecaptchaVerifier = (containerId = "recaptcha-container") => {
  try {
    const auth = getFirebaseClientAuth()
    if (!auth) {
      throw new Error("Firebase client not initialized")
    }

    const recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "invisible",
      callback: (response) => {
        console.log("✅ reCAPTCHA solved")
      },
      "expired-callback": () => {
        console.log("❌ reCAPTCHA expired")
      },
    })

    return recaptchaVerifier
  } catch (error) {
    console.error("❌ Error creating reCAPTCHA verifier:", error)
    return null
  }
}

// Check if Firebase client is configured
const isFirebaseClientConfigured = () => {
  const requiredEnvVars = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  ]
  const configured = requiredEnvVars.every((envVar) => process.env[envVar])

  console.log("🔍 Firebase client configuration status:", {
    configured,
    hasApiKey: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    hasAuthDomain: !!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    hasProjectId: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  })

  return configured
}

module.exports = {
  initializeFirebaseClient,
  getFirebaseClientAuth,
  sendOTPToPhone,
  verifyOTPCode,
  createRecaptchaVerifier,
  isFirebaseClientConfigured,
  firebaseConfig,
}
