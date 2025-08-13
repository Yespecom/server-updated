const express = require("express")
const recaptchaConfig = require("../config/recaptcha")
const router = express.Router()

// Get reCAPTCHA configuration for frontend
router.get("/config", (req, res) => {
  try {
    const config = recaptchaConfig.getClientConfig()

    console.log("📋 reCAPTCHA config requested")

    res.json({
      success: true,
      config,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ reCAPTCHA config error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get reCAPTCHA configuration",
      details: error.message,
    })
  }
})

// Get reCAPTCHA status (for monitoring)
router.get("/status", (req, res) => {
  try {
    const status = recaptchaConfig.getStatus()

    console.log("📊 reCAPTCHA status requested")

    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ reCAPTCHA status error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get reCAPTCHA status",
      details: error.message,
    })
  }
})

// Test reCAPTCHA verification endpoint
router.post("/verify", async (req, res) => {
  try {
    const { token, version = "v3", action = null } = req.body

    console.log(`🧪 reCAPTCHA test verification: ${version}, action: ${action}`)

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Token is required for verification test",
        code: "MISSING_TOKEN",
      })
    }

    // Get client IP
    const remoteIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress

    // Verify the token
    const result = await recaptchaConfig.verifyToken(token, version, action, remoteIp)

    res.json({
      success: result.success,
      result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ reCAPTCHA verification test error:", error)
    res.status(500).json({
      success: false,
      error: "reCAPTCHA verification test failed",
      details: error.message,
    })
  }
})

module.exports = router
