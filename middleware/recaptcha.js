const recaptchaConfig = require("../config/recaptcha")

// reCAPTCHA middleware factory
const createRecaptchaMiddleware = (options = {}) => {
  const {
    version = "v3", // v2 or v3
    action = null, // Required for v3
    required = true, // Whether reCAPTCHA is required
    scoreThreshold = null, // Override default score threshold for v3
  } = options

  return async (req, res, next) => {
    try {
      console.log(`🔒 reCAPTCHA ${version} middleware started`)

      // Skip if reCAPTCHA is disabled and not required
      if (!recaptchaConfig.enableRecaptcha && !required) {
        console.log("🔒 reCAPTCHA middleware skipped (disabled)")
        req.recaptcha = {
          success: true,
          skipped: true,
          message: "reCAPTCHA disabled in current environment",
        }
        return next()
      }

      // Get token from various sources
      const token =
        req.body["g-recaptcha-response"] ||
        req.body.recaptchaToken ||
        req.headers["x-recaptcha-token"] ||
        req.query.recaptchaToken

      // Check if token is required
      if (!token && required) {
        console.log("❌ reCAPTCHA token missing")
        return res.status(400).json({
          error: "reCAPTCHA verification is required",
          code: "RECAPTCHA_REQUIRED",
          version,
        })
      }

      // Skip verification if token is not provided and not required
      if (!token) {
        console.log("🔒 reCAPTCHA token not provided, skipping verification")
        req.recaptcha = {
          success: true,
          skipped: true,
          message: "reCAPTCHA token not provided",
        }
        return next()
      }

      // Get client IP for verification
      const remoteIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress

      console.log(`🔍 Verifying reCAPTCHA ${version} token from IP: ${remoteIp}`)

      // Override score threshold if provided
      if (scoreThreshold && version === "v3") {
        const originalThreshold = recaptchaConfig.v3ScoreThreshold
        recaptchaConfig.v3ScoreThreshold = scoreThreshold
        console.log(`🎯 Using custom score threshold: ${scoreThreshold} (default: ${originalThreshold})`)
      }

      // Verify the token
      const result = await recaptchaConfig.verifyToken(token, version, action, remoteIp)

      // Restore original threshold if it was overridden
      if (scoreThreshold && version === "v3") {
        recaptchaConfig.v3ScoreThreshold = Number.parseFloat(process.env.RECAPTCHA_V3_SCORE_THRESHOLD) || 0.5
      }

      // Add result to request object
      req.recaptcha = result

      // Log the result
      if (result.success) {
        console.log(`✅ reCAPTCHA ${version} verification successful`)
        if (result.score !== undefined) {
          console.log(`📊 Score: ${result.score}`)
        }
        if (result.action) {
          console.log(`🎬 Action: ${result.action}`)
        }
      } else {
        console.log(`❌ reCAPTCHA ${version} verification failed:`, result.error)
      }

      // Handle verification failure
      if (!result.success && required) {
        const errorResponse = {
          error: result.error || "reCAPTCHA verification failed",
          code: result.code || "RECAPTCHA_FAILED",
          version,
        }

        // Add additional info for v3
        if (version === "v3") {
          if (result.score !== undefined) {
            errorResponse.score = result.score
          }
          if (result.threshold !== undefined) {
            errorResponse.threshold = result.threshold
          }
          if (result.action !== undefined) {
            errorResponse.action = result.action
          }
        }

        // Add error details if available
        if (result.details) {
          errorResponse.details = result.details
        }

        return res.status(400).json(errorResponse)
      }

      console.log(`✅ reCAPTCHA ${version} middleware completed`)
      next()
    } catch (error) {
      console.error("❌ reCAPTCHA middleware error:", error)

      // Add error info to request
      req.recaptcha = {
        success: false,
        error: "reCAPTCHA middleware error",
        code: "MIDDLEWARE_ERROR",
        details: error.message,
      }

      if (required) {
        return res.status(500).json({
          error: "reCAPTCHA verification failed",
          code: "RECAPTCHA_ERROR",
          version,
        })
      }

      next()
    }
  }
}

// Predefined middleware for common use cases
const recaptchaMiddleware = {
  // v3 middlewares for different actions
  v3: {
    login: createRecaptchaMiddleware({ version: "v3", action: "login", required: true }),
    register: createRecaptchaMiddleware({ version: "v3", action: "register", required: true }),
    forgotPassword: createRecaptchaMiddleware({ version: "v3", action: "forgot_password", required: true }),
    resetPassword: createRecaptchaMiddleware({ version: "v3", action: "reset_password", required: true }),
    contact: createRecaptchaMiddleware({ version: "v3", action: "contact", required: true }),
    newsletter: createRecaptchaMiddleware({ version: "v3", action: "newsletter", required: false }),
    comment: createRecaptchaMiddleware({ version: "v3", action: "comment", required: true }),
    order: createRecaptchaMiddleware({ version: "v3", action: "order", required: true }),
    payment: createRecaptchaMiddleware({ version: "v3", action: "payment", required: true }),
  },

  // v2 middlewares
  v2: {
    login: createRecaptchaMiddleware({ version: "v2", required: true }),
    register: createRecaptchaMiddleware({ version: "v2", required: true }),
    forgotPassword: createRecaptchaMiddleware({ version: "v2", required: true }),
    resetPassword: createRecaptchaMiddleware({ version: "v2", required: true }),
    contact: createRecaptchaMiddleware({ version: "v2", required: true }),
  },

  // Flexible middleware
  create: createRecaptchaMiddleware,

  // Optional middleware (doesn't fail if verification fails)
  optional: {
    v3: (action) => createRecaptchaMiddleware({ version: "v3", action, required: false }),
    v2: () => createRecaptchaMiddleware({ version: "v2", required: false }),
  },

  // High security middleware (higher score threshold for v3)
  highSecurity: {
    v3: (action) => createRecaptchaMiddleware({ version: "v3", action, required: true, scoreThreshold: 0.7 }),
  },

  // Low security middleware (lower score threshold for v3)
  lowSecurity: {
    v3: (action) => createRecaptchaMiddleware({ version: "v3", action, required: true, scoreThreshold: 0.3 }),
  },
}

module.exports = {
  recaptchaMiddleware,
  createRecaptchaMiddleware,
  recaptchaConfig,
}
