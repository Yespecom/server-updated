const express = require("express")
const multer = require("multer")
const path = require("path")
const router = express.Router()

// Configure multer for category images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/categories/")
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
  },
})

const upload = multer({ storage })

// Get all categories
router.get("/", async (req, res) => {
  try {
    const Category = require("../../models/tenant/Category")(req.tenantDB)
    const categories = await Category.find().sort({ createdAt: -1 })
    res.json(categories)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create category
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const Category = require("../../models/tenant/Category")(req.tenantDB)

    const { name, description } = req.body
    const image = req.file ? `/uploads/categories/${req.file.filename}` : null

    const category = new Category({
      name,
      description,
      image,
    })

    await category.save()
    res.status(201).json(category)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update category
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const Category = require("../../models/tenant/Category")(req.tenantDB)

    const { name, description } = req.body
    const updateData = { name, description }

    if (req.file) {
      updateData.image = `/uploads/categories/${req.file.filename}`
    }

    const category = await Category.findByIdAndUpdate(req.params.id, updateData, { new: true })

    if (!category) {
      return res.status(404).json({ error: "Category not found" })
    }

    res.json(category)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Delete category
router.delete("/:id", async (req, res) => {
  try {
    const Category = require("../../models/tenant/Category")(req.tenantDB)
    const category = await Category.findByIdAndDelete(req.params.id)

    if (!category) {
      return res.status(404).json({ error: "Category not found" })
    }

    res.json({ message: "Category deleted successfully" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
