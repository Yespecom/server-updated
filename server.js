const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")
const mongoose = require("mongoose")
const multer = require("multer")

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(cors())

// Enhanced JSON parsing with better error handling
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf, encoding) => {
      try {
        JSON.parse(buf)
      } catch (err) {
        console.error("❌ JSON Parse Error:", err.message)
        console.error("❌ Raw body:", buf.toString())
        res.status(400).json({
          error: "Invalid JSON format",
          details: err.message,
        })
        return
      }
    },
  }),
)

app.use(express.urlencoded({ extended: true }))
app.use("/uploads", express.static("uploads"))

// Import routes
const authRoutes = require("./routes/auth")
const adminRoutes = require("./routes/admin")
const storeRoutes = require("./routes/store")
const otpRoutes = require("./routes/otp")
const passwordResetRoutes = require("./routes/password-reset")

// Import middleware
const authMiddleware = require("./middleware/auth")
const storeContextMiddleware = require("./middleware/storeContext")

// Database connections
const connectMainDB = require("./config/mainDB")
const { closeAllTenantDBs } = require("./config/tenantDB")

// Connect to main database
connectMainDB()

// Add detailed logging middleware - BEFORE route registration
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.originalUrl}`)
  console.log(`🔍 Host: ${req.get("host")}`)
  console.log(`🔍 Path: ${req.path}`)
  console.log(`🔍 Base URL: ${req.baseUrl}`)
  console.log(`🔍 Headers:`, {
    host: req.get("host"),
    authorization: req.get("authorization") ? "Bearer ***" : "None",
    "content-type": req.get("content-type"),
  })

  next()
})

// Route debugging middleware to help identify routing issues
app.use((req, res, next) => {
  const path = req.originalUrl
  console.log(`🔍 Route analysis for: ${path}`)

  if (path.startsWith("/api/admin")) {
    console.log(`✅ Should be handled by admin routes`)
  } else if (path.startsWith("/api/auth")) {
    console.log(`✅ Should be handled by auth routes`)
  } else if (path.startsWith("/api/otp")) {
    console.log(`✅ Should be handled by OTP routes`)
  } else if (path.startsWith("/api/password-reset")) {
    console.log(`✅ Should be handled by password reset routes`)
  } else if (path.match(/^\/api\/[A-Z0-9]{6}$/i)) {
    console.log(`✅ Looks like a store route with storeId: ${path.split("/")[2]}`)
  } else {
    console.log(`⚠️ Unknown route pattern: ${path}`)
  }

  next()
})

// Routes - IMPORTANT: Order matters! More specific routes must come before generic ones
console.log("🔗 Registering routes...")

// Health check (should be first)
app.get("/health", (req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  })
})

// Authentication routes (must come before store routes)
app.use(
  "/api/auth",
  (req, res, next) => {
    console.log("🔐 Auth route matched:", req.path)
    next()
  },
  authRoutes,
)
console.log("✅ Auth routes registered at /api/auth")

// OTP routes
app.use(
  "/api/otp",
  (req, res, next) => {
    console.log("🔢 OTP route matched:", req.path)
    next()
  },
  otpRoutes,
)
console.log("✅ OTP routes registered at /api/otp")

// Password reset routes
app.use(
  "/api/password-reset",
  (req, res, next) => {
    console.log("🔐 Password reset route matched:", req.path)
    next()
  },
  passwordResetRoutes,
)
console.log("✅ Password reset routes registered at /api/password-reset")

// Admin routes (protected by authMiddleware, no storeId in path) - MUST come before store routes
app.use(
  "/api/admin",
  (req, res, next) => {
    console.log("👑 Admin route matched:", req.path)
    console.log("👑 Full URL:", req.originalUrl)
    console.log("👑 Method:", req.method)
    next()
  },
  authMiddleware,
  adminRoutes,
)
console.log("✅ Admin routes registered at /api/admin")

// CRITICAL FIX: Add a catch-all middleware to prevent admin routes from falling through
app.use("/api/admin/*", (req, res, next) => {
  console.log("❌ CRITICAL: Admin route fell through to catch-all handler")
  console.log("❌ This means the admin route didn't send a response")
  console.log("❌ URL:", req.originalUrl)
  console.log("❌ Method:", req.method)

  // If we reach here, it means the admin route didn't handle the request properly
  if (!res.headersSent) {
    return res.status(500).json({
      error: "Admin route handler failed",
      message: "The admin route was matched but didn't send a response",
      debug: {
        originalUrl: req.originalUrl,
        method: req.method,
        path: req.path,
      },
    })
  }
})

// Store routes with storeId parameter - MUST come last and be more restrictive
app.use(
  "/api/:storeId",
  (req, res, next) => {
    const storeId = req.params.storeId
    console.log(`🛍️ Store route pattern matched with storeId: ${storeId}`)
    console.log(`🛍️ Full path: ${req.originalUrl}`)

    // CRITICAL FIX: More robust check for admin routes
    if (req.originalUrl.includes("/api/admin")) {
      console.log(`❌ ROUTING ERROR: Admin route ${req.originalUrl} incorrectly reached store handler`)
      console.log(`❌ This should never happen - admin routes should be handled before store routes`)
      return res.status(500).json({
        error: "Internal server routing error",
        message: "Admin route was incorrectly processed by store handler",
        debug: {
          originalUrl: req.originalUrl,
          method: req.method,
          storeId: storeId,
          fix: "Admin routes should be handled by /api/admin middleware, not store middleware",
        },
      })
    }

    // IMPORTANT: Skip store middleware for known non-store routes
    const nonStoreRoutes = ["auth", "admin", "otp", "password-reset", "health", "user"]

    if (nonStoreRoutes.includes(storeId)) {
      console.log(`❌ Route ${storeId} should NOT reach store handler - this indicates a routing problem`)
      return res.status(500).json({
        error: "Internal routing error",
        message: `Route '${storeId}' was incorrectly processed by store handler`,
        debug: {
          storeId,
          originalUrl: req.originalUrl,
          method: req.method,
          solution: "This route should be handled by a specific middleware before reaching the store handler",
        },
      })
    }

    // Validate storeId format (should be 6 alphanumeric characters)
    if (!/^[A-Z0-9]{6}$/i.test(storeId)) {
      console.log(`❌ Invalid storeId format: ${storeId}`)
      return res.status(400).json({
        error: "Invalid store ID format",
        message: "Store ID must be 6 alphanumeric characters",
        provided: storeId,
      })
    }

    // Apply store context middleware for actual store routes
    console.log(`🛍️ Applying store context middleware for store: ${storeId}`)
    storeContextMiddleware(req, res, next)
  },
  storeRoutes,
)
console.log("✅ Store routes registered at /api/:storeId with context middleware")

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.stack)

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error("❌ JSON Syntax Error:", err.message)
    return res.status(400).json({
      error: "Invalid JSON format",
      message: "Please check your request body for valid JSON syntax",
      details: err.message,
    })
  }

  // Handle multer errors specifically
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 5MB." })
    }
    return res.status(400).json({ error: err.message })
  }

  // Handle other errors
  res.status(500).json({
    error: "Something went wrong!",
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  })
})

// 404 handler with more details
app.use("*", (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`)
  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    availableRoutes: [
      "/api/auth/*",
      "/api/admin/*",
      "/api/otp/*",
      "/api/password-reset/*",
      "/api/[STORE_ID]/*",
      "/health",
    ],
  })
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down gracefully...")
  await closeAllTenantDBs()
  await mongoose.connection.close()
  process.exit(0)
})

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`🔐 Authentication: http://localhost:${PORT}/api/auth`)
  console.log(`📊 Admin Panel: http://localhost:${PORT}/api/admin`)
  console.log(`🛍️ Storefront: http://localhost:${PORT}/api/[STORE_ID]`)
  console.log(`🔧 Health Check: http://localhost:${PORT}/health`)
  console.log(``)
  console.log(`🔍 Route Order:`)
  console.log(`  1. /health`)
  console.log(`  2. /api/auth/*`)
  console.log(`  3. /api/otp/*`)
  console.log(`  4. /api/password-reset/*`)
  console.log(`  5. /api/admin/* (with auth middleware)`)
  console.log(`  6. /api/:storeId/* (store routes)`)
})

module.exports = app
