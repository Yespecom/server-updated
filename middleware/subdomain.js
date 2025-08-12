// This file is no longer used for the new API structure.
// It is kept here for reference but is effectively deprecated.
const { getTenantDB } = require("../config/tenantDB")
const User = require("../models/User")

const subdomainMiddleware = async (req, res, next) => {
  try {
    const host = req.get("host")
    const parts = host.split(".")

    console.log(`🌐 Subdomain middleware - Host: ${host}, Parts: ${JSON.stringify(parts)}`)

    // Skip subdomain processing for main domain or localhost without subdomain
    if (parts.length < 2 || parts[0] === "localhost" || parts[0] === host) {
      console.log("⏭️ Skipping subdomain processing - main domain")
      return next()
    }

    const storeId = parts[0].toUpperCase() // Convert to uppercase for matching

    // Only process for storefront routes
    if (req.path.startsWith("/api/store")) {
      // This path is now deprecated in server.js
      console.log(`🔍 Processing storefront request for store ID: ${storeId}`)

      try {
        // Find main user by store ID to get tenant ID - try both cases
        let mainUser = await User.findOne({ storeId: storeId })

        // If not found with uppercase, try lowercase
        if (!mainUser) {
          const lowerStoreId = parts[0].toLowerCase()
          mainUser = await User.findOne({ storeId: lowerStoreId })
          console.log(`🔍 Trying lowercase store ID: ${lowerStoreId}`)
        }

        // If still not found, try original case
        if (!mainUser) {
          const originalStoreId = parts[0]
          mainUser = await User.findOne({ storeId: originalStoreId })
          console.log(`🔍 Trying original case store ID: ${originalStoreId}`)
        }

        if (!mainUser) {
          console.error(`❌ Store not found: ${storeId} (tried uppercase, lowercase, and original case)`)
          return res.status(404).json({
            error: "Store not found",
            storeId: storeId,
            help: "Please check if the store ID is correct",
          })
        }

        console.log(`✅ Found main user for store: ${storeId}, tenant: ${mainUser.tenantId}`)

        // Get tenant DB and user data
        const tenantDB = await getTenantDB(mainUser.tenantId)

        if (!tenantDB) {
          console.error(`❌ Failed to get tenant DB for: ${mainUser.tenantId}`)
          return res.status(500).json({ error: "Database connection failed" })
        }

        console.log(`✅ Tenant DB connected: ${mainUser.tenantId}`)

        const TenantUser = require("../models/tenant/User")(tenantDB)
        const tenantUser = await TenantUser.findOne({ email: mainUser.email })

        if (!tenantUser) {
          console.error(`❌ Tenant user not found for: ${mainUser.email}`)
          return res.status(404).json({ error: "Store user not found" })
        }

        if (!tenantUser.hasStore) {
          console.error(`❌ Store not active for: ${storeId}`)
          return res.status(404).json({ error: "Store not active" })
        }

        console.log(`✅ Store validation passed for: ${storeId}`)

        // Set tenant info for storefront routes
        req.tenantId = mainUser.tenantId
        req.storeId = mainUser.storeId || storeId // Use the actual storeId from DB
        req.storeInfo = tenantUser.storeInfo
        req.tenantDB = tenantDB

        console.log(`🔗 Request context set:`, {
          tenantId: req.tenantId,
          storeId: req.storeId,
          storeName: req.storeInfo?.name,
          dbState: req.tenantDB?.readyState,
        })
      } catch (dbError) {
        console.error("❌ Database error in subdomain middleware:", dbError)
        return res.status(500).json({
          error: "Store configuration error",
          details: dbError.message,
        })
      }
    }

    next()
  } catch (error) {
    console.error("❌ Subdomain middleware error:", error)
    res.status(500).json({
      error: "Store configuration error",
      details: error.message,
    })
  }
}

module.exports = subdomainMiddleware
