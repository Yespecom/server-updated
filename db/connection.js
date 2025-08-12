const mongoose = require("mongoose")

let mainConnection = null

const getMainDb = () => {
  if (!mainConnection) {
    console.log("📦 Initializing Main Database Connection...")
    mainConnection = mongoose.createConnection(process.env.MAIN_DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    })

    mainConnection.on("connected", () => {
      console.log("✅ Main Database Connection Established")
    })

    mainConnection.on("error", (err) => {
      console.error("❌ Main Database Connection Error:", err)
      // Consider graceful shutdown or retry logic here
    })

    mainConnection.on("disconnected", () => {
      console.log("🔌 Main Database Disconnected")
    })
  }
  return mainConnection
}

module.exports = { getMainDb }
