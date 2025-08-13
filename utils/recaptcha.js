const axios = require("axios")

class RecaptchaUtils {
  /**
   * Verify reCAPTCHA token on server side
   * @param {string} token - reCAPTCHA token from client
   * @param {string} remoteip - Client IP address (optional)
   * @returns {Promise<{success: boolean, score?: number, action?: string, error?: string}>}
   */
  static async verifyRecaptcha(token, remoteip = null) {
    try {
      if (!token) {
        return {
          success: false,
          error: "reCAPTCHA token is required",
        }
      }

      const secretKey = process.env.RECAPTCHA_SECRET_KEY
      if (!secretKey) {
        console.error("❌ RECAPTCHA_SECRET_KEY not configured")
        return {
          success: false,
          error: "reCAPTCHA not configured",
        }
      }

      const verifyUrl = "https://www.google.com/recaptcha/api/siteverify"
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      })

      if (remoteip) {
        params.append("remoteip", remoteip)
      }

      const response = await axios.post(verifyUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      })

      const result = response.data

      console.log("🔒 reCAPTCHA verification result:", {
        success: result.success,
        score: result.score,
        action: result.action,
        hostname: result.hostname,
      })

      if (!result.success) {
        console.error("❌ reCAPTCHA verification failed:", result["error-codes"])
        return {
          success: false,
          error: "reCAPTCHA verification failed",
          errorCodes: result["error-codes"],
        }
      }

      // For reCAPTCHA v3, check score (0.0 to 1.0, higher is better)
      if (result.score !== undefined) {
        const minScore = 0.5 // Adjust threshold as needed
        if (result.score < minScore) {
          console.warn(`⚠️ reCAPTCHA score too low: ${result.score} < ${minScore}`)
          return {
            success: false,
            error: "reCAPTCHA score too low",
            score: result.score,
          }
        }
      }

      return {
        success: true,
        score: result.score,
        action: result.action,
        hostname: result.hostname,
      }
    } catch (error) {
      console.error("❌ reCAPTCHA verification error:", error.message)
      return {
        success: false,
        error: "reCAPTCHA verification failed",
      }
    }
  }

  /**
   * Middleware to verify reCAPTCHA token
   * @param {boolean} required - Whether reCAPTCHA is required (default: true)
   * @returns {Function} Express middleware
   */
  static middleware(required = true) {
    return async (req, res, next) => {
      try {
        const token = req.body.recaptchaToken || req.headers["x-recaptcha-token"]

        if (!token && required) {
          return res.status(400).json({
            error: "reCAPTCHA token is required",
            code: "RECAPTCHA_REQUIRED",
          })
        }

        if (token) {
          const clientIP = req.ip || req.connection.remoteAddress
          const verification = await RecaptchaUtils.verifyRecaptcha(token, clientIP)

          if (!verification.success) {
            return res.status(400).json({
              error: verification.error || "reCAPTCHA verification failed",
              code: "RECAPTCHA_FAILED",
            })
          }

          // Add verification result to request for use in route handlers
          req.recaptcha = verification
        }

        next()
      } catch (error) {
        console.error("❌ reCAPTCHA middleware error:", error)
        return res.status(500).json({
          error: "reCAPTCHA verification error",
          code: "RECAPTCHA_ERROR",
        })
      }
    }
  }
}

module.exports = RecaptchaUtils
