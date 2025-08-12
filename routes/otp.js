const express = require("express")
const OTP = require("../models/OTP")
const AuthUtils = require("../utils/auth")
const router = express.Router()

// Apply rate limiting
router.use(AuthUtils.otpRateLimit)

// Get OTP status for debugging
router.get("/status/:email/:purpose", async (req, res) => {
  try {
    const { email, purpose } = req.params
    console.log(`🔍 Getting OTP status for ${email} (${purpose})`)

    const status = await OTP.getOTPStatus(email, purpose)

    res.json({
      email,
      purpose,
      ...status,
    })
  } catch (error) {
    console.error("❌ OTP status error:", error)
    res.status(500).json({
      error: "Failed to get OTP status",
      details: error.message,
    })
  }
})

// Request new OTP
router.post("/request", async (req, res) => {
  try {
    const { email, purpose } = req.body

    if (!email || !purpose) {
      return res.status(400).json({
        error: "Email and purpose are required",
        code: "MISSING_FIELDS",
      })
    }

    if (!AuthUtils.validateEmail(email)) {
      return res.status(400).json({
        error: "Invalid email address",
        code: "INVALID_EMAIL",
      })
    }

    if (!["registration", "password_reset", "login"].includes(purpose)) {
      return res.status(400).json({
        error: "Invalid purpose",
        code: "INVALID_PURPOSE",
      })
    }

    console.log(`🔢 OTP request for ${email} (${purpose})`)

    // Generate and send OTP
    const otp = await OTP.createOTP(email, purpose, AuthUtils.extractClientInfo(req))

    // In a real app, you'd send this via email/SMS
    // For now, we'll just log it
    console.log(`📧 OTP for ${email}: ${otp}`)

    res.json({
      message: "OTP sent successfully",
      email,
      purpose,
      expiresIn: "10 minutes",
    })
  } catch (error) {
    console.error("❌ OTP request error:", error)
    res.status(500).json({
      error: "Failed to send OTP",
      details: error.message,
      code: "OTP_REQUEST_ERROR",
    })
  }
})

// Verify OTP
router.post("/verify", async (req, res) => {
  try {
    const { email, otp, purpose } = req.body

    if (!email || !otp || !purpose) {
      return res.status(400).json({
        error: "Email, OTP, and purpose are required",
        code: "MISSING_FIELDS",
      })
    }

    console.log(`🔍 OTP verification for ${email} (${purpose}): ${otp}`)

    const verification = await OTP.verifyOTP(email, otp, purpose)

    if (!verification.success) {
      return res.status(400).json({
        error: verification.message,
        code: verification.code,
      })
    }

    res.json({
      message: "OTP verified successfully",
      success: true,
      email,
      purpose,
    })
  } catch (error) {
    console.error("❌ OTP verification error:", error)
    res.status(500).json({
      error: "OTP verification failed",
      details: error.message,
      code: "OTP_VERIFICATION_ERROR",
    })
  }
})

// Check OTP without consuming it
router.post("/check", async (req, res) => {
  try {
    const { email, otp, purpose } = req.body

    if (!email || !otp || !purpose) {
      return res.status(400).json({
        error: "Email, OTP, and purpose are required",
        code: "MISSING_FIELDS",
      })
    }

    console.log(`🔍 OTP check for ${email} (${purpose}): ${otp}`)

    const check = await OTP.checkOTP(email, otp, purpose)

    if (!check.success) {
      return res.status(400).json({
        error: check.message,
        code: check.code,
      })
    }

    res.json({
      message: "OTP is valid",
      valid: true,
      email,
      purpose,
    })
  } catch (error) {
    console.error("❌ OTP check error:", error)
    res.status(500).json({
      error: "OTP check failed",
      details: error.message,
      code: "OTP_CHECK_ERROR",
    })
  }
})

module.exports = router
