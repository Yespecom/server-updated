const express = require("express")
const router = express.Router()

// Helper function to calculate customer stats from their orders
async function getCustomerStats(customer, OrderModel) {
  const customerOrders = await OrderModel.find({ customerId: customer._id })
    .sort({ createdAt: -1 }) // Sort by newest first to easily get lastOrderDate
    .select("total createdAt") // Select only necessary fields for aggregation
    .lean() // Use .lean() for faster execution when not modifying documents

  const totalSpent = customerOrders.reduce((sum, order) => sum + order.total, 0)
  const orderCount = customerOrders.length
  const lastOrderDate = orderCount > 0 ? customerOrders[0].createdAt : null

  return {
    totalSpent,
    orderCount,
    lastOrderDate,
  }
}

// Get all customers with aggregated stats
router.get("/", async (req, res) => {
  try {
    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    const Order = require("../../models/tenant/Order")(req.tenantDB) // Import Order model for aggregation

    const customers = await Customer.find().sort({ createdAt: -1 }).lean() // Fetch customers as plain JS objects

    // For each customer, calculate and add totalSpent, orderCount, and lastOrderDate
    const customersWithStats = await Promise.all(
      customers.map(async (customer) => {
        const stats = await getCustomerStats(customer, Order)
        return {
          ...customer,
          totalSpent: stats.totalSpent,
          orderCount: stats.orderCount,
          lastOrderDate: stats.lastOrderDate,
        }
      }),
    )

    res.json(customersWithStats)
  } catch (error) {
    console.error("Error fetching all customers with stats:", error)
    res.status(500).json({ error: error.message, stack: error.stack })
  }
})

// Get specific customer profile and their order history
router.get("/:id", async (req, res) => {
  try {
    const Customer = require("../../models/tenant/Customer")(req.tenantDB)
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const Product = require("../../models/tenant/Product")(req.tenantDB) // Import Product model for population

    const customer = await Customer.findById(req.params.id).lean() // Fetch customer as plain JS object
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" })
    }

    // Fetch order history for this customer
    const orderHistory = await Order.find({ customerId: customer._id })
      .populate("items.productId") // Populate product details within items
      .sort({ createdAt: -1 }) // Sort by newest orders first
      .lean() // Use .lean() for faster execution

    // Calculate stats for the single customer from their order history
    const stats = await getCustomerStats(customer, Order)

    res.json({
      customer: {
        ...customer,
        totalSpent: stats.totalSpent,
        orderCount: stats.orderCount,
        lastOrderDate: stats.lastOrderDate,
      },
      orderHistory: orderHistory,
    })
  } catch (error) {
    console.error(`Error fetching customer profile ${req.params.id}:`, error)
    res.status(500).json({ error: error.message, stack: error.stack })
  }
})

module.exports = router
