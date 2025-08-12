const express = require("express")
const router = express.Router({ mergeParams: true })
const AuthUtils = require("../../utils/auth")
const crypto = require("crypto") // For Razorpay signature verification

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

// Razorpay signature verification helper
const verifyRazorpaySignature = (orderId, paymentId, signature, secret) => {
  try {
    const body = orderId + "|" + paymentId
    const expectedSignature = crypto.createHmac("sha256", secret).update(body.toString()).digest("hex")

    return expectedSignature === signature
  } catch (error) {
    console.error("❌ Razorpay signature verification error:", error)
    return false
  }
}

// Test endpoint
router.get("/test", (req, res) => {
  res.json({
    message: "Orders route is working",
    storeId: req.storeId,
    tenantId: req.tenantId,
    storeName: req.storeInfo?.name || "Unknown Store",
    timestamp: new Date().toISOString(),
  })
})

// Create new order
router.post("/", authenticateCustomer, async (req, res) => {
  try {
    const {
      items,
      shippingAddress,
      paymentMethod,
      paymentStatus,
      notes,
      couponCode,
      // Razorpay payment data
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
    } = req.body

    const customer = req.customer
    console.log(`📦 Creating order for customer: ${customer.email}`)
    console.log(`💳 Payment method: ${paymentMethod}, Payment status: ${paymentStatus}`)

    // Step 1: Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Order items are required",
        code: "MISSING_ITEMS",
      })
    }

    // Step 2: Validate shipping address
    if (!shippingAddress) {
      return res.status(400).json({
        error: "Shipping address is required",
        code: "MISSING_ADDRESS",
      })
    }

    const requiredFields = ["name", "street", "city", "state", "zipCode"]
    const missingFields = requiredFields.filter((f) => !shippingAddress[f])
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: "Incomplete shipping address",
        missingFields,
        code: "INCOMPLETE_ADDRESS",
      })
    }

    // Step 3: Validate payment method and status
    const validPaymentMethods = ["online", "cod"]
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        error: "Invalid payment method",
        code: "INVALID_PAYMENT_METHOD",
      })
    }

    // Step 4: Verify Razorpay payment if online payment
    let finalPaymentStatus = paymentStatus || "pending"
    let paymentDetails = {}

    if (paymentMethod === "online") {
      if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
        return res.status(400).json({
          error: "Razorpay payment details are required for online payments",
          code: "MISSING_PAYMENT_DETAILS",
        })
      }

      // Get Razorpay secret from environment or settings
      const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || "your_razorpay_secret"

      // Verify Razorpay signature
      const isValidSignature = verifyRazorpaySignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        razorpaySecret,
      )

      if (!isValidSignature) {
        console.error("❌ Invalid Razorpay signature")
        return res.status(400).json({
          error: "Payment verification failed",
          code: "PAYMENT_VERIFICATION_FAILED",
        })
      }

      // Payment verified successfully
      finalPaymentStatus = "paid"
      paymentDetails = {
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature,
        verifiedAt: new Date(),
      }

      console.log("✅ Razorpay payment verified successfully")
    } else if (paymentMethod === "cod") {
      // COD orders should have pending payment status
      finalPaymentStatus = "pending"
    }

    // Step 5: Get Models
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Product = require("../../models/tenant/Product")(req.tenantDB)

    // Step 6: Validate products and compute totals
    let subtotal = 0
    const orderItems = []

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({
          error: "Each item must have a valid productId and quantity",
          code: "INVALID_ITEM_DATA",
        })
      }

      const product = await Product.findById(item.productId)
      if (!product || !product.isActive) {
        return res.status(400).json({
          error: `Product not found or inactive: ${item.productId}`,
          code: "INVALID_PRODUCT",
        })
      }

      // Check stock availability
      if (product.inventory && product.inventory.trackQuantity) {
        if (product.inventory.quantity < item.quantity) {
          return res.status(400).json({
            error: `Insufficient stock for: ${product.name}`,
            code: "INSUFFICIENT_STOCK",
            availableQuantity: product.inventory.quantity,
          })
        }
      }

      const itemTotal = product.price * item.quantity
      subtotal += itemTotal

      orderItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        total: itemTotal,
      })

      // Update product stock and sales count for paid orders
      if (finalPaymentStatus === "paid") {
        if (product.inventory && product.inventory.trackQuantity) {
          product.inventory.quantity -= item.quantity
        }
        product.salesCount = (product.salesCount || 0) + item.quantity
        await product.save()
      }
    }

    // Step 7: Calculate totals
    const tax = subtotal * 0.18 // 18% GST
    const shipping = 0 // Free shipping
    const discount = 0 // No discount for now
    const total = subtotal + tax + shipping - discount

    // Step 8: Create Order
    const orderData = {
      customerId: customer._id,
      customerInfo: {
        name: shippingAddress.name,
        email: customer.email,
        phone: customer.phone,
        address: {
          street: shippingAddress.street,
          city: shippingAddress.city,
          state: shippingAddress.state,
          zipCode: shippingAddress.zipCode,
          country: shippingAddress.country || "India",
        },
      },
      items: orderItems,
      subtotal,
      tax,
      shipping,
      discount,
      total,
      paymentMethod,
      paymentStatus: finalPaymentStatus, // ✅ Set the correct payment status
      notes,
      // Add payment details for online payments
      ...(paymentMethod === "online" && { paymentDetails }),
    }

    const newOrder = new Order(orderData)
    await newOrder.save() // auto-generates orderNumber in pre("save") hook

    console.log(`✅ Order created successfully: ${newOrder.orderNumber} with payment status: ${finalPaymentStatus}`)

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: {
        _id: newOrder._id,
        orderNumber: newOrder.orderNumber,
        status: newOrder.status,
        paymentStatus: newOrder.paymentStatus,
        paymentMethod: newOrder.paymentMethod,
        total: newOrder.total,
        items: newOrder.items,
        customerInfo: newOrder.customerInfo,
        createdAt: newOrder.createdAt,
        ...(paymentMethod === "online" && {
          paymentDetails: {
            razorpayPaymentId,
            razorpayOrderId,
            verified: true,
          },
        }),
      },
    })
  } catch (error) {
    console.error("❌ Create order error:", error)
    return res.status(500).json({
      success: false,
      error: "Failed to create order",
      details: error.message,
      code: "ORDER_CREATION_ERROR",
    })
  }
})

// Get customer orders
router.get("/", authenticateCustomer, async (req, res) => {
  try {
    const customer = req.customer
    const { page = 1, limit = 10, status, sortBy = "createdAt", sortOrder = "desc" } = req.query

    console.log(`📋 Getting orders for customer: ${customer.email}`)

    const Order = require("../../models/tenant/Order")(req.tenantDB)

    // Build query
    const query = { customerId: customer._id }
    if (status) {
      query.status = status
    }

    // Calculate pagination
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Build sort object
    const sort = {}
    sort[sortBy] = sortOrder === "desc" ? -1 : 1

    // Get orders
    let orders
    try {
      orders = await Order.find(query)
        .sort(sort)
        .skip(skip)
        .limit(Number.parseInt(limit))
        .populate("items.productId", "name images slug")
        .lean()
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate")
      orders = await Order.find(query).sort(sort).skip(skip).limit(Number.parseInt(limit)).lean()
    }

    // Get total count
    const totalOrders = await Order.countDocuments(query)
    const totalPages = Math.ceil(totalOrders / Number.parseInt(limit))

    console.log(`✅ Found ${orders.length} orders for customer: ${customer.email}`)

    res.json({
      success: true,
      message: "Orders retrieved successfully",
      orders,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalOrders,
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        limit: Number.parseInt(limit),
      },
      filters: {
        status,
        sortBy,
        sortOrder,
      },
    })
  } catch (error) {
    console.error("❌ Get orders error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get orders",
      details: error.message,
      code: "GET_ORDERS_ERROR",
    })
  }
})

// Get specific order details
router.get("/:orderId", authenticateCustomer, async (req, res) => {
  try {
    const { orderId } = req.params
    const customer = req.customer

    console.log(`📋 Getting order details: ${orderId}`)

    const Order = require("../../models/tenant/Order")(req.tenantDB)

    let order
    try {
      order = await Order.findOne({
        _id: orderId,
        customerId: customer._id,
      }).populate("items.productId", "name images slug price")
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate")
      order = await Order.findOne({
        _id: orderId,
        customerId: customer._id,
      })
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    console.log(`✅ Order details retrieved: ${order.orderNumber}`)

    res.json({
      success: true,
      message: "Order details retrieved successfully",
      order,
    })
  } catch (error) {
    console.error("❌ Get order details error:", error)
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        error: "Invalid order ID format",
        code: "INVALID_ORDER_ID",
      })
    }
    res.status(500).json({
      success: false,
      error: "Failed to get order details",
      details: error.message,
      code: "ORDER_DETAILS_ERROR",
    })
  }
})

// Cancel order
router.put("/:orderId/cancel", authenticateCustomer, async (req, res) => {
  try {
    const { orderId } = req.params
    const { reason } = req.body
    const customer = req.customer

    console.log(`❌ Cancelling order: ${orderId}`)

    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Product = require("../../models/tenant/Product")(req.tenantDB)

    const order = await Order.findOne({
      _id: orderId,
      customerId: customer._id,
    })

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    // Check if order can be cancelled
    if (order.status === "cancelled") {
      return res.status(400).json({
        success: false,
        error: "Order is already cancelled",
        code: "ORDER_ALREADY_CANCELLED",
      })
    }

    if (order.status === "shipped" || order.status === "delivered") {
      return res.status(400).json({
        success: false,
        error: "Cannot cancel shipped or delivered orders",
        code: "ORDER_CANNOT_BE_CANCELLED",
      })
    }

    // Restore product stock
    for (const item of order.items) {
      const product = await Product.findById(item.productId)
      if (product) {
        if (product.inventory && product.inventory.trackQuantity) {
          product.inventory.quantity += item.quantity
        }
        product.salesCount = Math.max(0, (product.salesCount || 0) - item.quantity)
        await product.save()
      }
    }

    // Update order status
    order.status = "cancelled"
    order.notes = `${order.notes || ""}\nCancelled by customer. Reason: ${reason || "No reason provided"}`
    await order.save()

    console.log(`✅ Order cancelled: ${order.orderNumber}`)

    res.json({
      success: true,
      message: "Order cancelled successfully",
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        notes: order.notes,
        cancelledAt: new Date(),
      },
    })
  } catch (error) {
    console.error("❌ Cancel order error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to cancel order",
      details: error.message,
      code: "ORDER_CANCELLATION_ERROR",
    })
  }
})

// Track order status
router.get("/:orderId/track", authenticateCustomer, async (req, res) => {
  try {
    const { orderId } = req.params
    const customer = req.customer

    console.log(`🚚 Tracking order: ${orderId}`)

    const Order = require("../../models/tenant/Order")(req.tenantDB)

    const order = await Order.findOne({
      _id: orderId,
      customerId: customer._id,
    })

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    // Create tracking timeline
    const timeline = [
      {
        status: "pending",
        title: "Order Placed",
        description: "Your order has been placed successfully",
        timestamp: order.createdAt,
        completed: true,
      },
      {
        status: "confirmed",
        title: "Order Confirmed",
        description: "Your order has been confirmed and is being prepared",
        timestamp: order.status === "confirmed" ? order.updatedAt : null,
        completed: ["confirmed", "processing", "shipped", "delivered"].includes(order.status),
      },
      {
        status: "processing",
        title: "Processing",
        description: "Your order is being processed",
        timestamp: order.status === "processing" ? order.updatedAt : null,
        completed: ["processing", "shipped", "delivered"].includes(order.status),
      },
      {
        status: "shipped",
        title: "Shipped",
        description: "Your order has been shipped",
        timestamp: order.status === "shipped" ? order.updatedAt : null,
        completed: ["shipped", "delivered"].includes(order.status),
        trackingNumber: order.trackingNumber,
      },
      {
        status: "delivered",
        title: "Delivered",
        description: "Your order has been delivered",
        timestamp: order.deliveredAt,
        completed: order.status === "delivered",
      },
    ]

    // Handle cancelled orders
    if (order.status === "cancelled") {
      timeline.push({
        status: "cancelled",
        title: "Order Cancelled",
        description: "Your order has been cancelled",
        timestamp: order.updatedAt,
        completed: true,
      })
    }

    console.log(`✅ Order tracking retrieved: ${order.orderNumber}`)

    res.json({
      success: true,
      message: "Order tracking retrieved successfully",
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        estimatedDelivery: order.estimatedDelivery,
        trackingNumber: order.trackingNumber,
        total: order.total,
        createdAt: order.createdAt,
      },
      timeline,
    })
  } catch (error) {
    console.error("❌ Track order error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to track order",
      details: error.message,
      code: "ORDER_TRACKING_ERROR",
    })
  }
})

// Get order invoice/receipt
router.get("/:orderId/invoice", authenticateCustomer, async (req, res) => {
  try {
    const { orderId } = req.params
    const customer = req.customer

    console.log(`🧾 Getting invoice for order: ${orderId}`)

    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Settings = require("../../models/tenant/Settings")(req.tenantDB)

    const order = await Order.findOne({
      _id: orderId,
      customerId: customer._id,
    }).populate("items.productId", "name sku")

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    // Get store settings for invoice details
    const settings = await Settings.findOne()

    const invoice = {
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      },
      customer: {
        name: order.customerInfo.name,
        email: order.customerInfo.email,
        phone: order.customerInfo.phone,
        address: order.customerInfo.address,
      },
      store: {
        name: settings?.general?.storeName || req.storeInfo?.name || "Store",
        email: settings?.general?.supportEmail || "",
        phone: settings?.general?.supportPhone || "",
        address: settings?.general?.address || {},
      },
      items: order.items,
      summary: {
        subtotal: order.subtotal,
        discount: order.discount || 0,
        tax: order.tax || 0,
        shipping: order.shipping || 0,
        total: order.total,
      },
      appliedOffer: order.appliedOffer,
    }

    console.log(`✅ Invoice retrieved for order: ${order.orderNumber}`)

    res.json({
      success: true,
      message: "Invoice retrieved successfully",
      invoice,
    })
  } catch (error) {
    console.error("❌ Get invoice error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get invoice",
      details: error.message,
      code: "INVOICE_ERROR",
    })
  }
})

// Reorder (create new order from existing order)
router.post("/:orderId/reorder", authenticateCustomer, async (req, res) => {
  try {
    const { orderId } = req.params
    const { shippingAddress } = req.body
    const customer = req.customer

    console.log(`🔄 Reordering from order: ${orderId}`)

    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Product = require("../../models/tenant/Product")(req.tenantDB)

    const originalOrder = await Order.findOne({
      _id: orderId,
      customerId: customer._id,
    })

    if (!originalOrder) {
      return res.status(404).json({
        success: false,
        error: "Original order not found",
        code: "ORDER_NOT_FOUND",
      })
    }

    // Check product availability
    const unavailableItems = []
    const availableItems = []

    for (const item of originalOrder.items) {
      const product = await Product.findById(item.productId)
      if (!product || !product.isActive) {
        unavailableItems.push({
          name: item.name,
          reason: "Product no longer available",
        })
      } else {
        // Check stock availability
        let isAvailable = true
        if (product.inventory && product.inventory.trackQuantity) {
          if (product.inventory.quantity < item.quantity) {
            isAvailable = false
            unavailableItems.push({
              name: item.name,
              reason: "Insufficient stock",
              availableQuantity: product.inventory.quantity,
            })
          }
        }

        if (isAvailable) {
          availableItems.push({
            productId: item.productId,
            quantity: item.quantity,
          })
        }
      }
    }

    if (availableItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No items from the original order are available for reorder",
        unavailableItems,
        code: "NO_ITEMS_AVAILABLE",
      })
    }

    // Create new order with available items
    const reorderData = {
      items: availableItems,
      shippingAddress: shippingAddress || originalOrder.customerInfo.address,
      paymentMethod: originalOrder.paymentMethod,
      notes: `Reorder from ${originalOrder.orderNumber}`,
    }

    // Forward to create order endpoint
    req.body = reorderData
    return router.handle(req, res)
  } catch (error) {
    console.error("❌ Reorder error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to reorder",
      details: error.message,
      code: "REORDER_ERROR",
    })
  }
})

module.exports = router
