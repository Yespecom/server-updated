const mongoose = require("mongoose")

const customerOTPSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
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
      enum: ["login", "registration", "order_verification"],
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
    tenantId: {
      type: String,
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

// Compound indexes
customerOTPSchema.index({ phone: 1, tenantId: 1, purpose: 1 })
customerOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Static method to generate OTP
customerOTPSchema.statics.generateOTP = (length = 6) => {
  const digits = "0123456789"
  let otp = ""
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)]
  }
  return otp
}

// Static method to create OTP
customerOTPSchema.statics.createOTP = async function (phone, tenantId, purpose, clientInfo = {}, expiryMinutes = 10) {
  try {
    console.log(`🔢 Creating customer OTP for ${phone} in tenant ${tenantId} (${purpose})`)

    // Clean up existing OTPs
    await this.deleteMany({
      phone: phone.trim(),
      tenantId,
      purpose,
    })

    // Generate new OTP
    const otp = this.generateOTP(6)
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000)

    // Create new OTP record
    const otpRecord = new this({
      phone: phone.trim(),
      tenantId,
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
    console.log(`✅ Customer OTP created for ${phone}: ${otp}`)

    return otp
  } catch (error) {
    console.error(`❌ Error creating customer OTP for ${phone}:`, error)
    throw error
  }
}

// Static method to verify OTP
customerOTPSchema.statics.verifyOTP = async function (phone, tenantId, otp, purpose) {
  try {
    console.log(`🔍 Verifying customer OTP for ${phone} in tenant ${tenantId} (${purpose}): ${otp}`)

    const otpRecord = await this.findOne({
      phone: phone.trim(),
      tenantId,
      purpose,
      isUsed: false,
    }).sort({ createdAt: -1 })

    if (!otpRecord) {
      console.log(`❌ No customer OTP found for ${phone} in tenant ${tenantId}`)
      return {
        success: false,
        message: "Invalid or expired OTP",
        code: "INVALID_OTP",
      }
    }

    // Check if expired
    if (otpRecord.expiresAt < new Date()) {
      console.log(`❌ Customer OTP expired for ${phone}`)
      await otpRecord.deleteOne()
      return {
        success: false,
        message: "OTP has expired. Please request a new one.",
        code: "OTP_EXPIRED",
      }
    }

    // Check attempts
    if (otpRecord.attempts >= 5) {
      console.log(`❌ Too many attempts for customer ${phone}`)
      await otpRecord.deleteOne()
      return {
        success: false,
        message: "Too many failed attempts. Please request a new OTP.",
        code: "TOO_MANY_ATTEMPTS",
      }
    }

    // Verify OTP
    if (otpRecord.otp !== otp.toString()) {
      console.log(`❌ Customer OTP mismatch for ${phone}`)

      otpRecord.attempts += 1
      await otpRecord.save()

      return {
        success: false,
        message: `Invalid OTP. ${5 - otpRecord.attempts} attempts remaining.`,
        code: "INVALID_OTP",
        attemptsRemaining: 5 - otpRecord.attempts,
      }
    }

    console.log(`✅ Customer OTP verified for ${phone}`)

    // Mark as used
    otpRecord.isUsed = true
    await otpRecord.save()

    return {
      success: true,
      message: "OTP verified successfully",
      code: "OTP_VERIFIED",
    }
  } catch (error) {
    console.error(`❌ Error verifying customer OTP for ${phone}:`, error)
    return {
      success: false,
      message: "OTP verification failed",
      code: "VERIFICATION_ERROR",
    }
  }
}

// Static method to get current OTP (for debugging)
customerOTPSchema.statics.getCurrentOTP = async function (phone, tenantId, purpose) {
  try {
    const otpRecord = await this.findOne({
      phone: phone.trim(),
      tenantId,
      purpose,
      isUsed: false,
    }).sort({ createdAt: -1 })

    return otpRecord
  } catch (error) {
    console.error(`❌ Error getting current customer OTP for ${phone}:`, error)
    return null
  }
}

// Static method to clean expired OTPs
customerOTPSchema.statics.cleanExpired = async function () {
  try {
    const result = await this.deleteMany({
      $or: [
        { expiresAt: { $lt: new Date() } },
        { isUsed: true, createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    })
    console.log(`🧹 Cleaned ${result.deletedCount} expired customer OTPs`)
    return result
  } catch (error) {
    console.error("❌ Error cleaning expired customer OTPs:", error)
    throw error
  }
}

const CustomerOTP = mongoose.model("CustomerOTP", customerOTPSchema)

module.exports = CustomerOTP
