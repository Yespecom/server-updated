const express = require("express")
const recaptchaConfig = require("../config/recaptcha")
const { recaptchaMiddleware } = require("../middleware/recaptcha")
const router = express.Router()

// Get reCAPTCHA configuration for frontend
router.get("/config", (req, res) => {
  try {
    const { version } = req.query

    if (version && !["v2", "v3"].includes(version)) {
      return res.status(400).json({
        error: "Invalid version. Must be 'v2' or 'v3'",
        code: "INVALID_VERSION",
      })
    }

    const config = {
      enabled: recaptchaConfig.enableRecaptcha,
      environment: process.env.NODE_ENV,
    }

    // Add version-specific config
    if (!version || version === "v2") {
      config.v2 = {
        enabled: recaptchaConfig.isConfigured("v2"),
        siteKey: recaptchaConfig.getSiteKey("v2"),
      }
    }

    if (!version || version === "v3") {
      config.v3 = {
        enabled: recaptchaConfig.isConfigured("v3"),
        siteKey: recaptchaConfig.getSiteKey("v3"),
        scoreThreshold: recaptchaConfig.v3ScoreThreshold,
      }
    }

    res.json(config)
  } catch (error) {
    console.error("❌ reCAPTCHA config error:", error)
    res.status(500).json({
      error: "Failed to get reCAPTCHA configuration",
      code: "CONFIG_ERROR",
    })
  }
})

// Get reCAPTCHA status (admin endpoint)
router.get("/status", (req, res) => {
  try {
    const status = recaptchaConfig.getStatus()
    res.json(status)
  } catch (error) {
    console.error("❌ reCAPTCHA status error:", error)
    res.status(500).json({
      error: "Failed to get reCAPTCHA status",
      code: "STATUS_ERROR",
    })
  }
})

// Test reCAPTCHA verification endpoint
router.post("/verify", async (req, res) => {
  try {
    const { token, version = "v3", action = "test" } = req.body

    if (!token) {
      return res.status(400).json({
        error: "reCAPTCHA token is required",
        code: "MISSING_TOKEN",
      })
    }

    if (!["v2", "v3"].includes(version)) {
      return res.status(400).json({
        error: "Invalid version. Must be 'v2' or 'v3'",
        code: "INVALID_VERSION",
      })
    }

    const remoteIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress
    const result = await recaptchaConfig.verifyToken(token, version, action, remoteIp)

    res.json({
      ...result,
      timestamp: new Date().toISOString(),
      clientIp: remoteIp,
    })
  } catch (error) {
    console.error("❌ reCAPTCHA verify error:", error)
    res.status(500).json({
      error: "reCAPTCHA verification failed",
      code: "VERIFY_ERROR",
      details: error.message,
    })
  }
})

// Test middleware endpoint
router.post("/test-middleware", recaptchaMiddleware.v3.login, (req, res) => {
  res.json({
    message: "reCAPTCHA middleware test successful",
    recaptcha: req.recaptcha,
    timestamp: new Date().toISOString(),
  })
})

// Batch verification endpoint (for multiple tokens)
router.post("/verify-batch", async (req, res) => {
  try {
    const { tokens } = req.body

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: "Tokens array is required",
        code: "MISSING_TOKENS",
      })
    }

    if (tokens.length > 10) {
      return res.status(400).json({
        error: "Maximum 10 tokens allowed per batch",
        code: "TOO_MANY_TOKENS",
      })
    }

    const remoteIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress
    const results = []

    for (const tokenData of tokens) {
      const { token, version = "v3", action = "batch" } = tokenData

      if (!token) {
        results.push({
          success: false,
          error: "Token is required",
          code: "MISSING_TOKEN",
        })
        continue
      }

      try {
        const result = await recaptchaConfig.verifyToken(token, version, action, remoteIp)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          error: "Verification failed",
          code: "VERIFY_ERROR",
          details: error.message,
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failureCount = results.length - successCount

    res.json({
      results,
      summary: {
        total: results.length,
        successful: successCount,
        failed: failureCount,
        successRate: (successCount / results.length) * 100,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ reCAPTCHA batch verify error:", error)
    res.status(500).json({
      error: "Batch verification failed",
      code: "BATCH_VERIFY_ERROR",
      details: error.message,
    })
  }
})

module.exports = router
