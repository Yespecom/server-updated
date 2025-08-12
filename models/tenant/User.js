module.exports = (tenantDB) => {
  const mongoose = require("mongoose")
  const bcrypt = require("bcryptjs")

  const tenantUserSchema = new mongoose.Schema(
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
      },
      phone: {
        type: String,
        default: "",
      },
      password: {
        type: String,
        required: true,
        minlength: 6,
      },
      role: {
        type: String,
        enum: ["owner", "admin", "manager", "staff"],
        default: "owner",
      },
      hasStore: {
        type: Boolean,
        default: false,
      },
      storeInfo: {
        name: String,
        logo: String,
        banner: String,
        storeId: String,
        industry: String,
        isActive: {
          type: Boolean,
          default: true,
        },
      },
      isActive: {
        type: Boolean,
        default: true,
      },
      emailVerified: {
        type: Boolean,
        default: false,
      },
      passwordChangedAt: {
        type: Date,
      },
      lastLoginAt: {
        type: Date,
      },
      permissions: {
        products: {
          type: Boolean,
          default: true,
        },
        orders: {
          type: Boolean,
          default: true,
        },
        customers: {
          type: Boolean,
          default: true,
        },
        analytics: {
          type: Boolean,
          default: true,
        },
        settings: {
          type: Boolean,
          default: true,
        },
      },
    },
    {
      timestamps: true,
    },
  )

  // Indexes
  tenantUserSchema.index({ email: 1 }, { unique: true })
  tenantUserSchema.index({ role: 1 })
  tenantUserSchema.index({ isActive: 1 })

  // Pre-save middleware to hash password
  tenantUserSchema.pre("save", async function (next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified("password")) return next()

    try {
      console.log(`🔐 TENANT: Hashing password for: ${this.email}`)
      // Hash password with cost of 12
      const salt = await bcrypt.genSalt(12)
      this.password = await bcrypt.hash(this.password, salt)
      console.log(`✅ TENANT: Password hashed for: ${this.email}`)
      next()
    } catch (error) {
      console.error(`❌ TENANT: Password hashing error for ${this.email}:`, error)
      next(error)
    }
  })

  // Method to compare password
  tenantUserSchema.methods.comparePassword = async function (candidatePassword) {
    try {
      console.log(`🔍 TENANT: Comparing password for: ${this.email}`)
      const isMatch = await bcrypt.compare(candidatePassword, this.password)
      console.log(`🔑 TENANT: Password comparison result: ${isMatch}`)
      return isMatch
    } catch (error) {
      console.error(`❌ TENANT: Password comparison error for ${this.email}:`, error)
      return false
    }
  }

  // Method to update last login
  tenantUserSchema.methods.updateLastLogin = function () {
    this.lastLoginAt = new Date()
    return this.save()
  }

  // Static method to find by email
  tenantUserSchema.statics.findByEmail = function (email) {
    return this.findOne({ email: email.toLowerCase().trim(), isActive: true })
  }

  // Virtual for full name (if needed)
  tenantUserSchema.virtual("displayName").get(function () {
    return this.name || this.email
  })

  // Transform output
  tenantUserSchema.methods.toJSON = function () {
    const userObject = this.toObject()
    delete userObject.password
    return userObject
  }

  return tenantDB.models.User || tenantDB.model("User", tenantUserSchema)
}
