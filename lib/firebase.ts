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

// Create reCAPTCHA verifier
export const createRecaptchaVerifier = (containerId = "recaptcha-container") => {
  return new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    callback: (response: string) => {
      console.log("✅ reCAPTCHA v3 solved:", response.substring(0, 20) + "...")
    },
    "expired-callback": () => {
      console.log("❌ reCAPTCHA v3 expired")
    },
    // Force v3 parameters
    "recaptcha-parameters": {
      sitekey: process.env.NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY || process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
      size: "invisible",
      badge: "bottomright",
    },
  })
}

export { signInWithPhoneNumber, type ConfirmationResult }
