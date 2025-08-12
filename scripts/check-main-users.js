const { getMainDb } = require("../db/connection")
const User = require("../models/User")(getMainDb()) // Pass the main DB connection

async function checkMainUsers() {
  try {
    console.log("🔍 Checking users in the main database...")

    // Ensure the main DB connection is established
    const mainConnection = getMainDb()
    if (mainConnection.readyState !== 1) {
      console.error("❌ Main database connection is not open. Attempting to connect...")
      // Wait for connection to be ready if it's still connecting
      await new Promise((resolve, reject) => {
        mainConnection.on("connected", resolve)
        mainConnection.on("error", reject)
        setTimeout(() => reject(new Error("Main DB connection timeout")), 10000) // 10 sec timeout
      })
      console.log("✅ Main database connection established for script.")
    }

    const users = await User.find({})
    if (users.length === 0) {
      console.log("⚠️ No users found in the main database.")
    } else {
      console.log(`✅ Found ${users.length} users in the main database:`)
      users.forEach((user) => {
        console.log(`  - Email: ${user.email}, Tenant ID: ${user.tenantId || "N/A"}, Active: ${user.isActive}`)
        // Note: Do NOT log user.password directly for security reasons.
      })
    }
  } catch (error) {
    console.error("❌ Error checking main users:", error)
  } finally {
    // In a script, you might want to close the connection if it's not managed by the main app
    // However, if this script is run as part of the app startup, keep it open.
    // For a standalone script, you'd typically do:
    // const mainConnection = getMainDb();
    // if (mainConnection.readyState === 1) {
    //   await mainConnection.close();
    //   console.log("🔌 Main database connection closed by script.");
    // }
  }
}

// Execute the function when the script is run directly
if (require.main === module) {
  require("dotenv").config() // Load environment variables for standalone execution
  checkMainUsers()
}

module.exports = checkMainUsers
