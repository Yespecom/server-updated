export const createRecaptchaVerifier = (containerId = "recaptcha-container") => {
return new RecaptchaVerifier(auth, containerId, {
size: "invisible",
    callback: (response: any) => {
      console.log("✅ reCAPTCHA solved:", response.slice(0, 20) + "...")
    callback: (response: string) => {
      console.log("✅ reCAPTCHA solved:", response.substring(0, 20) + "...")
},
"expired-callback": () => {
console.log("❌ reCAPTCHA expired")
},
})
}

export { signInWithPhoneNumber }
export type { ConfirmationResult }
export { signInWithPhoneNumber, type ConfirmationResult }
