const mongoose = require("mongoose")

const pendingRegistrationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      default: "",
    },
    password: {
      type: String,
      required: true,
      // NO pre-save middleware here - store as plain text
    },
    expiresAt: {
      type: Date,
      default: Date.now,
      expires: 3600, // 1 hour in seconds
      index: true,
    },
  },
  {
    timestamps: true,
  },
)

// Indexes for performance
pendingRegistrationSchema.index({ email: 1 })
pendingRegistrationSchema.index({ expiresAt: 1 })

// Static method to clean expired registrations
pendingRegistrationSchema.statics.cleanExpired = async function () {
  try {
    const result = await this.deleteMany({
      expiresAt: { $lt: new Date() },
    })
    console.log(`🧹 Cleaned ${result.deletedCount} expired pending registrations`)
    return result
  } catch (error) {
    console.error("❌ Error cleaning expired registrations:", error)
    throw error
  }
}

// Static method to find by email
pendingRegistrationSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase().trim() })
}

// Instance method to check if expired
pendingRegistrationSchema.methods.isExpired = function () {
  return this.expiresAt < new Date()
}

// Transform output to remove sensitive data
pendingRegistrationSchema.methods.toJSON = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

const PendingRegistration = mongoose.model("PendingRegistration", pendingRegistrationSchema)

module.exports = PendingRegistration
