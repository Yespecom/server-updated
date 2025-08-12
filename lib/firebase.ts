import { initializeApp } from "firebase/app"
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Global variable to track current verifier
let currentVerifier: RecaptchaVerifier | null = null

// Create reCAPTCHA verifier with proper cleanup
export const createRecaptchaVerifier = (containerId = "recaptcha-container") => {
  // Clear any existing verifier
  if (currentVerifier) {
    try {
      currentVerifier.clear()
    } catch (error) {
      console.log("Previous verifier already cleared")
    }
    currentVerifier = null
  }

  // Clear the container
  const container = document.getElementById(containerId)
  if (container) {
    container.innerHTML = ""
  }

  // Create new verifier
  currentVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    callback: (response: string) => {
      console.log("✅ reCAPTCHA solved:", response.substring(0, 20) + "...")
    },
    "expired-callback": () => {
      console.log("❌ reCAPTCHA expired")
    },
  })

  return currentVerifier
}

// Clear current verifier
export const clearRecaptchaVerifier = () => {
  if (currentVerifier) {
    try {
      currentVerifier.clear()
    } catch (error) {
      console.log("Verifier already cleared")
    }
    currentVerifier = null
  }
}

export { signInWithPhoneNumber, type ConfirmationResult }
