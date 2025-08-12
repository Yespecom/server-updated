module.exports = (tenantDB) => {
  const mongoose = require("mongoose")

  const offerSchema = new mongoose.Schema(
    {
      title: {
        type: String,
        required: true,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
      },
      type: {
        type: String,
        enum: ["percentage", "fixed", "bogo", "free_shipping"],
        required: true,
      },
      value: {
        type: Number,
        required: true,
      },
      code: {
        type: String,
        unique: true,
        sparse: true,
        uppercase: true,
      },
      minOrderValue: {
        type: Number,
        default: 0,
      },
      maxDiscount: {
        type: Number,
      },
      usageLimit: {
        type: Number,
        default: null, // null means unlimited
      },
      usedCount: {
        type: Number,
        default: 0,
      },
      applicableProducts: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
      ],
      applicableCategories: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Category",
        },
      ],
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: true,
      },
      isActive: {
        type: Boolean,
        default: true,
      },
      isPublic: {
        type: Boolean,
        default: true,
      },
    },
    {
      timestamps: true,
    },
  )

  // Indexes
  offerSchema.index({ code: 1 })
  offerSchema.index({ isActive: 1 })
  offerSchema.index({ startDate: 1, endDate: 1 })
  offerSchema.index({ type: 1 })

  // Virtual to check if offer is currently valid
  offerSchema.virtual("isValid").get(function () {
    const now = new Date()
    return (
      this.isActive &&
      this.startDate <= now &&
      this.endDate >= now &&
      (this.usageLimit === null || this.usedCount < this.usageLimit)
    )
  })

  // Method to apply offer
  offerSchema.methods.applyOffer = function (orderValue, productIds = []) {
    if (!this.isValid) {
      return { success: false, message: "Offer is not valid" }
    }

    if (orderValue < this.minOrderValue) {
      return { success: false, message: `Minimum order value is ${this.minOrderValue}` }
    }

    let discount = 0

    switch (this.type) {
      case "percentage":
        discount = (orderValue * this.value) / 100
        if (this.maxDiscount && discount > this.maxDiscount) {
          discount = this.maxDiscount
        }
        break
      case "fixed":
        discount = Math.min(this.value, orderValue)
        break
      case "free_shipping":
        discount = 0 // Handled separately in shipping calculation
        break
      default:
        return { success: false, message: "Invalid offer type" }
    }

    return {
      success: true,
      discount: discount,
      type: this.type,
      title: this.title,
    }
  }

  return tenantDB.models.Offer || tenantDB.model("Offer", offerSchema)
}
