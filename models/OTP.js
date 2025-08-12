const mongoose = require("mongoose")
const crypto = require("crypto")

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: ["registration", "password_reset", "email_verification", "login"],
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      max: 5,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    clientInfo: {
      ip: String,
      userAgent: String,
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: true,
  },
)

// Compound indexes for performance
otpSchema.index({ email: 1, purpose: 1 })
otpSchema.index({ email: 1, purpose: 1, isUsed: 1 })
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Static method to generate OTP
otpSchema.statics.generateOTP = (length = 6) => {
  const digits = "0123456789"
  let otp = ""
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)]
  }
  return otp
}

// Static method to create OTP
otpSchema.statics.createOTP = async function (email, purpose, clientInfo = {}, expiryMinutes = 10) {
  try {
    console.log(`🔢 Creating OTP for ${email} (${purpose})`)

    // Clean up any existing OTPs for this email and purpose
    await this.deleteMany({
      email: email.toLowerCase().trim(),
      purpose,
    })

    // Generate new OTP
    const otp = this.generateOTP(6)
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000)

    // Create new OTP record
    const otpRecord = new this({
      email: email.toLowerCase().trim(),
      otp,
      purpose,
      expiresAt,
      clientInfo: {
        ip: clientInfo.ip || "unknown",
        userAgent: clientInfo.userAgent || "unknown",
        timestamp: new Date(),
      },
    })

    await otpRecord.save()
    console.log(`✅ OTP created for ${email}: ${otp} (expires: ${expiresAt})`)

    return otp
  } catch (error) {
    console.error(`❌ Error creating OTP for ${email}:`, error)
    throw error
  }
}

// Static method to verify OTP
otpSchema.statics.verifyOTP = async function (email, otp, purpose) {
  try {
    console.log(`🔍 Verifying OTP for ${email} (${purpose}): ${otp}`)

    const otpRecord = await this.findOne({
      email: email.toLowerCase().trim(),
      purpose,
      isUsed: false,
    }).sort({ createdAt: -1 })

    if (!otpRecord) {
      console.log(`❌ No OTP found for ${email} (${purpose})`)
      return {
        success: false,
        message: "Invalid or expired OTP",
        code: "INVALID_OTP",
      }
    }

    // Check if OTP is expired
    if (otpRecord.expiresAt < new Date()) {
      console.log(`❌ OTP expired for ${email} (${purpose})`)
      await otpRecord.deleteOne()
      return {
        success: false,
        message: "OTP has expired. Please request a new one.",
        code: "OTP_EXPIRED",
      }
    }

    // Check attempts
    if (otpRecord.attempts >= 5) {
      console.log(`❌ Too many attempts for ${email} (${purpose})`)
      await otpRecord.deleteOne()
      return {
        success: false,
        message: "Too many failed attempts. Please request a new OTP.",
        code: "TOO_MANY_ATTEMPTS",
      }
    }

    // Verify OTP
    if (otpRecord.otp !== otp.toString()) {
      console.log(`❌ OTP mismatch for ${email} (${purpose}): expected ${otpRecord.otp}, got ${otp}`)

      // Increment attempts
      otpRecord.attempts += 1
      await otpRecord.save()

      return {
        success: false,
        message: `Invalid OTP. ${5 - otpRecord.attempts} attempts remaining.`,
        code: "INVALID_OTP",
        attemptsRemaining: 5 - otpRecord.attempts,
      }
    }

    console.log(`✅ OTP verified successfully for ${email} (${purpose})`)

    // Mark as used and save
    otpRecord.isUsed = true
    await otpRecord.save()

    return {
      success: true,
      message: "OTP verified successfully",
      code: "OTP_VERIFIED",
    }
  } catch (error) {
    console.error(`❌ Error verifying OTP for ${email}:`, error)
    return {
      success: false,
      message: "OTP verification failed",
      code: "VERIFICATION_ERROR",
    }
  }
}

// Static method to check OTP without consuming it
otpSchema.statics.checkOTP = async function (email, otp, purpose) {
  try {
    console.log(`🔍 Checking OTP for ${email} (${purpose}): ${otp}`)

    const otpRecord = await this.findOne({
      email: email.toLowerCase().trim(),
      purpose,
      isUsed: false,
    }).sort({ createdAt: -1 })

    if (!otpRecord) {
      return {
        success: false,
        message: "Invalid or expired OTP",
        code: "INVALID_OTP",
      }
    }

    // Check if expired
    if (otpRecord.expiresAt < new Date()) {
      return {
        success: false,
        message: "OTP has expired",
        code: "OTP_EXPIRED",
      }
    }

    // Check attempts
    if (otpRecord.attempts >= 5) {
      return {
        success: false,
        message: "Too many failed attempts",
        code: "TOO_MANY_ATTEMPTS",
      }
    }

    // Check OTP match
    if (otpRecord.otp !== otp.toString()) {
      return {
        success: false,
        message: "Invalid OTP",
        code: "INVALID_OTP",
      }
    }

    return {
      success: true,
      message: "OTP is valid",
      code: "OTP_VALID",
    }
  } catch (error) {
    console.error(`❌ Error checking OTP for ${email}:`, error)
    return {
      success: false,
      message: "OTP check failed",
      code: "CHECK_ERROR",
    }
  }
}

// Static method to get current OTP (for debugging)
otpSchema.statics.getCurrentOTP = async function (email, purpose) {
  try {
    const otpRecord = await this.findOne({
      email: email.toLowerCase().trim(),
      purpose,
      isUsed: false,
    }).sort({ createdAt: -1 })

    return otpRecord
  } catch (error) {
    console.error(`❌ Error getting current OTP for ${email}:`, error)
    return null
  }
}

// Static method to clean expired OTPs
otpSchema.statics.cleanExpired = async function () {
  try {
    const result = await this.deleteMany({
      $or: [
        { expiresAt: { $lt: new Date() } },
        { isUsed: true, createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // Remove used OTPs older than 24 hours
      ],
    })
    console.log(`🧹 Cleaned ${result.deletedCount} expired/used OTPs`)
    return result
  } catch (error) {
    console.error("❌ Error cleaning expired OTPs:", error)
    throw error
  }
}

// Instance method to check if expired
otpSchema.methods.isExpired = function () {
  return this.expiresAt < new Date()
}

// Instance method to check if can retry
otpSchema.methods.canRetry = function () {
  return this.attempts < 5 && !this.isExpired() && !this.isUsed
}

const OTP = mongoose.model("OTP", otpSchema)

module.exports = OTP
