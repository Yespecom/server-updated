const { getTenantDB } = require("../config/tenantDB")
const User = require("../models/User")

const storeContextMiddleware = async (req, res, next) => {
  try {
    const { storeId } = req.params // Get storeId from URL path

    console.log("🧪 Original URL:", req.originalUrl)
    console.log("🧪 Extracted storeId from URL:", req.params.storeId)

    if (!storeId || !/^[A-Z0-9]{6}$/i.test(storeId)) {
      console.error("❌ Invalid or missing storeId:", storeId)
      return res.status(400).json({
        error: "Invalid or missing store ID in URL",
        provided: storeId,
      })
    }

    console.log(`🔍 Store context middleware - Processing request for store ID: ${storeId}`)

    // Find main user by store ID to get tenant ID - try both cases
    let mainUser = await User.findOne({ storeId: storeId.toUpperCase() })

    // If not found with uppercase, try original case
    if (!mainUser) {
      mainUser = await User.findOne({ storeId: storeId })
      console.log(`🔍 Trying original case store ID: ${storeId}`)
    }

    if (!mainUser) {
      console.error(`❌ Store not found: ${storeId} (tried uppercase and original case)`)
      return res.status(404).json({
        error: "Store not found",
        storeId: storeId,
        help: "Please check if the store ID is correct in the URL.",
      })
    }

    console.log(`✅ Found main user for store: ${storeId}, tenant: ${mainUser.tenantId}`)

    // Get tenant DB connection
    const tenantDB = await getTenantDB(mainUser.tenantId)

    if (!tenantDB) {
      console.error(`❌ Failed to get tenant DB for: ${mainUser.tenantId}`)
      return res.status(500).json({ error: "Database connection failed" })
    }

    console.log(`✅ Tenant DB connected: ${mainUser.tenantId}`)

    // Get tenant user data to retrieve storeInfo
    const TenantUser = require("../models/tenant/User")(tenantDB)
    const tenantUser = await TenantUser.findOne({ email: mainUser.email })

    if (!tenantUser) {
      console.error(`❌ Tenant user not found for: ${mainUser.email}`)
      return res.status(404).json({ error: "Store user data not found" })
    }

    if (!tenantUser.hasStore) {
      console.error(`❌ Store not active for: ${storeId}`)
      return res.status(404).json({ error: "Store not active or not fully set up." })
    }

    console.log(`✅ Store validation passed for: ${storeId}`)

    // Set tenant info for all subsequent routes
    req.tenantId = mainUser.tenantId
    req.storeId = mainUser.storeId || storeId // Use the actual storeId from DB if available
    req.storeInfo = tenantUser.storeInfo
    req.tenantDB = tenantDB

    console.log(`🔗 Request context set by storeContextMiddleware:`, {
      tenantId: req.tenantId,
      storeId: req.storeId,
      storeName: req.storeInfo?.name,
      dbState: req.tenantDB?.readyState,
    })

    next()
  } catch (error) {
    console.error("❌ Store context middleware error:", error)
    res.status(500).json({
      error: "Store configuration error",
      details: error.message,
    })
  }
}

module.exports = storeContextMiddleware
