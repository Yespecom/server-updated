const fetch = require("node-fetch")

class RecaptchaConfig {
  constructor() {
    // Environment configuration
    this.enableRecaptcha = process.env.ENABLE_RECAPTCHA === "true"

    // v3 Configuration
    this.v3SiteKey = process.env.RECAPTCHA_V3_SITE_KEY
    this.v3SecretKey = process.env.RECAPTCHA_V3_SECRET_KEY
    this.v3ScoreThreshold = Number.parseFloat(process.env.RECAPTCHA_V3_SCORE_THRESHOLD) || 0.5

    // v2 Configuration (fallback)
    this.v2SiteKey = process.env.RECAPTCHA_V2_SITE_KEY
    this.v2SecretKey = process.env.RECAPTCHA_V2_SECRET_KEY

    // Verification URL
    this.verifyUrl = "https://www.google.com/recaptcha/api/siteverify"

    console.log("🔒 reCAPTCHA Configuration:", {
      enabled: this.enableRecaptcha,
      v3Configured: !!this.v3SiteKey && !!this.v3SecretKey,
      v2Configured: !!this.v2SiteKey && !!this.v2SecretKey,
      scoreThreshold: this.v3ScoreThreshold,
    })
  }

  // Verify reCAPTCHA token
  async verifyToken(token, version = "v3", expectedAction = null, remoteIp = null) {
    try {
      if (!this.enableRecaptcha) {
        console.log("🔒 reCAPTCHA disabled, skipping verification")
        return {
          success: true,
          skipped: true,
          message: "reCAPTCHA disabled in current environment",
        }
      }

      if (!token) {
        return {
          success: false,
          error: "reCAPTCHA token is required",
          code: "MISSING_TOKEN",
        }
      }

      // Get the appropriate secret key
      const secretKey = version === "v3" ? this.v3SecretKey : this.v2SecretKey

      if (!secretKey) {
        console.error(`❌ reCAPTCHA ${version} secret key not configured`)
        return {
          success: false,
          error: `reCAPTCHA ${version} not configured`,
          code: "NOT_CONFIGURED",
        }
      }

      console.log(`🔍 Verifying reCAPTCHA ${version} token...`)

      // Prepare verification request
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      })

      if (remoteIp) {
        params.append("remoteip", remoteIp)
      }

      // Make verification request to Google
      const response = await fetch(this.verifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log(`📊 reCAPTCHA ${version} response:`, {
        success: data.success,
        score: data.score,
        action: data.action,
        hostname: data.hostname,
        errors: data["error-codes"],
      })

      // Handle verification failure
      if (!data.success) {
        const errorCodes = data["error-codes"] || []
        return {
          success: false,
          error: this.getErrorMessage(errorCodes),
          code: "VERIFICATION_FAILED",
          details: errorCodes,
        }
      }

      // For v3, check score and action
      if (version === "v3") {
        return this.handleV3Response(data, expectedAction)
      }

      // For v2, just return success
      return {
        success: true,
        version: "v2",
        hostname: data.hostname,
        challenge_ts: data.challenge_ts,
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

  // Handle v3 specific response validation
  handleV3Response(data, expectedAction) {
    const { score, action, hostname, challenge_ts } = data

    // Validate action if provided
    if (expectedAction && action !== expectedAction) {
      console.log(`❌ Action mismatch: expected '${expectedAction}', got '${action}'`)
      return {
        success: false,
        error: "Action verification failed",
        code: "ACTION_MISMATCH",
        expectedAction,
        receivedAction: action,
        score,
      }
    }

    // Check score threshold
    if (score < this.v3ScoreThreshold) {
      console.log(`❌ Score too low: ${score} < ${this.v3ScoreThreshold}`)
      return {
        success: false,
        error: "reCAPTCHA score too low",
        code: "LOW_SCORE",
        score,
        threshold: this.v3ScoreThreshold,
        action,
      }
    }

    console.log(`✅ reCAPTCHA v3 verification successful: score=${score}, action=${action}`)

    return {
      success: true,
      version: "v3",
      score,
      action,
      hostname,
      challenge_ts,
      threshold: this.v3ScoreThreshold,
    }
  }

  // Get human-readable error message
  getErrorMessage(errorCodes) {
    const errorMessages = {
      "missing-input-secret": "The secret parameter is missing",
      "invalid-input-secret": "The secret parameter is invalid or malformed",
      "missing-input-response": "The response parameter is missing",
      "invalid-input-response": "The response parameter is invalid or malformed",
      "bad-request": "The request is invalid or malformed",
      "timeout-or-duplicate": "The response is no longer valid: either is too old or has been used previously",
    }

    if (!errorCodes || errorCodes.length === 0) {
      return "Unknown reCAPTCHA error"
    }

    const messages = errorCodes.map((code) => errorMessages[code] || `Unknown error: ${code}`)
    return messages.join(", ")
  }

  // Get configuration for frontend
  getClientConfig() {
    return {
      enabled: this.enableRecaptcha,
      v3: {
        enabled: !!this.v3SiteKey,
        siteKey: this.v3SiteKey,
        scoreThreshold: this.v3ScoreThreshold,
      },
      v2: {
        enabled: !!this.v2SiteKey,
        siteKey: this.v2SiteKey,
      },
    }
  }

  // Check if reCAPTCHA is properly configured
  isConfigured(version = "v3") {
    if (!this.enableRecaptcha) return false

    if (version === "v3") {
      return !!(this.v3SiteKey && this.v3SecretKey)
    }

    if (version === "v2") {
      return !!(this.v2SiteKey && this.v2SecretKey)
    }

    return false
  }

  // Get status information
  getStatus() {
    return {
      enabled: this.enableRecaptcha,
      v3: {
        configured: this.isConfigured("v3"),
        siteKey: this.v3SiteKey ? `${this.v3SiteKey.substring(0, 10)}...` : null,
        scoreThreshold: this.v3ScoreThreshold,
      },
      v2: {
        configured: this.isConfigured("v2"),
        siteKey: this.v2SiteKey ? `${this.v2SiteKey.substring(0, 10)}...` : null,
      },
    }
  }
}

// Create singleton instance
const recaptchaConfig = new RecaptchaConfig()

module.exports = recaptchaConfig
