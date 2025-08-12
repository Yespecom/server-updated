const express = require("express")
const multer = require("multer")
const router = express.Router()
const { upload, deleteImage, getPublicIdFromUrl } = require("../../config/cloudinary")
const fs = require("fs")
const path = require("path")

// Configure multer for memory storage
const storage = multer.memoryStorage()
const fileUpload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true)
    } else {
      cb(new Error("Only image files are allowed!"), false)
    }
  },
})

// Helper functions for data parsing
const parseExistingImages = (existingImages) => {
  console.log("🔍 Parsing existingImages:", existingImages, typeof existingImages)
  if (!existingImages) return []
  if (Array.isArray(existingImages)) return existingImages
  if (typeof existingImages === "string") {
    if (existingImages.trim() === "") return []
    if (existingImages.startsWith("[") || existingImages.startsWith("{")) {
      try {
        const parsed = JSON.parse(existingImages)
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch (e) {
        console.error("❌ Error parsing existing images JSON:", e)
        return []
      }
    } else {
      return [existingImages]
    }
  }
  return []
}

const parseOfferField = (offer) => {
  console.log("🔍 Parsing offer field:", offer, typeof offer)
  if (!offer || offer === "none" || offer === "" || offer === "null" || offer === "undefined") {
    return null
  }
  if (typeof offer === "string" && offer.match(/^[0-9a-fA-F]{24}$/)) {
    return offer
  }
  if (Array.isArray(offer)) {
    const validId = offer.find((id) => id && typeof id === "string" && id.match(/^[0-9a-fA-F]{24}$/))
    return validId || null
  }
  return null
}

// Enhanced variant parsing with better error handling
const parseVariants = (variants, hasVariants, trackQuantity) => {
  console.log("🔍 Parsing variants:", variants, "hasVariants:", hasVariants, "trackQuantity:", trackQuantity)
  // Return empty array if variants are not enabled
  if (!hasVariants || hasVariants === "false" || hasVariants === false) {
    console.log("📝 Variants disabled, returning empty array")
    return []
  }
  if (!variants) {
    console.log("📝 No variants data provided")
    return []
  }
  try {
    let parsedVariants = []
    // Parse variants from string or use array directly
    if (typeof variants === "string") {
      parsedVariants = JSON.parse(variants)
    } else if (Array.isArray(variants)) {
      parsedVariants = variants
    } else {
      console.log("📝 Invalid variants format")
      return []
    }

    // Parse trackQuantity properly
    const shouldTrackQuantity = trackQuantity === "true" || trackQuantity === true || trackQuantity === 1
    console.log("📝 Should track quantity:", shouldTrackQuantity)

    // Validate and process each variant
    const processedVariants = parsedVariants.map((variant, index) => {
      console.log(`🔄 Processing variant ${index + 1}:`, variant)
      // Validate required fields
      const requiredFields = ["name", "price", "sku"]
      if (shouldTrackQuantity) {
        requiredFields.push("stock")
      }
      const missingFields = requiredFields.filter((field) => {
        const value = variant[field]
        // For stock, specifically check if it's undefined/null/empty string AND tracking is enabled
        if (field === "stock" && shouldTrackQuantity) {
          return value === undefined || value === null || value === ""
        }
        return !value && value !== "0" && value !== 0
      })
      if (missingFields.length > 0) {
        console.error(`❌ Variant ${index + 1} missing required fields:`, missingFields)
        throw new Error(`Variant ${index + 1} is missing required fields: ${missingFields.join(", ")}`)
      }

      // Convert and validate numeric fields
      const price = Number.parseFloat(variant.price)
      const originalPrice = variant.originalPrice ? Number.parseFloat(variant.originalPrice) : undefined
      if (isNaN(price) || price < 0) {
        throw new Error(`Variant "${variant.name}" has invalid price: ${variant.price}`)
      }
      if (originalPrice !== undefined && (isNaN(originalPrice) || originalPrice < 0)) {
        throw new Error(`Variant "${variant.name}" has invalid original price: ${variant.originalPrice}`)
      }
      // Ensure originalPrice is greater than price if both are present
      if (originalPrice !== undefined && price !== undefined && originalPrice <= price) {
        console.log(
          `⚠️ Variant "${variant.name}" original price (${originalPrice}) is not greater than selling price (${price}), setting to undefined.`,
        )
        // Set to undefined so it's not saved if invalid
        variant.originalPrice = undefined
      }

      // Create processed variant object
      const processedVariant = {
        name: variant.name.trim(),
        // Ensure options are correctly parsed as array of objects
        options: Array.isArray(variant.options)
          ? variant.options.map((opt) => ({
              attributeName: opt.attributeName?.trim() || "",
              value: opt.value?.trim() || "",
            }))
          : [],
        price: price.toString(), // Keep as string to match schema
        originalPrice: variant.originalPrice ? variant.originalPrice.toString() : undefined, // Use the potentially updated originalPrice
        sku: variant.sku.trim().toUpperCase(),
        isActive: variant.isActive !== undefined ? Boolean(variant.isActive) : true,
        image: variant.image || "",
      }

      // Handle stock field more carefully
      if (shouldTrackQuantity) {
        // Only include stock if quantity tracking is enabled
        if (variant.stock === undefined || variant.stock === null || variant.stock === "") {
          processedVariant.stock = "0" // Default to 0
        } else {
          const stock = Number.parseInt(variant.stock)
          if (isNaN(stock) || stock < 0) {
            throw new Error(`Variant "${variant.name}" has invalid stock: ${variant.stock}`)
          }
          processedVariant.stock = stock.toString()
        }
      } else {
        // If not tracking quantity, ensure stock is not included in the variant object
        delete processedVariant.stock
      }

      // Only include _id if it's a valid ObjectId (not temp ID)
      if (
        variant._id &&
        !variant._id.toString().startsWith("temp-") &&
        variant._id.toString().match(/^[0-9a-fA-F]{24}$/)
      ) {
        processedVariant._id = variant._id
      }
      console.log(`✅ Processed variant ${index + 1}:`, processedVariant)
      return processedVariant
    })

    // Check for duplicate SKUs within variants
    const skus = processedVariants.map((v) => v.sku)
    const duplicateSkus = skus.filter((sku, index) => skus.indexOf(sku) !== index)
    if (duplicateSkus.length > 0) {
      throw new Error(`Duplicate variant SKUs found: ${duplicateSkus.join(", ")}`)
    }

    console.log(`✅ Successfully processed ${processedVariants.length} variants`)
    return processedVariants
  } catch (e) {
    console.error("❌ Error parsing variants:", e)
    throw new Error(`Variant parsing failed: ${e.message}`)
  }
}

const generateSlug = (name) => {
  if (!name) return ""
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

// Helper function to ensure all required models are loaded
const ensureModelsLoaded = (tenantDB) => {
  try {
    console.log("🔍 Loading models for tenant database...")
    // Load Product model with error handling
    let Product
    try {
      const ProductModel = require("../../models/tenant/Product")
      if (typeof ProductModel === "function") {
        Product = ProductModel(tenantDB)
      } else {
        throw new Error("Product model export is not a function")
      }
      console.log("✅ Product model loaded successfully")
    } catch (productError) {
      console.error("❌ Error loading Product model:", productError)
      throw new Error(`Failed to load Product model: ${productError.message}`)
    }

    // Load Category model with fallback
    let Category
    try {
      const CategoryModel = require("../../models/tenant/Category")
      if (typeof CategoryModel === "function") {
        Category = CategoryModel(tenantDB)
      } else {
        throw new Error("Category model export is not a function")
      }
      console.log("✅ Category model loaded successfully")
    } catch (categoryError) {
      console.log("⚠️ Category model not found, creating basic schema")
      const mongoose = require("mongoose")
      const categorySchema = new mongoose.Schema(
        {
          name: { type: String, required: true },
          slug: { type: String, required: true },
          description: String,
          isActive: { type: Boolean, default: true },
        },
        { timestamps: true },
      )
      Category = tenantDB.model("Category", categorySchema)
    }

    // Load Offer model with fallback
    let Offer
    try {
      const OfferModel = require("../../models/tenant/Offer")
      if (typeof OfferModel === "function") {
        Offer = OfferModel(tenantDB)
      } else {
        throw new Error("Offer model export is not a function")
      }
      console.log("✅ Offer model loaded successfully")
    } catch (offerError) {
      console.log("⚠️ Offer model not found, creating basic schema")
      const mongoose = require("mongoose")
      const offerSchema = new mongoose.Schema(
        {
          name: { type: String, required: true },
          type: { type: String, enum: ["percentage", "fixed"], default: "percentage" },
          value: { type: Number, required: true },
          isActive: { type: Boolean, default: true },
        },
        { timestamps: true },
      )
      Offer = tenantDB.model("Offer", offerSchema)
    }

    console.log("✅ All models loaded successfully")
    return { Product, Category, Offer }
  } catch (error) {
    console.error("❌ Error in ensureModelsLoaded:", error)
    throw new Error(`Model loading failed: ${error.message}`)
  }
}

// Ensure upload directories exist
const ensureUploadDirs = () => {
  const dirs = ["uploads", "uploads/products"]
  dirs.forEach((dir) => {
    const dirPath = path.join(process.cwd(), dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
      console.log(`✅ Created directory: ${dir}`)
    }
  })
}
ensureUploadDirs()

// Get all products
router.get("/", async (req, res) => {
  try {
    console.log("🔍 Getting all products...")
    const { Product } = ensureModelsLoaded(req.tenantDB)
    let products
    try {
      products = await Product.find()
        .populate("category", "name _id")
        .populate("offer", "name type value _id")
        .sort({ createdAt: -1 })
      console.log("✅ Products loaded with populate")
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate:", populateError.message)
      products = await Product.find().sort({ createdAt: -1 })
    }
    console.log(`✅ Found ${products.length} products`)
    res.json(products)
  } catch (error) {
    console.error("❌ Get products error:", error)
    res.status(500).json({
      success: false,
      error: error.message,
      details: "Failed to fetch products",
    })
  }
})

// Get single product
router.get("/:id", async (req, res) => {
  try {
    console.log("🔍 Getting product:", req.params.id)
    const { Product } = ensureModelsLoaded(req.tenantDB)
    let product
    try {
      product = await Product.findById(req.params.id)
        .populate("category", "name _id")
        .populate("offer", "name type value _id")
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate")
      product = await Product.findById(req.params.id)
    }
    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      })
    }
    console.log("✅ Product found:", product.name)
    res.json(product)
  } catch (error) {
    console.error("❌ Get product error:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// Create product
router.post("/", fileUpload.array("images", 10), async (req, res) => {
  try {
    console.log("📝 Creating new product...")
    console.log("📋 Request body keys:", Object.keys(req.body))
    console.log("📋 Files:", req.files?.length || 0)

    const { Product } = ensureModelsLoaded(req.tenantDB)

    const {
      name,
      sku,
      category,
      tags,
      shortDescription,
      description,
      price,
      originalPrice, // This is the field we're focusing on
      taxPercentage,
      stock,
      lowStockAlert,
      allowBackorders,
      weight,
      dimensions,
      metaTitle,
      metaDescription,
      offer,
      hasVariants,
      variants,
      existingImages,
      trackQuantity,
      variantAttributes, // NEW: variantAttributes from frontend
    } = req.body

    // Parse boolean flags
    const shouldTrackQuantity = trackQuantity === "true" || trackQuantity === true || trackQuantity === 1
    const isVariantProduct = hasVariants === "true" || hasVariants === true || hasVariants === 1

    console.log("🔍 Track quantity parsed:", shouldTrackQuantity, "from:", trackQuantity, typeof trackQuantity)
    console.log("🔍 Has variants parsed:", isVariantProduct, "from:", hasVariants, typeof hasVariants)

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Product name is required",
      })
    }
    if (!sku || !sku.trim()) {
      return res.status(400).json({
        success: false,
        error: "SKU is required",
      })
    }
    if (!category) {
      return res.status(400).json({
        success: false,
        error: "Category is required",
      })
    }

    // Parse existing images
    let gallery = parseExistingImages(existingImages)
    console.log("📸 Parsed existing images:", gallery)

    // Handle uploaded files
    if (req.files && req.files.length > 0) {
      try {
        const uploads = await Promise.all(req.files.map((file) => upload(file.buffer, "yesp-products")))
        const newImageUrls = uploads.map((f) => f.secure_url)
        gallery = [...gallery, ...newImageUrls]
        console.log("📸 New images uploaded:", newImageUrls)
      } catch (uploadError) {
        console.error("❌ Image upload error:", uploadError)
        return res.status(400).json({
          success: false,
          error: "Failed to upload images",
          details: uploadError.message,
        })
      }
    }

    // Parse and validate variants
    let parsedVariants = []
    let parsedVariantAttributes = []

    if (isVariantProduct) {
      try {
        parsedVariants = parseVariants(variants, isVariantProduct, shouldTrackQuantity)
        console.log("🔄 Parsed variants:", parsedVariants.length)
      } catch (variantError) {
        console.error("❌ Variant parsing error:", variantError)
        return res.status(400).json({
          success: false,
          error: "Variant validation failed",
          details: variantError.message,
        })
      }

      // Parse variant attributes
      try {
        parsedVariantAttributes = variantAttributes ? JSON.parse(variantAttributes) : []
        if (!Array.isArray(parsedVariantAttributes)) {
          throw new Error("Variant attributes must be an array.")
        }
        // Basic validation for attributes
        const missingAttrFields = parsedVariantAttributes.some(
          (attr) => !attr.name?.trim() || !Array.isArray(attr.values) || attr.values.length === 0,
        )
        if (missingAttrFields) {
          throw new Error("All variant attributes must have a name and at least one value.")
        }
        const duplicateAttrNames =
          new Set(parsedVariantAttributes.map((attr) => attr.name.toLowerCase())).size !==
          parsedVariantAttributes.length
        if (duplicateAttrNames) {
          throw new Error("Variant attribute names must be unique.")
        }
        console.log("🔄 Parsed variant attributes:", parsedVariantAttributes.length)
      } catch (attrError) {
        console.error("❌ Variant attributes parsing error:", attrError)
        return res.status(400).json({
          success: false,
          error: "Variant attributes validation failed",
          details: attrError.message,
        })
      }
    }

    // Validate images based on product type
    if (!isVariantProduct && gallery.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one product image is required for non-variant products",
      })
    }
    if (isVariantProduct) {
      if (parsedVariants.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one variant is required when variants are enabled",
        })
      }
      if (parsedVariantAttributes.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one variant attribute is required when variants are enabled",
        })
      }
      // For variant products, check if at least one image exists (main or variant)
      const hasMainImages = gallery.length > 0
      const hasVariantImages = parsedVariants.some((variant) => variant.image && variant.image.trim() !== "")
      if (!hasMainImages && !hasVariantImages) {
        return res.status(400).json({
          success: false,
          error: "At least one image is required (either main product images or variant images)",
        })
      }
    }

    // Validate non-variant product fields
    let parsedPrice = 0
    let finalOriginalPrice = undefined // Initialize as undefined
    let finalStock = undefined // Initialize as undefined

    if (!isVariantProduct) {
      parsedPrice = Number.parseFloat(price) || 0
      if (parsedPrice <= 0) {
        return res.status(400).json({
          success: false,
          error: "Price must be greater than 0 for non-variant products",
        })
      }

      // NEW LOGIC for originalPrice: Only set if valid and greater than selling price
      if (originalPrice !== undefined && originalPrice !== null && originalPrice !== "") {
        const parsedOriginalVal = Number.parseFloat(originalPrice)
        if (!isNaN(parsedOriginalVal) && parsedOriginalVal > parsedPrice) {
          finalOriginalPrice = parsedOriginalVal
        } else {
          console.log(
            `⚠️ Original price (${parsedOriginalVal}) is not greater than selling price (${parsedPrice}), setting to undefined.`,
          )
        }
      }

      if (shouldTrackQuantity) {
        if (stock === undefined || stock === null || stock === "") {
          console.log("⚠️ No stock provided, setting default to 0")
          finalStock = 0
        } else {
          const parsedStock = Number.parseInt(stock)
          if (isNaN(parsedStock) || parsedStock < 0) {
            return res.status(400).json({
              success: false,
              error: "Stock quantity cannot be negative or invalid when quantity tracking is enabled",
            })
          }
          finalStock = parsedStock
        }
      }
    }

    // Parse dimensions
    let parsedDimensions = { length: 0, width: 0, height: 0 }
    try {
      if (dimensions) {
        parsedDimensions = typeof dimensions === "string" ? JSON.parse(dimensions) : dimensions
      }
    } catch (e) {
      console.error("❌ Error parsing dimensions:", e)
    }

    // Parse tags
    let parsedTags = []
    try {
      if (tags) {
        parsedTags =
          typeof tags === "string"
            ? tags.includes(",")
              ? tags.split(",").map((t) => t.trim())
              : [tags]
            : Array.isArray(tags)
              ? tags
              : []
      }
    } catch (e) {
      console.error("❌ Error parsing tags:", e)
    }

    // Generate slug
    const slug = generateSlug(name)

    // Create product data
    const productData = {
      name: name.trim(),
      slug,
      sku: sku.toUpperCase().trim(),
      category,
      tags: parsedTags,
      shortDescription: shortDescription?.trim() || "",
      description: description?.trim() || "",
      price: isVariantProduct ? 0 : parsedPrice, // Use parsedPrice here, 0 for variant products
      originalPrice: finalOriginalPrice, // Use the new finalOriginalPrice
      taxPercentage: Number.parseFloat(taxPercentage) || 0,
      lowStockAlert: Number.parseInt(lowStockAlert) || 5,
      allowBackorders: allowBackorders === "true" || allowBackorders === true,
      thumbnail: gallery.length > 0 ? gallery[0] : "",
      gallery,
      weight: Number.parseFloat(weight) || 0,
      dimensions: parsedDimensions,
      metaTitle: metaTitle?.trim() || "",
      metaDescription: metaDescription?.trim() || "",
      offer: parseOfferField(offer),
      hasVariants: isVariantProduct,
      variants: parsedVariants,
      trackQuantity: shouldTrackQuantity,
      variantAttributes: parsedVariantAttributes, // NEW: Add variant attributes
      isActive: true,
    }

    // Only set stock for main product if tracking quantity AND not a variant product
    if (shouldTrackQuantity && !isVariantProduct) {
      productData.stock = finalStock
    } else if (isVariantProduct) {
      // If it's a variant product, main stock is 0
      productData.stock = 0
    }
    // If not tracking quantity, stock field is omitted by default

    console.log("📋 Final product data:", {
      ...productData,
      variants: productData.variants.length > 0 ? `${productData.variants.length} variants` : "no variants",
      trackQuantity: productData.trackQuantity,
      hasStock: "stock" in productData,
      stockValue: productData.stock,
      variantAttributes:
        productData.variantAttributes.length > 0
          ? `${productData.variantAttributes.length} attributes`
          : "no attributes",
    })

    // Create and save product
    const product = new Product(productData)
    await product.save()

    console.log("✅ Product created successfully:", product._id)
    console.log("✅ Product variants saved:", product.variants.length)
    console.log("✅ Quantity tracking:", product.trackQuantity)
    console.log("✅ Variant attributes saved:", product.variantAttributes.length)

    // Try to populate the response
    try {
      await product.populate("category", "name _id")
      await product.populate("offer", "name type value _id")
    } catch (populateError) {
      console.log("⚠️ Populate failed on response:", populateError.message)
    }

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    })
  } catch (error) {
    console.error("❌ Create product error:", error)
    if (error.name === "ValidationError") {
      const errors = Object.keys(error.errors).map((key) => ({
        field: key,
        message: error.errors[key].message,
        value: error.errors[key].value,
      }))
      console.error("❌ Validation errors:", errors)
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
      })
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Duplicate value",
        details: "SKU or slug already exists",
      })
    }
    res.status(500).json({
      success: false,
      error: "Failed to create product",
      details: error.message,
    })
  }
})

// ENHANCED: Update product with better error handling and logging
router.put("/:id", fileUpload.array("images", 10), async (req, res) => {
  try {
    console.log("📝 Updating product:", req.params.id)
    console.log("📋 Request body keys:", Object.keys(req.body))
    console.log("📋 Request body values (raw):", {
      hasVariants: req.body.hasVariants,
      trackQuantity: req.body.trackQuantity,
      price: req.body.price,
      originalPrice: req.body.originalPrice,
      variants: req.body.variants ? (typeof req.body.variants === "string" ? "string" : "array") : "undefined",
      variantAttributes: req.body.variantAttributes
        ? typeof req.body.variantAttributes === "string"
          ? "string"
          : "array"
        : "undefined",
    })

    const { Product } = ensureModelsLoaded(req.tenantDB)
    const product = await Product.findById(req.params.id)

    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      })
    }

    console.log("📋 Existing product data from DB:", {
      _id: product._id,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      hasVariants: product.hasVariants,
      trackQuantity: product.trackQuantity,
      variantsCount: product.variants?.length || 0,
      variantAttributesCount: product.variantAttributes?.length || 0,
    })

    const {
      name,
      sku,
      category,
      tags,
      shortDescription,
      description,
      price, // This is req.body.price
      originalPrice, // This is req.body.originalPrice
      taxPercentage,
      stock,
      lowStockAlert,
      allowBackorders,
      weight,
      dimensions,
      metaTitle,
      metaDescription,
      offer,
      hasVariants, // This is req.body.hasVariants
      variants,
      existingImages,
      trackQuantity,
      variantAttributes, // NEW: variantAttributes from frontend
    } = req.body

    // Determine shouldTrackQuantity: Use req.body if present, else existing product's value
    let shouldTrackQuantity
    if (trackQuantity !== undefined) {
      shouldTrackQuantity = trackQuantity === "true" || trackQuantity === true || trackQuantity === 1
    } else {
      shouldTrackQuantity = product.trackQuantity
    }
    console.log(
      "🔍 Track quantity resolved:",
      shouldTrackQuantity,
      "from req:",
      trackQuantity,
      "from product:",
      product.trackQuantity,
    )

    // Determine isVariantProduct: Use req.body if present, else existing product's value
    let isVariantProduct
    if (hasVariants !== undefined) {
      isVariantProduct = hasVariants === "true" || hasVariants === true || hasVariants === 1
    } else {
      isVariantProduct = product.hasVariants
    }
    console.log(
      "🔍 Is variant product resolved:",
      isVariantProduct,
      "from req:",
      hasVariants,
      "from product:",
      product.hasVariants,
    )

    // Handle image updates (already seems fine)
    let gallery = parseExistingImages(existingImages)
    // Add new uploaded images
    if (req.files && req.files.length > 0) {
      try {
        const uploads = await Promise.all(req.files.map((file) => upload(file.buffer, "yesp-products")))
        const newImageUrls = uploads.map((f) => f.secure_url)
        gallery = [...gallery, ...newImageUrls]
      } catch (uploadError) {
        console.error("❌ Image upload error:", uploadError)
        return res.status(400).json({
          success: false,
          error: "Failed to upload images",
          details: uploadError.message,
        })
      }
    }

    // Parse and validate variants and variant attributes
    let parsedVariants = []
    let parsedVariantAttributes = []

    if (isVariantProduct) {
      try {
        parsedVariants = parseVariants(variants, isVariantProduct, shouldTrackQuantity)
        console.log("🔄 Updated variants:", parsedVariants.length)
      } catch (variantError) {
        console.error("❌ Variant parsing error:", variantError)
        return res.status(400).json({
          success: false,
          error: "Variant validation failed",
          details: variantError.message,
        })
      }

      // Parse variant attributes
      try {
        parsedVariantAttributes = variantAttributes ? JSON.parse(variantAttributes) : []
        if (!Array.isArray(parsedVariantAttributes)) {
          throw new Error("Variant attributes must be an array.")
        }
        const missingAttrFields = parsedVariantAttributes.some(
          (attr) => !attr.name?.trim() || !Array.isArray(attr.values) || attr.values.length === 0,
        )
        if (missingAttrFields) {
          throw new Error("All variant attributes must have a name and at least one value.")
        }
        const duplicateAttrNames =
          new Set(parsedVariantAttributes.map((attr) => attr.name.toLowerCase())).size !==
          parsedVariantAttributes.length
        if (duplicateAttrNames) {
          throw new Error("Variant attribute names must be unique.")
        }
        console.log("🔄 Parsed variant attributes:", parsedVariantAttributes.length)
      } catch (attrError) {
        console.error("❌ Variant attributes parsing error:", attrError)
        return res.status(400).json({
          success: false,
          error: "Variant attributes validation failed",
          details: attrError.message,
        })
      }
    }

    // Determine the effective selling price for the update payload
    let effectiveSellingPrice
    if (isVariantProduct) {
      effectiveSellingPrice = 0 // Price is 0 for variant products
    } else {
      // For non-variant products, use req.body.price if valid, else product.price
      const reqPriceNum = Number.parseFloat(price)
      if (price !== undefined && price !== null && price !== "" && !isNaN(reqPriceNum) && reqPriceNum >= 0) {
        effectiveSellingPrice = reqPriceNum
      } else {
        effectiveSellingPrice = product.price // Fallback to existing price
      }
    }
    console.log(
      "🔍 Effective selling price for update payload:",
      effectiveSellingPrice,
      "from req.body.price:",
      price,
      "product.price:",
      product.price,
    )

    let finalOriginalPrice = undefined // Initialize as undefined
    // Logic for originalPrice for non-variant products
    if (!isVariantProduct) {
      if (originalPrice !== undefined && originalPrice !== null && originalPrice !== "") {
        const parsedOriginalVal = Number.parseFloat(originalPrice)
        if (!isNaN(parsedOriginalVal) && parsedOriginalVal >= 0) {
          // Only set if it's a valid number and greater than the effective selling price
          if (parsedOriginalVal > effectiveSellingPrice) {
            finalOriginalPrice = parsedOriginalVal
          } else {
            console.log(
              `⚠️ Original price (${parsedOriginalVal}) is not greater than selling price (${effectiveSellingPrice}), setting to undefined.`,
            )
          }
        } else {
          console.log(`⚠️ Original price (${originalPrice}) is not a valid number, setting to undefined.`)
        }
      } else {
        // If originalPrice is explicitly empty/null/undefined, ensure it's undefined
        finalOriginalPrice = undefined
      }
    } else {
      // If it's a variant product, originalPrice for the main product should always be undefined
      finalOriginalPrice = undefined
    }
    console.log(
      "🔍 Final original price for update payload:",
      finalOriginalPrice,
      "from req.body.originalPrice:",
      originalPrice,
    )

    let parsedDimensions = product.dimensions || { length: 0, width: 0, height: 0 }
    try {
      if (dimensions) {
        parsedDimensions = typeof dimensions === "string" ? JSON.parse(dimensions) : dimensions
      }
    } catch (e) {
      console.error("❌ Error parsing dimensions:", e)
    }

    let parsedTags = []
    try {
      if (tags) {
        parsedTags =
          typeof tags === "string"
            ? tags.includes(",")
              ? tags.split(",").map((t) => t.trim())
              : [tags]
            : Array.isArray(tags)
              ? tags
              : []
      }
    } catch (e) {
      console.error("❌ Error parsing tags:", e)
      parsedTags = product.tags || []
    }

    // Generate slug if name changed
    const slug = name !== product.name ? generateSlug(name) : product.slug

    // Construct updateData object
    const updateData = {
      name: name?.trim() || product.name,
      slug,
      sku: sku?.toUpperCase().trim() || product.sku,
      category: category || product.category,
      tags: parsedTags,
      shortDescription: shortDescription?.trim() || product.shortDescription,
      description: description?.trim() || product.description,
      price: effectiveSellingPrice, // Ensure price is always set
      originalPrice: finalOriginalPrice, // Use the new finalOriginalPrice
      taxPercentage: Number.parseFloat(taxPercentage) || product.taxPercentage || 0,
      lowStockAlert: Number.parseInt(lowStockAlert) || product.lowStockAlert || 5,
      allowBackorders: allowBackorders === "true" || allowBackorders === true,
      gallery,
      thumbnail: gallery.length > 0 ? gallery[0] : product.thumbnail,
      weight: Number.parseFloat(weight) || product.weight || 0,
      dimensions: parsedDimensions,
      metaTitle: metaTitle?.trim() || product.metaTitle,
      metaDescription: metaDescription?.trim() || product.metaDescription,
      offer: parseOfferField(offer),
      hasVariants: isVariantProduct, // Use the properly parsed boolean
      variantAttributes: parsedVariantAttributes, // NEW: Add variant attributes
      variants: parsedVariants, // This will be [] when hasVariants is false
      trackQuantity: shouldTrackQuantity,
    }

    // Handle stock field based on trackQuantity and hasVariants
    if (shouldTrackQuantity) {
      if (isVariantProduct) {
        updateData.stock = 0 // Variants handle their own stock, main product stock is 0
      } else {
        // For non-variant products with quantity tracking
        if (stock !== undefined && stock !== null && stock !== "") {
          updateData.stock = Number.parseInt(stock)
        } else {
          // Keep existing stock or default to 0
          updateData.stock = product.stock !== undefined ? product.stock : 0
        }
      }
    } else {
      // If quantity tracking is disabled, we need to unset the stock field
      updateData.$unset = { stock: 1 }
      delete updateData.stock // Remove stock from $set if it was there
    }

    console.log("📋 Final update data sent to Mongoose:", {
      hasVariants: updateData.hasVariants,
      variantCount: updateData.variants.length,
      trackQuantity: updateData.trackQuantity,
      hasStock: "stock" in updateData,
      stockValue: updateData.stock,
      hasUnset: "$unset" in updateData,
      updateDataPrice: updateData.price, // Added for debugging
      updateDataOriginalPrice: updateData.originalPrice, // Added for debugging
      variantAttributesCount: updateData.variantAttributes.length,
    })

    // CRITICAL: Log the exact variants being sent to MongoDB
    console.log("📋 Variants being saved to MongoDB:", JSON.stringify(updateData.variants, null, 2))

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })

    // Try to populate, but don't fail if it doesn't work
    try {
      await updatedProduct.populate("category", "name _id")
      await updatedProduct.populate("offer", "name type value _id")
    } catch (populateError) {
      console.log("⚠️ Populate failed on update:", populateError.message)
    }

    console.log("✅ Product updated successfully:", updatedProduct._id)
    console.log("✅ Product variants updated:", updatedProduct.variants.length)
    console.log("✅ Quantity tracking:", updatedProduct.trackQuantity)
    console.log("✅ Variant attributes updated:", updatedProduct.variantAttributes.length)

    res.json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    })
  } catch (error) {
    console.error("❌ Update product error:", error)
    console.error("❌ Error stack:", error.stack)
    // Enhanced error handling with more details
    if (error.name === "ValidationError") {
      const errors = Object.keys(error.errors).map((key) => ({
        field: key,
        message: error.errors[key].message,
        value: error.errors[key].value,
        kind: error.errors[key].kind,
        path: error.errors[key].path,
      }))
      console.error("❌ Detailed validation errors:", errors)
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
        debugInfo: {
          errorName: error.name,
          errorMessage: error.message,
        },
      })
    }
    if (error.code === 11000) {
      console.error("❌ Duplicate key error:", error.keyPattern, error.keyValue)
      return res.status(400).json({
        success: false,
        error: "Duplicate value",
        details: "SKU or slug already exists",
        debugInfo: {
          errorCode: error.code,
          keyPattern: error.keyPattern,
          keyValue: error.keyValue,
        },
      })
    }
    res.status(500).json({
      success: false,
      error: "Failed to update product",
      details: error.message,
      debugInfo: {
        errorName: error.name,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    })
  }
})

// Delete product
router.delete("/:id", async (req, res) => {
  try {
    console.log("🗑️ Deleting product:", req.params.id)
    const { Product } = ensureModelsLoaded(req.tenantDB)
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      })
    }

    // Delete images from Cloudinary
    try {
      if (product.gallery && product.gallery.length > 0) {
        for (const imageUrl of product.gallery) {
          if (imageUrl.includes("cloudinary.com")) {
            const publicId = getPublicIdFromUrl(imageUrl)
            if (publicId) {
              await deleteImage(`yesp-products/${publicId}`)
            }
          }
        }
      }
      // Also delete variant images
      if (product.hasVariants && product.variants && product.variants.length > 0) {
        for (const variant of product.variants) {
          if (variant.image && variant.image.includes("cloudinary.com")) {
            const publicId = getPublicIdFromUrl(variant.image)
            if (publicId) {
              await deleteImage(`yesp-products/${publicId}`)
            }
          }
        }
      }
    } catch (imageError) {
      console.error("⚠️ Error deleting images:", imageError)
    }

    await Product.findByIdAndDelete(req.params.id)
    console.log("✅ Product deleted successfully:", req.params.id)
    res.json({
      success: true,
      message: "Product deleted successfully",
    })
  } catch (error) {
    console.error("❌ Delete product error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete product",
      details: error.message,
    })
  }
})

// Upload single image endpoint
router.post("/upload-image", fileUpload.single("image"), async (req, res) => {
  try {
    console.log("📸 Upload image endpoint hit")
    if (!req.file) {
      console.error("❌ No file provided")
      return res.status(400).json({
        success: false,
        error: "No image file provided",
      })
    }

    // Validate file type
    if (!req.file.mimetype.startsWith("image/")) {
      console.error("❌ Invalid file type:", req.file.mimetype)
      return res.status(415).json({
        success: false,
        error: "Only image files are allowed",
      })
    }

    // Validate file size (10MB limit)
    if (req.file.size > 10 * 1024 * 1024) {
      console.error("❌ File too large:", req.file.size)
      return res.status(413).json({
        success: false,
        error: "File size must be less than 10MB",
      })
    }

    console.log("📸 Starting Cloudinary upload...")
    const result = await upload(req.file.buffer, "yesp-products")
    console.log("✅ Cloudinary upload successful:", {
      public_id: result.public_id,
      secure_url: result.secure_url,
    })

    res.json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    })
  } catch (error) {
    console.error("❌ Upload image error:", error)
    if (error.message && error.message.includes("Invalid image file")) {
      return res.status(415).json({
        success: false,
        error: "Invalid image file format",
        details: error.message,
      })
    }
    if (error.message && error.message.includes("File size too large")) {
      return res.status(413).json({
        success: false,
        error: "File size too large",
        details: error.message,
      })
    }
    res.status(500).json({
      success: false,
      error: "Failed to upload image",
      details: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
    })
  }
})

// Delete single image endpoint
router.delete("/delete-image", async (req, res) => {
  try {
    const { imageUrl } = req.body
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: "Image URL is required",
      })
    }
    console.log("🗑️ Deleting image:", imageUrl)
    const publicId = getPublicIdFromUrl(imageUrl)
    if (publicId) {
      await deleteImage(`yesp-products/${publicId}`)
    }
    console.log("✅ Image deleted successfully")
    res.json({
      success: true,
      message: "Image deleted successfully",
    })
  } catch (error) {
    console.error("❌ Delete image error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to delete image",
      details: error.message,
    })
  }
})

module.exports = router
