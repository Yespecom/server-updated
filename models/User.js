const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    storeId: {
      type: String,
      sparse: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    passwordChangedAt: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
)

// Indexes for performance
userSchema.index({ email: 1, isActive: 1 })
userSchema.index({ tenantId: 1 })
userSchema.index({ storeId: 1 })

// Virtual for account lock status
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now())
})

// Pre-save middleware to hash password
userSchema.pre("save", async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified("password")) return next()

  try {
    console.log(`🔐 Hashing password for user: ${this.email}`)
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12)
    this.password = await bcrypt.hash(this.password, salt)
    console.log(`✅ Password hashed for user: ${this.email}`)
    next()
  } catch (error) {
    console.error(`❌ Password hashing error for ${this.email}:`, error)
    next(error)
  }
})

// Static method for authentication
userSchema.statics.authenticate = async function (email, password) {
  try {
    console.log(`🔍 Authenticating user: ${email}`)

    const user = await this.findOne({
      email: email.toLowerCase().trim(),
      isActive: true,
    })

    if (!user) {
      console.log(`❌ User not found: ${email}`)
      return {
        success: false,
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      }
    }

    console.log(`✅ Found user: ${email}, ID: ${user._id}`)

    // Check if account is locked
    if (user.isLocked) {
      console.log(`❌ Account locked: ${email}`)
      return {
        success: false,
        error: "Account temporarily locked due to too many failed login attempts",
        code: "ACCOUNT_LOCKED",
        lockUntil: user.lockUntil,
      }
    }

    console.log(`🔍 Comparing password for user: ${email}`)
    console.log(`🔍 Candidate password length: ${password.length}`)
    console.log(`🔍 Stored password hash: ${user.password.substring(0, 20)}...`)

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password)
    console.log(`🔑 Password comparison result: ${isMatch}`)

    if (!isMatch) {
      console.log(`❌ Password mismatch: ${email}`)

      // Increment login attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1

      // Lock account after 5 failed attempts
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 30 * 60 * 1000 // 30 minutes
        console.log(`🔒 Account locked after 5 failed attempts: ${email}`)
      }

      await user.save()

      return {
        success: false,
        error: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      }
    }

    console.log(`✅ Password verified for: ${email}`)

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      user.loginAttempts = 0
      user.lockUntil = undefined
    }

    // Update last login
    user.lastLoginAt = new Date()
    await user.save()

    // Generate token
    const AuthUtils = require("../utils/auth")
    const token = AuthUtils.generateToken({
      userId: user._id,
      tenantId: user.tenantId,
      email: user.email,
      type: "admin",
    })

    console.log(`✅ Authentication successful for: ${email}`)

    return {
      success: true,
      user,
      token,
    }
  } catch (error) {
    console.error(`❌ Authentication error for ${email}:`, error)
    return {
      success: false,
      error: "Authentication failed",
      code: "AUTH_ERROR",
    }
  }
}

// Instance method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    console.log(`🔍 Comparing password for user: ${this.email}`)
    const isMatch = await bcrypt.compare(candidatePassword, this.password)
    console.log(`🔑 Password comparison result: ${isMatch}`)
    return isMatch
  } catch (error) {
    console.error(`❌ Password comparison error for ${this.email}:`, error)
    return false
  }
}

// Instance method to increment login attempts
userSchema.methods.incLoginAttempts = function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    })
  }

  const updates = { $inc: { loginAttempts: 1 } }

  // Lock the account if we've reached max attempts and it's not locked already
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 30 * 60 * 1000 } // 30 minutes
  }

  return this.updateOne(updates)
}

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  })
}

const User = mongoose.model("User", userSchema)

module.exports = User
