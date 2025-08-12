const express = require("express")
const router = express.Router()

// Add logging middleware for payments routes
router.use((req, res, next) => {
  console.log(`💳 Admin Payments: ${req.method} ${req.path}`)
  console.log(`💳 Full URL: ${req.originalUrl}`)
  console.log(`💳 Has tenantDB: ${!!req.tenantDB}`)
  console.log(`💳 Tenant ID: ${req.tenantId}`)
  next()
})

// Middleware to ensure Payment model is available
const ensurePaymentModel = (req, res, next) => {
  try {
    if (!req.tenantDB) {
      console.error("❌ No tenant database connection available")
      return res.status(500).json({
        error: "Database connection not available",
        details: "Tenant database connection is missing",
      })
    }

    // Initialize Payment model
    const Payment = require("../../models/tenant/Payment")(req.tenantDB)
    req.PaymentModel = Payment

    console.log("✅ Payment model initialized successfully")
    next()
  } catch (error) {
    console.error("❌ Error initializing Payment model:", error)
    res.status(500).json({
      error: "Failed to initialize payment model",
      details: error.message,
    })
  }
}

// Apply the model middleware to all routes
router.use(ensurePaymentModel)

// Test endpoint to verify payments route is working
router.get("/test", (req, res) => {
  console.log("🧪 Admin payments test endpoint reached")
  res.json({
    message: "Admin payments routes are working",
    path: req.path,
    originalUrl: req.originalUrl,
    hasTenantDB: !!req.tenantDB,
    hasPaymentModel: !!req.PaymentModel,
    tenantId: req.tenantId,
    timestamp: new Date().toISOString(),
  })
})

// Get payment summary - MUST come before /:id route
router.get("/summary", async (req, res) => {
  try {
    console.log("📊 Fetching payment summary...")

    const Payment = req.PaymentModel

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const thisMonth = new Date()
    thisMonth.setDate(1)
    thisMonth.setHours(0, 0, 0, 0)

    // Today's revenue (only successful payments)
    const todayRevenue = await Payment.aggregate([
      {
        $match: {
          status: "success",
          createdAt: { $gte: today },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    // This month's revenue (only successful payments)
    const monthRevenue = await Payment.aggregate([
      {
        $match: {
          status: "success",
          createdAt: { $gte: thisMonth },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    // Total revenue (only successful payments)
    const totalRevenue = await Payment.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])

    // Additional stats for admin dashboard
    const totalPayments = await Payment.countDocuments()
    const successfulPayments = await Payment.countDocuments({ status: "success" })
    const failedPayments = await Payment.countDocuments({ status: "failed" })
    const pendingPayments = await Payment.countDocuments({ status: "pending" })

    const summary = {
      todayRevenue: todayRevenue[0]?.total || 0,
      monthRevenue: monthRevenue[0]?.total || 0,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalPayments,
      successfulPayments,
      failedPayments,
      pendingPayments,
      successRate: totalPayments > 0 ? ((successfulPayments / totalPayments) * 100).toFixed(1) : 0,
      averageOrderValue: successfulPayments > 0 ? ((totalRevenue[0]?.total || 0) / successfulPayments).toFixed(2) : 0,
    }

    console.log("✅ Payment summary:", summary)
    res.json(summary)
  } catch (error) {
    console.error("❌ Payment summary error:", error)
    res.status(500).json({
      error: "Failed to fetch payment summary",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
})

// Get all payments (including failed, pending, and successful)
router.get("/", async (req, res) => {
  try {
    console.log("💳 Fetching all payments...")

    const Payment = req.PaymentModel

    // Get query parameters for filtering
    const {
      status,
      method,
      limit = 50,
      page = 1,
      sortBy = "createdAt",
      sortOrder = "desc",
      startDate,
      endDate,
    } = req.query

    // Build filter object
    const filter = {}

    if (status && status !== "all") {
      filter.status = status
    }

    if (method && method !== "all") {
      filter.method = method
    }

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate)
      }
      if (endDate) {
        const endDateTime = new Date(endDate)
        endDateTime.setHours(23, 59, 59, 999) // End of day
        filter.createdAt.$lte = endDateTime
      }
    }

    // Calculate pagination
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)
    const sortDirection = sortOrder === "desc" ? -1 : 1

    // Build sort object
    const sort = {}
    sort[sortBy] = sortDirection

    console.log("🔍 Payment query:", { filter, sort, limit: Number.parseInt(limit), skip })

    // Get payments with optional filtering and pagination
    const payments = await Payment.find(filter).sort(sort).limit(Number.parseInt(limit)).skip(skip).lean() // Use lean for better performance

    // Get total count for pagination
    const totalCount = await Payment.countDocuments(filter)

    // Get summary stats for the filtered results
    const summaryStats = await Payment.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ])

    console.log(`✅ Found ${payments.length} payments (${totalCount} total)`)

    res.json({
      payments,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages: Math.ceil(totalCount / Number.parseInt(limit)),
        totalCount,
        hasNext: skip + payments.length < totalCount,
        hasPrev: Number.parseInt(page) > 1,
        limit: Number.parseInt(limit),
      },
      summary: summaryStats,
      filters: {
        status,
        method,
        startDate,
        endDate,
        sortBy,
        sortOrder,
      },
    })
  } catch (error) {
    console.error("❌ Get payments error:", error)
    res.status(500).json({
      error: "Failed to fetch payments",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
})

// Get payment statistics
router.get("/stats/overview", async (req, res) => {
  try {
    console.log("📈 Fetching payment statistics...")

    const Payment = req.PaymentModel

    // Get payments by status
    const statusStats = await Payment.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ])

    // Get payments by method
    const methodStats = await Payment.aggregate([
      {
        $group: {
          _id: "$method",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ])

    // Get daily revenue for last 30 days (successful payments only)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const dailyRevenue = await Payment.aggregate([
      {
        $match: {
          status: "success",
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 },
      },
    ])

    // Get hourly distribution for today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const hourlyStats = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: today, $lt: tomorrow },
        },
      },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          count: { $sum: 1 },
          revenue: { $sum: { $cond: [{ $eq: ["$status", "success"] }, "$amount", 0] } },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ])

    const stats = {
      statusBreakdown: statusStats,
      methodBreakdown: methodStats,
      dailyRevenue: dailyRevenue,
      hourlyDistribution: hourlyStats,
      generatedAt: new Date().toISOString(),
    }

    console.log("✅ Payment statistics fetched")
    res.json(stats)
  } catch (error) {
    console.error("❌ Payment statistics error:", error)
    res.status(500).json({
      error: "Failed to fetch payment statistics",
      details: error.message,
    })
  }
})

// Get payment details - MUST come after other specific routes
router.get("/:id", async (req, res) => {
  try {
    console.log("🔍 Fetching payment details for ID:", req.params.id)

    const Payment = req.PaymentModel

    // Try to find by MongoDB _id first, then by paymentId
    let payment = await Payment.findById(req.params.id)

    if (!payment) {
      payment = await Payment.findOne({ paymentId: req.params.id })
    }

    if (!payment) {
      console.log("❌ Payment not found:", req.params.id)
      return res.status(404).json({
        error: "Payment not found",
        searchedId: req.params.id,
      })
    }

    console.log("✅ Payment found:", payment.paymentId || payment._id)
    res.json(payment)
  } catch (error) {
    console.error("❌ Get payment details error:", error)

    // Handle invalid ObjectId error
    if (error.name === "CastError") {
      return res.status(400).json({
        error: "Invalid payment ID format",
        details: error.message,
      })
    }

    res.status(500).json({
      error: "Failed to fetch payment details",
      details: error.message,
    })
  }
})

// Update payment status (admin action)
router.put("/:id/status", async (req, res) => {
  try {
    console.log("🔄 Updating payment status for ID:", req.params.id)

    const { status, notes } = req.body
    const validStatuses = ["pending", "success", "failed", "cancelled", "refunded"]

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        validStatuses,
        provided: status,
      })
    }

    const Payment = req.PaymentModel

    let payment = await Payment.findById(req.params.id)
    if (!payment) {
      payment = await Payment.findOne({ paymentId: req.params.id })
    }

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" })
    }

    const oldStatus = payment.status
    payment.status = status

    if (notes) {
      if (!payment.gatewayResponse) {
        payment.gatewayResponse = {}
      }
      payment.gatewayResponse.adminNotes = notes
      payment.gatewayResponse.statusUpdatedAt = new Date()
      payment.gatewayResponse.statusUpdatedBy = req.user?.email || "admin"
    }

    await payment.save()

    console.log(`✅ Payment status updated: ${oldStatus} → ${status}`)

    res.json({
      message: "Payment status updated successfully",
      payment: {
        id: payment._id,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        oldStatus,
        newStatus: status,
        updatedAt: payment.updatedAt,
      },
    })
  } catch (error) {
    console.error("❌ Update payment status error:", error)
    res.status(500).json({
      error: "Failed to update payment status",
      details: error.message,
    })
  }
})

// Export payments data (CSV format)
router.get("/export/csv", async (req, res) => {
  try {
    console.log("📊 Exporting payments to CSV...")

    const { startDate, endDate, status, method } = req.query
    const Payment = req.PaymentModel

    // Build filter
    const filter = {}
    if (status && status !== "all") filter.status = status
    if (method && method !== "all") filter.method = method
    if (startDate || endDate) {
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate) {
        const endDateTime = new Date(endDate)
        endDateTime.setHours(23, 59, 59, 999)
        filter.createdAt.$lte = endDateTime
      }
    }

    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .limit(10000) // Limit for performance
      .lean()

    // Generate CSV content
    const csvHeaders = ["Payment ID", "Order ID", "Amount", "Status", "Method", "Created At", "Updated At"].join(",")

    const csvRows = payments.map((payment) =>
      [
        payment.paymentId || payment._id,
        payment.orderId || "",
        payment.amount || 0,
        payment.status || "",
        payment.method || "",
        payment.createdAt ? new Date(payment.createdAt).toISOString() : "",
        payment.updatedAt ? new Date(payment.updatedAt).toISOString() : "",
      ].join(","),
    )

    const csvContent = [csvHeaders, ...csvRows].join("\n")

    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payments-export-${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)

    console.log(`✅ Exported ${payments.length} payments to CSV`)
  } catch (error) {
    console.error("❌ Export payments error:", error)
    res.status(500).json({
      error: "Failed to export payments",
      details: error.message,
    })
  }
})

module.exports = router
