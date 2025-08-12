const express = require("express")
const User = require("../models/User")
const OTP = require("../models/OTP")
const { sendOTPEmail } = require("../config/email")
const { getTenantDB } = require("../config/tenantDB")
const AuthUtils = require("../utils/auth")
const router = express.Router()

// Apply rate limiting
router.use(AuthUtils.passwordResetRateLimit)

// Request password reset
router.post("/request", async (req, res) => {
  try {
    const { email } = req.body

    console.log(`🔐 Password reset request for: ${email}`)

    if (!email || !AuthUtils.validateEmail(email)) {
      return res.status(400).json({
        error: "Valid email address is required",
        code: "INVALID_EMAIL",
      })
    }

    // Check if user exists
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })

    // Always return success for security (don't reveal if email exists)
    const successResponse = {
      message: "If an account with this email exists, a password reset code has been sent.",
      email,
    }

    if (!user) {
      console.log(`❌ User not found for password reset: ${email}`)
      return res.json(successResponse)
    }

    // Generate and send OTP
    const otp = await OTP.createOTP(email, "password_reset", AuthUtils.extractClientInfo(req))
    await sendOTPEmail(email, otp, "password reset")

    console.log(`🔐 Password reset OTP sent for ${email}`)

    res.json(successResponse)
  } catch (error) {
    console.error("❌ Password reset request error:", error)
    res.status(500).json({
      error: "Password reset request failed",
      details: error.message,
      code: "PASSWORD_RESET_REQUEST_ERROR",
    })
  }
})

// Verify reset OTP
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body

    console.log(`🔍 Verifying reset OTP for: ${email}`)

    if (!email || !otp) {
      return res.status(400).json({
        error: "Email and OTP are required",
        code: "MISSING_FIELDS",
      })
    }

    // Check OTP without consuming it
    const otpCheck = await OTP.checkOTP(email, otp, "password_reset")

    if (!otpCheck.success) {
      return res.status(400).json({
        error: otpCheck.message,
        code: otpCheck.code,
      })
    }

    // Check if user still exists
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    console.log(`✅ Password reset OTP verified for ${email}`)

    res.json({
      message: "OTP verified successfully. You can now reset your password.",
      verified: true,
      email,
    })
  } catch (error) {
    console.error("❌ Verify reset OTP error:", error)
    res.status(500).json({
      error: "OTP verification failed",
      details: error.message,
      code: "OTP_VERIFICATION_ERROR",
    })
  }
})

// Reset password
router.post("/reset", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body

    console.log(`🔐 Password reset attempt for: ${email}`)

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        error: "Email, OTP, and new password are required",
        code: "MISSING_FIELDS",
      })
    }

    // Validate new password
    const passwordValidation = AuthUtils.validatePassword(newPassword)
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        error: "Password validation failed",
        details: passwordValidation.errors,
        code: "INVALID_PASSWORD",
      })
    }

    // Verify and consume OTP
    const otpVerification = await OTP.verifyOTP(email, otp, "password_reset")
    if (!otpVerification.success) {
      return res.status(400).json({
        error: otpVerification.message,
        code: otpVerification.code,
      })
    }

    // Find user in main DB
    const mainUser = await User.findOne({ email: email.toLowerCase(), isActive: true })
    if (!mainUser) {
      console.log(`❌ User not found in main DB: ${email}`)
      return res.status(404).json({
        error: "User not found",
        code: "USER_NOT_FOUND",
      })
    }

    console.log(`👤 Found user in main DB: ${email}, tenantId: ${mainUser.tenantId}`)

    // Update password in main DB
    mainUser.password = newPassword // Will be hashed by pre-save middleware
    mainUser.passwordChangedAt = new Date()
    await mainUser.save()
    console.log(`✅ Password updated in main DB for ${email}`)

    // Update password in tenant DB as well
    try {
      const tenantDB = await getTenantDB(mainUser.tenantId)
      const TenantUser = require("../models/tenant/User")(tenantDB)
      const tenantUser = await TenantUser.findOne({ email: email.toLowerCase() })

      if (tenantUser) {
        tenantUser.password = newPassword // Will be hashed by pre-save middleware
        tenantUser.passwordChangedAt = new Date()
        await tenantUser.save()
        console.log(`✅ Password updated in tenant DB for ${email}`)
      } else {
        console.log(`⚠️ Tenant user not found for ${email}`)
      }
    } catch (tenantError) {
      console.error("❌ Error updating tenant password:", tenantError)
      // Don't fail the request if tenant update fails
    }

    console.log(`✅ Password reset completed for ${email}`)

    res.json({
      message: "Password reset successfully. You can now login with your new password.",
      success: true,
    })
  } catch (error) {
    console.error("❌ Reset password error:", error)
    res.status(500).json({
      error: "Password reset failed",
      details: error.message,
      code: "PASSWORD_RESET_FAILED",
    })
  }
})

module.exports = router
