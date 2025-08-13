const fetch = require("node-fetch")

class RecaptchaConfig {
  constructor() {
    // reCAPTCHA v2 configuration
    this.v2SiteKey = process.env.RECAPTCHA_V2_SITE_KEY
    this.v2SecretKey = process.env.RECAPTCHA_V2_SECRET_KEY

    // reCAPTCHA v3 configuration
    this.v3SiteKey = process.env.RECAPTCHA_V3_SITE_KEY
    this.v3SecretKey = process.env.RECAPTCHA_V3_SECRET_KEY

    // Default score threshold for v3
    this.v3ScoreThreshold = Number.parseFloat(process.env.RECAPTCHA_V3_SCORE_THRESHOLD) || 0.5

    // Verification URL
    this.verifyUrl = "https://www.google.com/recaptcha/api/siteverify"

    // Environment check
    this.isProduction = process.env.NODE_ENV === "production"
    this.enableRecaptcha = process.env.ENABLE_RECAPTCHA === "true" || this.isProduction
  }

  // Check if reCAPTCHA is properly configured
  isConfigured(version = "v3") {
    if (!this.enableRecaptcha) {
      console.log("🔒 reCAPTCHA is disabled in current environment")
      return false
    }

    if (version === "v2") {
      const configured = !!(this.v2SiteKey && this.v2SecretKey)
      if (!configured) {
        console.warn("⚠️ reCAPTCHA v2 is not properly configured")
        console.warn("Missing environment variables: RECAPTCHA_V2_SITE_KEY, RECAPTCHA_V2_SECRET_KEY")
      }
      return configured
    }

    if (version === "v3") {
      const configured = !!(this.v3SiteKey && this.v3SecretKey)
      if (!configured) {
        console.warn("⚠️ reCAPTCHA v3 is not properly configured")
        console.warn("Missing environment variables: RECAPTCHA_V3_SITE_KEY, RECAPTCHA_V3_SECRET_KEY")
      }
      return configured
    }

    return false
  }

  // Get site key for frontend
  getSiteKey(version = "v3") {
    if (version === "v2") return this.v2SiteKey
    if (version === "v3") return this.v3SiteKey
    return null
  }

  // Get secret key for backend verification
  getSecretKey(version = "v3") {
    if (version === "v2") return this.v2SecretKey
    if (version === "v3") return this.v3SecretKey
    return null
  }

  // Verify reCAPTCHA token
  async verifyToken(token, version = "v3", expectedAction = null, remoteIp = null) {
    try {
      if (!this.enableRecaptcha) {
        console.log("🔒 reCAPTCHA verification skipped (disabled)")
        return {
          success: true,
          score: 1.0,
          action: expectedAction,
          message: "reCAPTCHA disabled in current environment",
          skipped: true,
        }
      }

      if (!token) {
        console.log("❌ reCAPTCHA token is missing")
        return {
          success: false,
          error: "reCAPTCHA token is required",
          code: "MISSING_TOKEN",
        }
      }

      if (!this.isConfigured(version)) {
        console.error(`❌ reCAPTCHA ${version} is not configured`)
        return {
          success: false,
          error: `reCAPTCHA ${version} is not properly configured`,
          code: "NOT_CONFIGURED",
        }
      }

      const secretKey = this.getSecretKey(version)
      console.log(`🔍 Verifying reCAPTCHA ${version} token...`)

      // Prepare request body
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      })

      if (remoteIp) {
        params.append("remoteip", remoteIp)
      }

      // Make request to Google's verification API
      const response = await fetch(this.verifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      })

      if (!response.ok) {
        console.error(`❌ reCAPTCHA API request failed: ${response.status}`)
        return {
          success: false,
          error: "reCAPTCHA verification service unavailable",
          code: "SERVICE_UNAVAILABLE",
        }
      }

      const data = await response.json()
      console.log(`🔍 reCAPTCHA ${version} response:`, {
        success: data.success,
        score: data.score,
        action: data.action,
        hostname: data.hostname,
        errorCodes: data["error-codes"],
      })

      // Handle verification errors
      if (!data.success) {
        const errorCodes = data["error-codes"] || []
        console.error(`❌ reCAPTCHA verification failed:`, errorCodes)

        return {
          success: false,
          error: "reCAPTCHA verification failed",
          code: "VERIFICATION_FAILED",
          errorCodes,
          details: this.getErrorMessage(errorCodes),
        }
      }

      // Version-specific validation
      if (version === "v3") {
        return this.validateV3Response(data, expectedAction)
      } else if (version === "v2") {
        return this.validateV2Response(data)
      }

      return {
        success: false,
        error: "Unsupported reCAPTCHA version",
        code: "UNSUPPORTED_VERSION",
      }
    } catch (error) {
      console.error("❌ reCAPTCHA verification error:", error)
      return {
        success: false,
        error: "reCAPTCHA verification failed",
        code: "VERIFICATION_ERROR",
        details: error.message,
      }
    }
  }

  // Validate reCAPTCHA v3 response
  validateV3Response(data, expectedAction) {
    const { score, action } = data

    // Check score threshold
    if (typeof score !== "number" || score < this.v3ScoreThreshold) {
      console.log(`❌ reCAPTCHA v3 score too low: ${score} (threshold: ${this.v3ScoreThreshold})`)
      return {
        success: false,
        score,
        action,
        error: "reCAPTCHA score too low",
        code: "LOW_SCORE",
        threshold: this.v3ScoreThreshold,
      }
    }

    // Check action if specified
    if (expectedAction && action !== expectedAction) {
      console.log(`❌ reCAPTCHA v3 action mismatch: expected '${expectedAction}', got '${action}'`)
      return {
        success: false,
        score,
        action,
        error: "reCAPTCHA action mismatch",
        code: "ACTION_MISMATCH",
        expected: expectedAction,
      }
    }

    console.log(`✅ reCAPTCHA v3 verification successful: score=${score}, action=${action}`)
    return {
      success: true,
      score,
      action,
      message: "reCAPTCHA v3 verification successful",
    }
  }

  // Validate reCAPTCHA v2 response
  validateV2Response(data) {
    console.log("✅ reCAPTCHA v2 verification successful")
    return {
      success: true,
      message: "reCAPTCHA v2 verification successful",
      challengeTs: data.challenge_ts,
      hostname: data.hostname,
    }
  }

  // Get human-readable error messages
  getErrorMessage(errorCodes) {
    const messages = {
      "missing-input-secret": "The secret parameter is missing",
      "invalid-input-secret": "The secret parameter is invalid or malformed",
      "missing-input-response": "The response parameter is missing",
      "invalid-input-response": "The response parameter is invalid or malformed",
      "bad-request": "The request is invalid or malformed",
      "timeout-or-duplicate": "The response is no longer valid: either is too old or has been used previously",
    }

    return errorCodes.map((code) => messages[code] || `Unknown error: ${code}`).join(", ")
  }

  // Get configuration status
  getStatus() {
    return {
      enabled: this.enableRecaptcha,
      environment: this.isProduction ? "production" : "development",
      v2: {
        configured: this.isConfigured("v2"),
        siteKey: this.v2SiteKey ? `${this.v2SiteKey.substring(0, 10)}...` : null,
      },
      v3: {
        configured: this.isConfigured("v3"),
        siteKey: this.v3SiteKey ? `${this.v3SiteKey.substring(0, 10)}...` : null,
        scoreThreshold: this.v3ScoreThreshold,
      },
    }
  }

  // Middleware for Express routes
  middleware(options = {}) {
    const { version = "v3", action = null, required = true } = options

    return async (req, res, next) => {
      try {
        // Skip if reCAPTCHA is disabled and not required
        if (!this.enableRecaptcha && !required) {
          console.log("🔒 reCAPTCHA middleware skipped (disabled)")
          return next()
        }

        // Get token from request
        const token = req.body["g-recaptcha-response"] || req.body.recaptchaToken || req.headers["x-recaptcha-token"]

        if (!token && required) {
          return res.status(400).json({
            error: "reCAPTCHA verification required",
            code: "RECAPTCHA_REQUIRED",
          })
        }

        if (!token) {
          return next()
        }

        // Get client IP
        const remoteIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress

        // Verify token
        const result = await this.verifyToken(token, version, action, remoteIp)

        // Add result to request object
        req.recaptcha = result

        if (!result.success && required) {
          return res.status(400).json({
            error: result.error || "reCAPTCHA verification failed",
            code: result.code || "RECAPTCHA_FAILED",
            ...(result.score !== undefined && { score: result.score }),
            ...(result.threshold !== undefined && { threshold: result.threshold }),
          })
        }

        next()
      } catch (error) {
        console.error("❌ reCAPTCHA middleware error:", error)
        if (required) {
          return res.status(500).json({
            error: "reCAPTCHA verification failed",
            code: "RECAPTCHA_ERROR",
          })
        }
        next()
      }
    }
  }
}

// Create singleton instance
const recaptchaConfig = new RecaptchaConfig()

module.exports = recaptchaConfig
