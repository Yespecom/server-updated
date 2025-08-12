const mongoose = require("mongoose")

const tenantConnections = {}

const getTenantDB = async (tenantId) => {
  if (tenantConnections[tenantId]) {
    console.log(`♻️ Reusing existing connection for tenant: ${tenantId}`)
    return tenantConnections[tenantId]
  }

  try {
    const dbUri = process.env.TENANT_DB_URI
      ? `${process.env.TENANT_DB_URI}${tenantId}`
      : `mongodb://localhost:27017/yesp_${tenantId}`

    console.log(`🔌 Creating new DB connection for tenant: ${tenantId}`)
    console.log(`📍 DB URI: ${dbUri}`)

    const connection = await mongoose.createConnection(dbUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 60000,
      family: 4,
    })

    // Handle connection events
    connection.on("connected", () => {
      console.log(`✅ Tenant DB Connected: ${tenantId}`)
    })

    connection.on("error", (err) => {
      console.error(`❌ Tenant DB Error for ${tenantId}:`, err)
    })

    connection.on("disconnected", () => {
      console.log(`🔌 Tenant DB Disconnected: ${tenantId}`)
      delete tenantConnections[tenantId]
    })

    tenantConnections[tenantId] = connection
    return connection
  } catch (error) {
    console.error(`❌ Tenant DB Connection Error for ${tenantId}:`, error)
    throw error
  }
}

const closeTenantDB = async (tenantId) => {
  if (tenantConnections[tenantId]) {
    await tenantConnections[tenantId].close()
    delete tenantConnections[tenantId]
    console.log(`🔒 Closed tenant DB connection: ${tenantId}`)
  }
}

const closeAllTenantDBs = async () => {
  const promises = Object.keys(tenantConnections).map((tenantId) => closeTenantDB(tenantId))
  await Promise.all(promises)
  console.log("🔒 All tenant DB connections closed")
}

module.exports = { getTenantDB, closeTenantDB, closeAllTenantDBs }
