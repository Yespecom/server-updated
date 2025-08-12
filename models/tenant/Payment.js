module.exports = (tenantDB) => {
  const mongoose = require("mongoose")

  const paymentSchema = new mongoose.Schema(
    {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        required: true,
      },
      customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
        required: true,
      },
      amount: {
        type: Number,
        required: true,
      },
      currency: {
        type: String,
        default: "INR",
      },
      method: {
        type: String,
        enum: ["cod", "online", "card", "wallet", "upi", "netbanking"],
        required: true,
      },
      status: {
        type: String,
        enum: ["pending", "processing", "completed", "failed", "cancelled", "refunded"],
        default: "pending",
      },
      transactionId: {
        type: String,
        unique: true,
        sparse: true,
      },
      gatewayTransactionId: {
        type: String,
      },
      gateway: {
        type: String,
        enum: ["razorpay", "stripe", "payu", "cashfree", "phonepe", "gpay"],
      },
      gatewayResponse: {
        type: mongoose.Schema.Types.Mixed,
      },
      failureReason: {
        type: String,
      },
      refundAmount: {
        type: Number,
        default: 0,
      },
      refundReason: {
        type: String,
      },
      refundedAt: {
        type: Date,
      },
      processedAt: {
        type: Date,
      },
      notes: {
        type: String,
      },
    },
    {
      timestamps: true,
    },
  )

  // Indexes
  paymentSchema.index({ orderId: 1 })
  paymentSchema.index({ customerId: 1 })
  paymentSchema.index({ status: 1 })
  paymentSchema.index({ method: 1 })
  paymentSchema.index({ transactionId: 1 })
  paymentSchema.index({ createdAt: -1 })

  // Generate transaction ID
  paymentSchema.pre("save", function (next) {
    if (!this.transactionId) {
      this.transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    }
    next()
  })

  // Method to process payment
  paymentSchema.methods.processPayment = async function () {
    try {
      this.status = "processing"
      this.processedAt = new Date()
      await this.save()

      // Here you would integrate with actual payment gateway
      // For now, we'll simulate success for COD and failure for others randomly
      if (this.method === "cod") {
        this.status = "completed"
        this.gatewayTransactionId = `COD-${Date.now()}`
      } else {
        // Simulate payment processing
        const success = Math.random() > 0.1 // 90% success rate
        if (success) {
          this.status = "completed"
          this.gatewayTransactionId = `PAY-${Date.now()}`
        } else {
          this.status = "failed"
          this.failureReason = "Payment declined by bank"
        }
      }

      await this.save()
      return { success: this.status === "completed", payment: this }
    } catch (error) {
      this.status = "failed"
      this.failureReason = error.message
      await this.save()
      return { success: false, error: error.message }
    }
  }

  return tenantDB.models.Payment || tenantDB.model("Payment", paymentSchema)
}
