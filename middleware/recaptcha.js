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
      console.log(`🔒 reCAPTCHA ${version} middleware started for action: ${action}`)

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
          action,
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
      const originalThreshold = recaptchaConfig.v3ScoreThreshold
      if (scoreThreshold && version === "v3") {
        recaptchaConfig.v3ScoreThreshold = scoreThreshold
        console.log(`🎯 Using custom score threshold: ${scoreThreshold} (default: ${originalThreshold})`)
      }

      // Verify the token
      const result = await recaptchaConfig.verifyToken(token, version, action, remoteIp)

      // Restore original threshold if it was overridden
      if (scoreThreshold && version === "v3") {
        recaptchaConfig.v3ScoreThreshold = originalThreshold
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
          action,
        }

        // Add additional info for v3
        if (version === "v3") {
          if (result.score !== undefined) {
            errorResponse.score = result.score
          }
          if (result.threshold !== undefined) {
            errorResponse.threshold = result.threshold
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
          action,
        })
      }

      next()
    }
  }
}

// Predefined middleware for login and register
const recaptchaMiddleware = {
  // v3 middlewares for login and register
  v3: {
    login: createRecaptchaMiddleware({
      version: "v3",
      action: "login",
      required: true,
    }),
    register: createRecaptchaMiddleware({
      version: "v3",
      action: "register",
      required: true,
    }),
  },

  // v2 middlewares for login and register (fallback)
  v2: {
    login: createRecaptchaMiddleware({
      version: "v2",
      required: true,
    }),
    register: createRecaptchaMiddleware({
      version: "v2",
      required: true,
    }),
  },

  // Custom middleware factory
  create: createRecaptchaMiddleware,

  // Optional middleware (doesn't fail if verification fails)
  optional: {
    v3: {
      login: createRecaptchaMiddleware({
        version: "v3",
        action: "login",
        required: false,
      }),
      register: createRecaptchaMiddleware({
        version: "v3",
        action: "register",
        required: false,
      }),
    },
  },

  // High security middleware (higher score threshold)
  highSecurity: {
    v3: {
      login: createRecaptchaMiddleware({
        version: "v3",
        action: "login",
        required: true,
        scoreThreshold: 0.7,
      }),
      register: createRecaptchaMiddleware({
        version: "v3",
        action: "register",
        required: true,
        scoreThreshold: 0.7,
      }),
    },
  },
}

module.exports = {
  recaptchaMiddleware,
  createRecaptchaMiddleware,
  recaptchaConfig,
}
