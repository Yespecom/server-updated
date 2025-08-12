module.exports = (tenantDB) => {
  const mongoose = require("mongoose")
  const orderSchema = new mongoose.Schema(
    {
      orderNumber: {
        type: String,
        unique: true,
        required: false, // ✅ changed from true to false
      },
      customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
        required: true,
      },
      customerInfo: {
        name: String,
        email: String,
        phone: String,
        address: {
          street: String,
          city: String,
          state: String,
          zipCode: String,
          country: String,
        },
      },
      items: [
        {
          productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
          },
          name: String,
          price: Number,
          quantity: Number,
          total: Number,
        },
      ],
      subtotal: {
        type: Number,
        required: true,
      },
      tax: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      total: {
        type: Number,
        required: true,
      },
      status: {
        type: String,
        enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"],
        default: "pending",
      },
      paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed", "refunded"],
        default: "pending",
      },
      paymentMethod: {
        type: String,
        enum: ["cod", "online", "card", "wallet"],
        default: "cod",
      },
      notes: String,
      trackingNumber: String,
      estimatedDelivery: Date,
      deliveredAt: Date,
    },
    {
      timestamps: true,
    },
  )

  orderSchema.index({ orderNumber: 1 })
  orderSchema.index({ customerId: 1 })
  orderSchema.index({ status: 1 })
  orderSchema.index({ paymentStatus: 1 })
  orderSchema.index({ createdAt: -1 })

  // Pre-save hook to generate order number
  orderSchema.pre("save", async function (next) {
    if (!this.orderNumber) {
      const count = await this.constructor.countDocuments()
      this.orderNumber = `ORD-${Date.now()}-${(count + 1).toString().padStart(4, "0")}`
    }
    next()
  })

  return tenantDB.models.Order || tenantDB.model("Order", orderSchema)
}
