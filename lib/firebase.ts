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
    callback: (response: any) => {
      console.log("✅ reCAPTCHA solved:", response.slice(0, 20) + "...")
    },
    "expired-callback": () => {
      console.log("❌ reCAPTCHA expired")
    },
  })
}

export { signInWithPhoneNumber }
export type { ConfirmationResult }
