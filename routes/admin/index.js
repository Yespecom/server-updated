const express = require("express")
const router = express.Router()

// Add logging middleware to admin routes
router.use((req, res, next) => {
  console.log(`👑 Admin route handler - ${req.method} ${req.path}`)
  console.log(`👑 Original URL: ${req.originalUrl}`)
  console.log(`👑 Base URL: ${req.baseUrl}`)
  console.log(`👑 SUCCESS: Admin route handler is working correctly!`)
  next()
})

// CRITICAL FIX: Add response tracking middleware
router.use((req, res, next) => {
  const originalSend = res.send
  const originalJson = res.json
  const originalEnd = res.end

  res.send = function (data) {
    console.log(`📤 RESPONSE SENT via res.send() for ${req.method} ${req.originalUrl}`)
    console.log(`📤 Response data type: ${typeof data}`)
    console.log(`📤 Headers sent: ${res.headersSent}`)
    return originalSend.call(this, data)
  }

  res.json = function (data) {
    console.log(`📤 RESPONSE SENT via res.json() for ${req.method} ${req.originalUrl}`)
    console.log(`📤 Response data:`, typeof data === "object" ? Object.keys(data) : data)
    console.log(`📤 Headers sent: ${res.headersSent}`)
    return originalJson.call(this, data)
  }

  res.end = function (data) {
    console.log(`📤 RESPONSE ENDED via res.end() for ${req.method} ${req.originalUrl}`)
    console.log(`📤 Headers sent: ${res.headersSent}`)
    return originalEnd.call(this, data)
  }

  next()
})

// Simple middleware to log admin route processing
router.use((req, res, next) => {
  console.log(`👑 Admin route processing: ${req.method} ${req.path}`)
  next()
})

// Test route to verify admin routing works - MUST be early in the file
router.all("/test", (req, res) => {
  console.log("🧪 Admin test route reached successfully")
  return res.json({
    message: "Admin routes are working correctly!",
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    user: req.user
      ? {
          email: req.user.email,
          tenantId: req.tenantId,
        }
      : "No user",
    timestamp: new Date().toISOString(),
    success: true,
  })
})

// Import all admin routes
const productsRoutes = require("./products")
const categoriesRoutes = require("./categories")
const ordersRoutes = require("./orders")
const customersRoutes = require("./customers")
const offersRoutes = require("./offers")
const settingsRoutes = require("./settings")
const dashboardRoutes = require("./dashboard")
const paymentsRoutes = require("./payments")

// Middleware to ensure tenant DB is available
const ensureTenantDB = async (req, res, next) => {
  try {
    console.log(`🔍 Ensuring tenant DB for: ${req.tenantId}`)

    if (!req.tenantDB) {
      const { getTenantDB } = require("../../config/tenantDB")

      if (!req.tenantId) {
        console.error("❌ Tenant ID not available")
        return res.status(500).json({ error: "Tenant ID not available" })
      }

      req.tenantDB = await getTenantDB(req.tenantId)
      console.log(`✅ Tenant DB connected: ${req.tenantId}`)
    }

    next()
  } catch (error) {
    console.error("❌ Tenant DB middleware error:", error)
    return res.status(500).json({ error: "Database connection failed" })
  }
}

// Apply tenant DB middleware to all admin routes
router.use(ensureTenantDB)

// Mount routes with logging
router.use(
  "/products",
  (req, res, next) => {
    console.log("📦 Products route matched")
    next()
  },
  productsRoutes,
)

router.use(
  "/categories",
  (req, res, next) => {
    console.log("🗂️ Categories route matched")
    next()
  },
  categoriesRoutes,
)

router.use(
  "/orders",
  (req, res, next) => {
    console.log("📋 Orders route matched")
    next()
  },
  ordersRoutes,
)

router.use(
  "/customers",
  (req, res, next) => {
    console.log("👥 Customers route matched")
    next()
  },
  customersRoutes,
)

router.use(
  "/offers",
  (req, res, next) => {
    console.log("🎁 Offers route matched")
    next()
  },
  offersRoutes,
)

router.use(
  "/settings",
  (req, res, next) => {
    console.log(`⚙️ Settings route matched - path: ${req.path}`)
    console.log(`⚙️ Settings route matched - originalUrl: ${req.originalUrl}`)
    console.log(`⚙️ Settings route matched - method: ${req.method}`)
    next()
  },
  settingsRoutes,
)

router.use(
  "/dashboard",
  (req, res, next) => {
    console.log("📊 Dashboard route matched")
    next()
  },
  dashboardRoutes,
)

router.use(
  "/payments",
  (req, res, next) => {
    console.log("💳 Payments route matched")
    next()
  },
  paymentsRoutes,
)

// Admin dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const Product = require("../../models/tenant/Product")(req.tenantDB)
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Customer = require("../../models/tenant/Customer")(req.tenantDB)

    const [productCount, orderCount, customerCount] = await Promise.all([
      Product.countDocuments(),
      Order.countDocuments(),
      Customer.countDocuments(),
    ])

    return res.json({
      products: productCount,
      orders: orderCount,
      customers: customerCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Stats error:", error)
    return res.status(500).json({ error: error.message })
  }
})

// Get complete store information
router.get("/store-info", async (req, res) => {
  try {
    const Settings = require("../../models/tenant/Settings")(req.tenantDB)
    const settings = await Settings.findOne()

    // Get store info from user
    const storeInfo = req.user.storeInfo || {}

    // Get main user info for storeId
    const User = require("../../models/User")
    const mainUser = await User.findOne({ email: req.user.email })

    const completeStoreInfo = {
      // Basic store details
      storeId: req.storeId || mainUser?.storeId,
      storeName: storeInfo.name || settings?.general?.storeName || "Your Store",
      logo: storeInfo.logo || settings?.general?.logo || "",
      banner: storeInfo.banner || settings?.general?.banner || "",
      industry: storeInfo.industry || "General",
      isActive: storeInfo.isActive || false,

      // Store URLs
      storeUrl: `http://${(req.storeId || mainUser?.storeId || "").toLowerCase()}.localhost:5000`,
      adminUrl: `http://localhost:5000/api/admin`,

      // Owner details
      owner: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        role: req.user.role,
      },

      // Additional settings
      general: settings?.general || {},
      social: settings?.social || {},
      shipping: settings?.shipping || {},

      // Technical details
      tenantId: req.tenantId,
      createdAt: req.user.createdAt,
      updatedAt: req.user.updatedAt,
    }

    return res.json(completeStoreInfo)
  } catch (error) {
    console.error("❌ Store info error:", error)
    return res.status(500).json({ error: error.message })
  }
})

// Debug route to show all mounted routes
router.get("/debug/routes", (req, res) => {
  console.log("🔍 Admin routes debug requested")

  return res.json({
    message: "Admin routes debug info",
    routingWorking: true,
    adminRouteHandlerReached: true,
    availableEndpoints: [
      "GET /api/admin/test",
      "GET /api/admin/stats",
      "GET /api/admin/store-info",
      "GET /api/admin/debug/routes",
      "* /api/admin/products/*",
      "* /api/admin/categories/*",
      "* /api/admin/orders/*",
      "* /api/admin/customers/*",
      "* /api/admin/offers/*",
      "* /api/admin/settings/*",
      "* /api/admin/dashboard/*",
      "* /api/admin/payments/*",
    ],
    currentRequest: {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
    },
    timestamp: new Date().toISOString(),
  })
})

module.exports = router
