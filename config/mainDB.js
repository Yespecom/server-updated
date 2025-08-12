const mongoose = require("mongoose")

const connectMainDB = async () => {
  try {
    await mongoose.connect(process.env.MAIN_DB_URI || "mongodb://localhost:27017/yesp_main", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    console.log("📦 Main Database Connected")
  } catch (error) {
    console.error("❌ Main Database Connection Error:", error)
    process.exit(1)
  }
}

module.exports = connectMainDB
