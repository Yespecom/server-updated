const express = require("express")
const router = express.Router()

// Get all orders
router.get("/", async (req, res) => {
  try {
    console.log("Attempting to access req.tenantDB:", req.tenantDB ? "Available" : "Not Available")
    // Ensure the Product model is also loaded and registered with the tenant DB
    // This is crucial for Mongoose to find the 'Product' schema during population
    const Product = require("../../models/tenant/Product")(req.tenantDB) // Assuming this path and structure
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const orders = await Order.find().populate("items.productId").sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    console.error("Error fetching orders:", error)
    res.status(500).json({ error: error.message, stack: error.stack })
  }
})

// Get specific order
router.get("/:id", async (req, res) => {
  try {
    // Ensure the Product model is also loaded and registered with the tenant DB
    const Product = require("../../models/tenant/Product")(req.tenantDB) // Assuming this path and structure
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const order = await Order.findById(req.params.id).populate("items.productId")
    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }
    res.json(order)
  } catch (error) {
    console.error(`Error fetching order ${req.params.id}:`, error)
    res.status(500).json({ error: error.message, stack: error.stack })
  }
})

// Update order status
router.put("/:id", async (req, res) => {
  try {
    // Ensure the Product model is also loaded and registered with the tenant DB
    const Product = require("../../models/tenant/Product")(req.tenantDB) // Assuming this path and structure
    const Order = require("../../models/tenant/Order")(req.tenantDB)
    const { status } = req.body
    const validStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        validStatuses,
      })
    }
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate("items.productId")
    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }
    res.json(order)
  } catch (error) {
    console.error(`Error updating order ${req.params.id}:`, error)
    res.status(500).json({ error: error.message, stack: error.stack })
  }
})

module.exports = router
