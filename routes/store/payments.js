const express = require("express")
const router = express.Router({ mergeParams: true })
const AuthUtils = require("../../utils/auth")

// Customer authentication middleware
const authenticateCustomer = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Access denied. Please login.",
        code: "NO_TOKEN",
      })
    }

    const token = authHeader.replace("Bearer ", "")
    let decoded

    try {
      decoded = AuthUtils.verifyToken(token)
    } catch (tokenError) {
      if (tokenError.message.includes("expired")) {
        return res.status(401).json({
          error: "Session expired. Please login again.",
          code: "TOKEN_EXPIRED",
        })
      }

      return res.status(401).json({
        error: "Invalid session. Please login again.",
        code: "TOKEN_INVALID",
      })
    }

    if (decoded.type !== "customer") {
      return res.status(401).json({
        error: "Invalid token type",
        code: "INVALID_TOKEN_TYPE",
      })
    }

    // Verify store context
    if (decoded.storeId !== req.storeId) {
      return res.status(401).json({
        error: "Access denied. Token is not valid for this store.",
        code: "INVALID_STORE_CONTEXT",
      })
    }

    if (!req.tenantDB) {
      return res.status(500).json({
        error: "Database not initialized",
        code: "DB_NOT_INITIALIZED",
      })
    }

    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    const customer = await Customer.findById(decoded.customerId)

    if (!customer) {
      return res.status(401).json({
        error: "Customer not found",
        code: "CUSTOMER_NOT_FOUND",
      })
    }

    if (!customer.isActive) {
      return res.status(401).json({
        error: "Account is deactivated",
        code: "ACCOUNT_DEACTIVATED",
      })
    }

    req.customer = customer
    req.customerId = customer._id
    req.authToken = token
    req.tokenPayload = decoded
    next()
  } catch (error) {
    console.error("❌ Customer auth middleware error:", error)
    res.status(500).json({
      error: "Authentication failed",
      code: "AUTH_ERROR",
    })
  }
}

// Test endpoint
router.get("/test", (req, res) => {
  res.json({
    message: "Payments route is working",
    storeId: req.storeId,
    tenantId: req.tenantId,
    storeName: req.storeInfo?.name || "Unknown Store",
    timestamp: new Date().toISOString(),
  })
})

// Get payment configuration (public key)
router.get("/config", async (req, res) => {
  try {
    console.log(`⚙️ Getting payment config for store: ${req.storeId}`)

    const Settings = require("../../models/tenant/Settings")(req.tenantDB)
    const settings = await Settings.findOne()

    if (!settings) {
      return res.status(404).json({
        error: "Store settings not found",
        code: "SETTINGS_NOT_FOUND",
      })
    }

    const paymentConfig = {
      codEnabled: settings.payment?.codEnabled !== false,
      onlinePaymentEnabled: settings.payment?.onlinePaymentEnabled || false,
      razorpay: {
        enabled: settings.payment?.razorpay?.enabled || false,
        keyId: settings.payment?.razorpay?.keyId || "", // Public key only
      },
      stripe: {
        enabled: settings.payment?.stripe?.enabled || false,
        publishableKey: settings.payment?.stripe?.publishableKey || "", // Public key only
      },
      paypal: {
        enabled: settings.payment?.paypal?.enabled || false,
        clientId: settings.payment?.paypal?.clientId || "", // Public key only
      },
      supportedMethods: [],
    }

    // Build supported methods array
    if (paymentConfig.codEnabled) {
      paymentConfig.supportedMethods.push({
        id: "cod",
        name: "Cash on Delivery",
        description: "Pay when your order is delivered",
        enabled: true,
      })
    }

    if (paymentConfig.razorpay.enabled && paymentConfig.razorpay.keyId) {
      paymentConfig.supportedMethods.push({
        id: "razorpay",
        name: "Online Payment",
        description: "Pay securely with cards, UPI, wallets",
        enabled: true,
      })
    }

    if (paymentConfig.stripe.enabled && paymentConfig.stripe.publishableKey) {
      paymentConfig.supportedMethods.push({
        id: "stripe",
        name: "Credit/Debit Card",
        description: "Pay with your credit or debit card",
        enabled: true,
      })
    }

    console.log(`✅ Payment config retrieved for store: ${req.storeId}`)

    res.json({
      message: "Payment configuration retrieved successfully",
      config: paymentConfig,
    })
  } catch (error) {
    console.error("❌ Get payment config error:", error)
    res.status(500).json({
      error: "Failed to get payment configuration",
      details: error.message,
      code: "PAYMENT_CONFIG_ERROR",
    })
  }
})

// Create Razorpay payment order
router.post("/create-order", authenticateCustomer, async (req, res) => {
  try {
    const { orderId, amount, currency = "INR" } = req.body
    const customer = req.customer

    console.log(`💳 Creating payment order for: ${orderId}`)

    // Validation
    if (!orderId || !amount) {
      return res.status(400).json({
        error: "Order ID and amount are required",
        code: "MISSING_PAYMENT_DATA",
      })
    }

    if (amount <= 0) {
      return res.status(400).json({
        error: "Amount must be greater than zero",
        code: "INVALID_AMOUNT",
      })
    }

    // Get models
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Payment = require("../../models/tenant/Payment")(req.tenantDB)
    const Settings = require("../../models/tenant/Settings")(req.tenantDB)

    // Verify order exists and belongs to customer
    const order = await Order.findOne({
      _id: orderId,
      customerId: customer._id,
    })

    if (!order) {
      return res.status(404).json({
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    // Verify amount matches order total
    if (Math.abs(amount - order.total) > 0.01) {
      return res.status(400).json({
        error: "Payment amount does not match order total",
        code: "AMOUNT_MISMATCH",
        orderTotal: order.total,
        paymentAmount: amount,
      })
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({ orderId: order._id })
    if (existingPayment && existingPayment.status === "completed") {
      return res.status(400).json({
        error: "Payment already completed for this order",
        code: "PAYMENT_ALREADY_COMPLETED",
      })
    }

    // Get payment settings
    const settings = await Settings.findOne()
    if (!settings?.payment?.onlinePaymentEnabled) {
      return res.status(400).json({
        error: "Online payment is not enabled",
        code: "PAYMENT_NOT_ENABLED",
      })
    }

    // Create or update payment record
    let payment = existingPayment
    if (!payment) {
      payment = new Payment({
        orderId: order._id,
        customerId: customer._id,
        amount: amount,
        currency: currency,
        method: "online",
        status: "pending",
      })
    } else if (payment.status === "failed") {
      // Reset failed payment
      payment.status = "pending"
      payment.failureReason = null
      payment.gatewayResponse = null
    }

    await payment.save()

    // Create payment gateway order (Razorpay example)
    let gatewayOrder = null
    let publicKey = null

    if (settings.payment?.razorpay?.enabled && settings.payment.razorpay.keyId) {
      // In a real implementation, you would create a Razorpay order here
      // For now, we'll simulate the response
      gatewayOrder = {
        id: `order_${Date.now()}`,
        amount: Math.round(amount * 100), // Razorpay expects amount in paise
        currency: currency,
        receipt: payment.transactionId,
      }

      payment.gateway = "razorpay"
      payment.gatewayResponse = { orderId: gatewayOrder.id }
      await payment.save()

      publicKey = settings.payment.razorpay.keyId
    } else if (settings.payment?.stripe?.enabled && settings.payment.stripe.publishableKey) {
      // Stripe implementation would go here
      gatewayOrder = {
        id: `pi_${Date.now()}`,
        amount: Math.round(amount * 100), // Stripe expects amount in cents
        currency: currency.toLowerCase(),
        client_secret: `pi_${Date.now()}_secret_${Math.random().toString(36).substring(7)}`,
      }

      payment.gateway = "stripe"
      payment.gatewayResponse = { paymentIntentId: gatewayOrder.id }
      await payment.save()

      publicKey = settings.payment.stripe.publishableKey
    } else {
      return res.status(400).json({
        error: "No payment gateway is properly configured",
        code: "NO_GATEWAY_CONFIGURED",
      })
    }

    console.log(`✅ Payment order created: ${payment.transactionId}`)

    res.json({
      message: "Payment order created successfully",
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        gateway: payment.gateway,
      },
      gatewayOrder,
      publicKey, // Public key for frontend
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        total: order.total,
      },
    })
  } catch (error) {
    console.error("❌ Create payment order error:", error)
    res.status(500).json({
      error: "Failed to create payment order",
      details: error.message,
      code: "PAYMENT_ORDER_ERROR",
    })
  }
})

// Verify payment (Razorpay/Stripe)
router.post("/verify-payment", authenticateCustomer, async (req, res) => {
  try {
    const { paymentId, gatewayPaymentId, gatewayOrderId, gatewaySignature, gateway = "razorpay" } = req.body
    const customer = req.customer

    console.log(`🔍 Verifying payment: ${paymentId}`)

    // Validation
    if (!paymentId || !gatewayPaymentId) {
      return res.status(400).json({
        error: "Payment verification data is incomplete",
        code: "INCOMPLETE_PAYMENT_DATA",
      })
    }

    // Get models
    const Payment = require("../../models/tenant/Payment")(req.tenantDB)
    const Order = require("../../models/tenant/Order")(req.tenantDB)

    // Find payment record
    const payment = await Payment.findOne({
      _id: paymentId,
      customerId: customer._id,
    })

    if (!payment) {
      return res.status(404).json({
        error: "Payment record not found",
        code: "PAYMENT_NOT_FOUND",
      })
    }

    if (payment.status === "completed") {
      return res.status(400).json({
        error: "Payment already completed",
        code: "PAYMENT_ALREADY_COMPLETED",
      })
    }

    // In a real implementation, you would verify the signature with the payment gateway
    // For Razorpay: verify signature using webhook secret
    // For Stripe: verify using webhook endpoint secret
    const isSignatureValid = true // This should be actual signature verification

    if (!isSignatureValid) {
      payment.status = "failed"
      payment.failureReason = "Invalid payment signature"
      await payment.save()

      return res.status(400).json({
        error: "Payment verification failed",
        code: "PAYMENT_VERIFICATION_FAILED",
      })
    }

    // Update payment record
    payment.status = "completed"
    payment.gatewayTransactionId = gatewayPaymentId
    payment.gatewayResponse = {
      ...payment.gatewayResponse,
      paymentId: gatewayPaymentId,
      orderId: gatewayOrderId,
      signature: gatewaySignature,
      verifiedAt: new Date(),
    }
    payment.processedAt = new Date()
    await payment.save()

    // Update order payment status
    const order = await Order.findById(payment.orderId)
    if (order) {
      order.paymentStatus = "paid"
      if (order.status === "pending") {
        order.status = "confirmed"
      }
      await order.save()
    }

    console.log(`✅ Payment verified successfully: ${payment.transactionId}`)

    res.json({
      message: "Payment verified successfully",
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        status: payment.status,
        amount: payment.amount,
        gateway: payment.gateway,
        processedAt: payment.processedAt,
      },
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
    })
  } catch (error) {
    console.error("❌ Verify payment error:", error)
    res.status(500).json({
      error: "Failed to verify payment",
      details: error.message,
      code: "PAYMENT_VERIFICATION_ERROR",
    })
  }
})

// Get payment status
router.get("/status/:paymentId", authenticateCustomer, async (req, res) => {
  try {
    const { paymentId } = req.params
    const customer = req.customer

    console.log(`📊 Getting payment status: ${paymentId}`)

    const Payment = require("../../models/tenant/Payment")(req.tenantDB)

    const payment = await Payment.findOne({
      _id: paymentId,
      customerId: customer._id,
    }).populate("orderId", "orderNumber status total")

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found",
        code: "PAYMENT_NOT_FOUND",
      })
    }

    console.log(`✅ Payment status retrieved: ${payment.status}`)

    res.json({
      message: "Payment status retrieved successfully",
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        gateway: payment.gateway,
        gatewayTransactionId: payment.gatewayTransactionId,
        processedAt: payment.processedAt,
        failureReason: payment.failureReason,
        createdAt: payment.createdAt,
        order: payment.orderId,
      },
    })
  } catch (error) {
    console.error("❌ Get payment status error:", error)

    if (error.name === "CastError") {
      return res.status(400).json({
        error: "Invalid payment ID format",
        code: "INVALID_PAYMENT_ID",
      })
    }

    res.status(500).json({
      error: "Failed to get payment status",
      details: error.message,
      code: "PAYMENT_STATUS_ERROR",
    })
  }
})

// Handle payment failure
router.post("/payment-failed", authenticateCustomer, async (req, res) => {
  try {
    const { paymentId, reason, errorCode, errorDescription } = req.body
    const customer = req.customer

    console.log(`❌ Handling payment failure: ${paymentId}`)

    const Payment = require("../../models/tenant/Payment")(req.tenantDB)

    const payment = await Payment.findOne({
      _id: paymentId,
      customerId: customer._id,
    })

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found",
        code: "PAYMENT_NOT_FOUND",
      })
    }

    // Update payment status
    payment.status = "failed"
    payment.failureReason = reason || "Payment failed"
    payment.gatewayResponse = {
      ...payment.gatewayResponse,
      errorCode,
      errorDescription,
      failedAt: new Date(),
    }
    await payment.save()

    console.log(`✅ Payment failure recorded: ${payment.transactionId}`)

    res.json({
      message: "Payment failure recorded",
      payment: {
        id: payment._id,
        transactionId: payment.transactionId,
        status: payment.status,
        failureReason: payment.failureReason,
      },
      canRetry: true,
      retryMessage: "You can try again with a different payment method",
    })
  } catch (error) {
    console.error("❌ Handle payment failure error:", error)
    res.status(500).json({
      error: "Failed to handle payment failure",
      details: error.message,
      code: "PAYMENT_FAILURE_ERROR",
    })
  }
})

// Get customer payment history
router.get("/history", authenticateCustomer, async (req, res) => {
  try {
    const customer = req.customer
    const { page = 1, limit = 10, status, method } = req.query

    console.log(`💳 Getting payment history for customer: ${customer.email}`)

    const Payment = require("../../models/tenant/Payment")(req.tenantDB)

    // Build query
    const query = { customerId: customer._id }
    if (status) query.status = status
    if (method) query.method = method

    // Calculate pagination
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Get payments
    const payments = await Payment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number.parseInt(limit))
      .populate("orderId", "orderNumber status")
      .lean()

    // Get total count
    const totalPayments = await Payment.countDocuments(query)
    const totalPages = Math.ceil(totalPayments / Number.parseInt(limit))

    console.log(`✅ Found ${payments.length} payments for customer: ${customer.email}`)

    res.json({
      message: "Payment history retrieved successfully",
      payments,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalPayments,
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        limit: Number.parseInt(limit),
      },
      filters: {
        status,
        method,
      },
    })
  } catch (error) {
    console.error("❌ Get payment history error:", error)
    res.status(500).json({
      error: "Failed to get payment history",
      details: error.message,
      code: "PAYMENT_HISTORY_ERROR",
    })
  }
})

// Refund request (customer initiated)
router.post("/:paymentId/refund-request", authenticateCustomer, async (req, res) => {
  try {
    const { paymentId } = req.params
    const { reason, amount } = req.body
    const customer = req.customer

    console.log(`💰 Refund request for payment: ${paymentId}`)

    const Payment = require("../../models/tenant/Payment")(req.tenantDB)
    const Order = require("../../models/tenant/Order")(req.tenantDB)

    const payment = await Payment.findOne({
      _id: paymentId,
      customerId: customer._id,
    })

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found",
        code: "PAYMENT_NOT_FOUND",
      })
    }

    if (payment.status !== "completed") {
      return res.status(400).json({
        error: "Only completed payments can be refunded",
        code: "PAYMENT_NOT_COMPLETED",
      })
    }

    // Check if refund already requested
    if (payment.refundAmount > 0) {
      return res.status(400).json({
        error: "Refund already processed or requested",
        code: "REFUND_ALREADY_EXISTS",
      })
    }

    // Validate refund amount
    const refundAmount = amount || payment.amount
    if (refundAmount > payment.amount) {
      return res.status(400).json({
        error: "Refund amount cannot exceed payment amount",
        code: "INVALID_REFUND_AMOUNT",
      })
    }

    // Get associated order
    const order = await Order.findById(payment.orderId)
    if (!order) {
      return res.status(404).json({
        error: "Associated order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    // Check if order allows refund (based on status and time)
    const daysSinceOrder = Math.floor((new Date() - order.createdAt) / (1000 * 60 * 60 * 24))
    if (daysSinceOrder > 30) {
      return res.status(400).json({
        error: "Refund period has expired (30 days)",
        code: "REFUND_PERIOD_EXPIRED",
      })
    }

    if (!["delivered", "cancelled"].includes(order.status)) {
      return res.status(400).json({
        error: "Order must be delivered or cancelled to request refund",
        code: "INVALID_ORDER_STATUS",
      })
    }

    // Update payment with refund request
    payment.refundAmount = refundAmount
    payment.refundReason = reason || "Customer requested refund"
    payment.status = "refund_requested"
    payment.gatewayResponse = {
      ...payment.gatewayResponse,
      refundRequestedAt: new Date(),
      refundRequestedBy: customer._id,
    }
    await payment.save()

    console.log(`✅ Refund requested: ${payment.transactionId}`)

    res.json({
      message: "Refund request submitted successfully",
      refund: {
        paymentId: payment._id,
        transactionId: payment.transactionId,
        refundAmount: payment.refundAmount,
        refundReason: payment.refundReason,
        status: "requested",
        estimatedProcessingTime: "3-5 business days",
      },
    })
  } catch (error) {
    console.error("❌ Refund request error:", error)
    res.status(500).json({
      error: "Failed to process refund request",
      details: error.message,
      code: "REFUND_REQUEST_ERROR",
    })
  }
})

module.exports = router
