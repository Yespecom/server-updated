const express = require("express")
const router = express.Router()

// Import sub-routes
const authRoutes = require("./store/auth")
const ordersRoutes = require("./store/orders")
const paymentsRoutes = require("./store/payments")

// Add logging middleware for all store routes
router.use((req, res, next) => {
  console.log(`🛍️ Store Route: ${req.method} ${req.originalUrl}`)
  console.log(`🛍️ Store ID: ${req.storeId}`)
  console.log(`🛍️ Tenant ID: ${req.tenantId}`)
  console.log(`🛍️ Store Info:`, req.storeInfo?.name || "Unknown")
  next()
})

// Mount sub-routes FIRST (before other routes)
router.use("/auth", authRoutes)
router.use("/orders", ordersRoutes)
router.use("/payments", paymentsRoutes)

// Test endpoint for store routes
router.get("/test", (req, res) => {
  res.json({
    message: "Store routes are working",
    storeId: req.storeId,
    tenantId: req.tenantId,
    storeName: req.storeInfo?.name || "Unknown Store",
    timestamp: new Date().toISOString(),
    availableRoutes: [
      "GET /test",
      "GET /",
      "GET /products",
      "GET /products/:productId",
      "GET /categories",
      "GET /offers",
      "GET /settings",
      "GET /search",
      "POST /auth/register",
      "POST /auth/login",
      "GET /auth/profile",
      "POST /orders",
      "GET /orders",
      "POST /payments/create-order",
    ],
  })
})

// Get store information
router.get("/", async (req, res) => {
  try {
    const { storeId, tenantId, tenantDB, storeInfo } = req

    console.log(`🔍 Getting store info for: ${storeId}`)

    // Get models from tenant DB
    const Settings = require("../models/tenant/Settings")(tenantDB)

    // Get store settings
    let settings
    try {
      settings = await Settings.findOne()
    } catch (settingsError) {
      console.log("⚠️ Could not load settings:", settingsError.message)
      settings = null
    }

    const responseStoreInfo = {
      storeId: storeId,
      name: storeInfo?.name || settings?.general?.storeName || "Store",
      logo: storeInfo?.logo || settings?.general?.logo || "",
      banner: storeInfo?.banner || settings?.general?.banner || "",
      tagline: settings?.general?.tagline || "Welcome to our store",
      industry: storeInfo?.industry || "General",
      isActive: storeInfo?.isActive !== false,
      contact: {
        email: settings?.general?.supportEmail || "",
        phone: settings?.general?.supportPhone || "",
        whatsapp: settings?.social?.whatsapp || "",
      },
      social: {
        instagram: settings?.social?.instagram || "",
        facebook: settings?.social?.facebook || "",
        twitter: settings?.social?.twitter || "",
      },
      shipping: {
        deliveryTime: settings?.shipping?.deliveryTime || "2-3 business days",
        charges: settings?.shipping?.charges || 50,
        freeShippingAbove: settings?.shipping?.freeShippingAbove || 500,
        freeShippingEnabled: settings?.shipping?.freeShippingEnabled || false,
      },
      payment: {
        codEnabled: settings?.payment?.codEnabled !== false,
        onlinePaymentEnabled: settings?.payment?.onlinePaymentEnabled || false,
      },
    }

    console.log(`✅ Store info retrieved for: ${storeId}`)

    res.json({
      message: "Store information retrieved successfully",
      store: responseStoreInfo,
    })
  } catch (error) {
    console.error("❌ Get store info error:", error)
    res.status(500).json({
      error: "Failed to get store information",
      details: error.message,
      code: "STORE_INFO_ERROR",
    })
  }
})

// Get store products with enhanced filtering and search
router.get("/products", async (req, res) => {
  try {
    const { storeId, tenantDB } = req
    const {
      category,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
      minPrice,
      maxPrice,
      featured,
      inStock,
    } = req.query

    console.log(`🛍️ Getting products for store: ${storeId}`)

    // Get Product model from tenant DB
    const Product = require("../models/tenant/Product")(tenantDB)

    // Build query
    const query = { isActive: true }

    if (category) {
      query.category = category
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { shortDescription: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ]
    }

    // Price range filter
    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }

    // Featured filter
    if (featured === "true") {
      query.isFeatured = true
    }

    // Stock filter
    if (inStock === "true") {
      query["inventory.quantity"] = { $gt: 0 }
    }

    // Calculate pagination
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Build sort object
    const sort = {}
    sort[sortBy] = sortOrder === "desc" ? -1 : 1

    // Get products with pagination
    let products
    try {
      products = await Product.find(query)
        .sort(sort)
        .skip(skip)
        .limit(Number.parseInt(limit))
        .populate("category", "name slug")
        .lean()
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate")
      products = await Product.find(query).sort(sort).skip(skip).limit(Number.parseInt(limit)).lean()
    }

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(query)
    const totalPages = Math.ceil(totalProducts / Number.parseInt(limit))

    console.log(`✅ Found ${products.length} products for store: ${storeId}`)

    res.json({
      message: "Products retrieved successfully",
      products,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalProducts,
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        limit: Number.parseInt(limit),
      },
      filters: {
        category,
        search,
        minPrice,
        maxPrice,
        featured,
        inStock,
        sortBy,
        sortOrder,
      },
    })
  } catch (error) {
    console.error("❌ Get store products error:", error)
    res.status(500).json({
      error: "Failed to get store products",
      details: error.message,
      code: "STORE_PRODUCTS_ERROR",
    })
  }
})

// Get single product with enhanced details
router.get("/products/:productId", async (req, res) => {
  try {
    const { storeId, tenantDB } = req
    const { productId } = req.params

    console.log(`🛍️ Getting product ${productId} for store: ${storeId}`)

    // Get Product model from tenant DB
    const Product = require("../models/tenant/Product")(tenantDB)

    // Get product
    let product
    try {
      product = await Product.findOne({
        _id: productId,
        isActive: true,
      }).populate("category", "name slug description")
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate")
      product = await Product.findOne({
        _id: productId,
        isActive: true,
      })
    }

    if (!product) {
      return res.status(404).json({
        error: "Product not found",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    // Increment view count
    try {
      await Product.findByIdAndUpdate(productId, { $inc: { viewCount: 1 } })
    } catch (viewError) {
      console.log("⚠️ Could not update view count:", viewError.message)
    }

    // Get related products (same category, excluding current product)
    let relatedProducts = []
    try {
      relatedProducts = await Product.find({
        category: product.category,
        _id: { $ne: productId },
        isActive: true,
      })
        .limit(4)
        .select("name price images slug")
        .lean()
    } catch (relatedError) {
      console.log("⚠️ Could not load related products:", relatedError.message)
    }

    console.log(`✅ Product retrieved: ${product.name}`)

    res.json({
      message: "Product retrieved successfully",
      product: {
        ...product.toObject(),
        // Add computed fields
        discountPercentage:
          product.comparePrice && product.comparePrice > product.price
            ? Math.round(((product.comparePrice - product.price) / product.comparePrice) * 100)
            : 0,
        stockStatus: !product.inventory?.trackQuantity
          ? "in_stock"
          : product.inventory.quantity <= 0
            ? "out_of_stock"
            : product.inventory.quantity <= (product.inventory.lowStockThreshold || 5)
              ? "low_stock"
              : "in_stock",
        isAvailable:
          !product.inventory?.trackQuantity || product.inventory.quantity > 0 || product.inventory.allowBackorder,
      },
      relatedProducts,
    })
  } catch (error) {
    console.error("❌ Get product error:", error)

    if (error.name === "CastError") {
      return res.status(400).json({
        error: "Invalid product ID format",
        code: "INVALID_PRODUCT_ID",
      })
    }

    res.status(500).json({
      error: "Failed to get product",
      details: error.message,
      code: "PRODUCT_ERROR",
    })
  }
})

// Get store categories
router.get("/categories", async (req, res) => {
  try {
    const { storeId, tenantDB } = req
    const { includeProductCount } = req.query

    console.log(`📂 Getting categories for store: ${storeId}`)

    // Get Category model from tenant DB
    const Category = require("../models/tenant/Category")(tenantDB)

    // Get active categories
    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean()

    // Optionally include product count for each category
    if (includeProductCount === "true") {
      const Product = require("../models/tenant/Product")(tenantDB)

      for (const category of categories) {
        try {
          const productCount = await Product.countDocuments({
            category: category._id,
            isActive: true,
          })
          category.productCount = productCount
        } catch (countError) {
          console.log(`⚠️ Could not count products for category ${category.name}:`, countError.message)
          category.productCount = 0
        }
      }
    }

    console.log(`✅ Found ${categories.length} categories for store: ${storeId}`)

    res.json({
      message: "Categories retrieved successfully",
      categories,
    })
  } catch (error) {
    console.error("❌ Get store categories error:", error)
    res.status(500).json({
      error: "Failed to get store categories",
      details: error.message,
      code: "STORE_CATEGORIES_ERROR",
    })
  }
})

// Get store offers
router.get("/offers", async (req, res) => {
  try {
    const { storeId, tenantDB } = req
    const { type, active } = req.query

    console.log(`🎯 Getting offers for store: ${storeId}`)

    // Get Offer model from tenant DB
    const Offer = require("../models/tenant/Offer")(tenantDB)

    // Build query
    const query = {
      isPublic: true,
    }

    // Filter by type if specified
    if (type) {
      query.type = type
    }

    // Filter by active status
    const currentDate = new Date()
    if (active !== "false") {
      query.isActive = true
      query.startDate = { $lte: currentDate }
      query.endDate = { $gte: currentDate }
    }

    const offers = await Offer.find(query).sort({ createdAt: -1 }).lean()

    // Add computed fields
    const enhancedOffers = offers.map((offer) => ({
      ...offer,
      isValid:
        offer.isActive &&
        offer.startDate <= currentDate &&
        offer.endDate >= currentDate &&
        (offer.usageLimit === null || offer.usedCount < offer.usageLimit),
      daysLeft: Math.max(0, Math.ceil((offer.endDate - currentDate) / (1000 * 60 * 60 * 24))),
      usageRemaining: offer.usageLimit ? offer.usageLimit - offer.usedCount : null,
    }))

    console.log(`✅ Found ${offers.length} offers for store: ${storeId}`)

    res.json({
      message: "Offers retrieved successfully",
      offers: enhancedOffers,
    })
  } catch (error) {
    console.error("❌ Get store offers error:", error)
    res.status(500).json({
      error: "Failed to get store offers",
      details: error.message,
      code: "STORE_OFFERS_ERROR",
    })
  }
})

// Get store settings (public info only)
router.get("/settings", async (req, res) => {
  try {
    const { storeId, tenantDB } = req

    console.log(`⚙️ Getting public settings for store: ${storeId}`)

    // Get Settings model from tenant DB
    const Settings = require("../models/tenant/Settings")(tenantDB)

    // Get store settings
    const settings = await Settings.findOne()

    if (!settings) {
      return res.status(404).json({
        error: "Store settings not found",
        code: "SETTINGS_NOT_FOUND",
      })
    }

    // Return only public settings
    const publicSettings = {
      general: {
        storeName: settings.general?.storeName || "",
        storeDescription: settings.general?.storeDescription || "",
        tagline: settings.general?.tagline || "",
        currency: settings.general?.currency || "INR",
        language: settings.general?.language || "en",
        timezone: settings.general?.timezone || "Asia/Kolkata",
        supportEmail: settings.general?.supportEmail || "",
        supportPhone: settings.general?.supportPhone || "",
      },
      shipping: {
        freeShippingEnabled: settings.shipping?.freeShippingEnabled || false,
        freeShippingAbove: settings.shipping?.freeShippingAbove || 500,
        charges: settings.shipping?.charges || 50,
        deliveryTime: settings.shipping?.deliveryTime || "2-3 business days",
      },
      payment: {
        codEnabled: settings.payment?.codEnabled !== false,
        onlinePaymentEnabled: settings.payment?.onlinePaymentEnabled || false,
        razorpayEnabled: settings.payment?.razorpay?.enabled || false,
        stripeEnabled: settings.payment?.stripe?.enabled || false,
      },
      social: settings.social || {},
      theme: settings.theme || {
        primaryColor: "#3B82F6",
        secondaryColor: "#64748B",
        accentColor: "#F59E0B",
        fontFamily: "Inter",
      },
      tax: {
        enabled: settings.tax?.enabled || false,
        rate: settings.tax?.rate || 0,
        inclusive: settings.tax?.inclusive || false,
      },
    }

    console.log(`✅ Public settings retrieved for store: ${storeId}`)

    res.json({
      message: "Store settings retrieved successfully",
      settings: publicSettings,
    })
  } catch (error) {
    console.error("❌ Get store settings error:", error)
    res.status(500).json({
      error: "Failed to get store settings",
      details: error.message,
      code: "STORE_SETTINGS_ERROR",
    })
  }
})

// Enhanced search products
router.get("/search", async (req, res) => {
  try {
    const { storeId, tenantDB } = req
    const {
      q,
      category,
      minPrice,
      maxPrice,
      page = 1,
      limit = 20,
      sortBy = "relevance",
      sortOrder = "desc",
      inStock,
      featured,
    } = req.query

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        error: "Search query must be at least 2 characters long",
        code: "INVALID_SEARCH_QUERY",
      })
    }

    console.log(`🔍 Searching products in store: ${storeId} for query: ${q}`)

    // Get Product model from tenant DB
    const Product = require("../models/tenant/Product")(tenantDB)

    // Build search query
    const query = {
      isActive: true,
      $or: [
        { name: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { shortDescription: { $regex: q, $options: "i" } },
        { tags: { $in: [new RegExp(q, "i")] } },
        { sku: { $regex: q, $options: "i" } },
      ],
    }

    // Add category filter
    if (category) {
      query.category = category
    }

    // Add price range filter
    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }

    // Add stock filter
    if (inStock === "true") {
      query["inventory.quantity"] = { $gt: 0 }
    }

    // Add featured filter
    if (featured === "true") {
      query.isFeatured = true
    }

    // Calculate pagination
    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit)

    // Build sort object
    let sort = {}
    switch (sortBy) {
      case "price_low":
        sort = { price: 1 }
        break
      case "price_high":
        sort = { price: -1 }
        break
      case "name":
        sort = { name: sortOrder === "desc" ? -1 : 1 }
        break
      case "newest":
        sort = { createdAt: -1 }
        break
      case "popularity":
        sort = { salesCount: -1, viewCount: -1 }
        break
      case "rating":
        sort = { "ratings.average": -1 }
        break
      default: // relevance
        sort = {
          salesCount: -1,
          "ratings.average": -1,
          viewCount: -1,
          createdAt: -1,
        }
    }

    // Search products
    let products
    try {
      products = await Product.find(query)
        .sort(sort)
        .skip(skip)
        .limit(Number.parseInt(limit))
        .populate("category", "name slug")
        .lean()
    } catch (populateError) {
      console.log("⚠️ Populate failed, loading without populate")
      products = await Product.find(query).sort(sort).skip(skip).limit(Number.parseInt(limit)).lean()
    }

    // Get total count
    const totalProducts = await Product.countDocuments(query)
    const totalPages = Math.ceil(totalProducts / Number.parseInt(limit))

    // Get search suggestions (if no results found)
    let suggestions = []
    if (products.length === 0) {
      try {
        const suggestionProducts = await Product.find({
          isActive: true,
          $or: [
            { name: { $regex: q.split(" ")[0], $options: "i" } },
            { tags: { $in: [new RegExp(q.split(" ")[0], "i")] } },
          ],
        })
          .limit(5)
          .select("name")
          .lean()

        suggestions = suggestionProducts.map((p) => p.name)
      } catch (suggestionError) {
        console.log("⚠️ Could not load suggestions:", suggestionError.message)
      }
    }

    console.log(`✅ Found ${products.length} products for search: ${q}`)

    res.json({
      message: "Search completed successfully",
      query: q,
      products,
      suggestions,
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages,
        totalProducts,
        hasNextPage: Number.parseInt(page) < totalPages,
        hasPrevPage: Number.parseInt(page) > 1,
        limit: Number.parseInt(limit),
      },
      filters: {
        category,
        minPrice,
        maxPrice,
        inStock,
        featured,
        sortBy,
        sortOrder,
      },
    })
  } catch (error) {
    console.error("❌ Search products error:", error)
    res.status(500).json({
      error: "Failed to search products",
      details: error.message,
      code: "SEARCH_ERROR",
    })
  }
})

// Get featured products
router.get("/featured", async (req, res) => {
  try {
    const { storeId, tenantDB } = req
    const { limit = 8 } = req.query

    console.log(`⭐ Getting featured products for store: ${storeId}`)

    const Product = require("../models/tenant/Product")(tenantDB)

    const featuredProducts = await Product.find({
      isActive: true,
      isFeatured: true,
    })
      .sort({ salesCount: -1, createdAt: -1 })
      .limit(Number.parseInt(limit))
      .populate("category", "name")
      .lean()

    console.log(`✅ Found ${featuredProducts.length} featured products`)

    res.json({
      message: "Featured products retrieved successfully",
      products: featuredProducts,
    })
  } catch (error) {
    console.error("❌ Get featured products error:", error)
    res.status(500).json({
      error: "Failed to get featured products",
      details: error.message,
      code: "FEATURED_PRODUCTS_ERROR",
    })
  }
})

// Get product reviews (if you have a reviews system)
router.get("/products/:productId/reviews", async (req, res) => {
  try {
    const { productId } = req.params
    const { page = 1, limit = 10 } = req.query

    console.log(`⭐ Getting reviews for product: ${productId}`)

    // For now, return empty reviews as the review system isn't implemented
    res.json({
      message: "Product reviews retrieved successfully",
      reviews: [],
      pagination: {
        currentPage: Number.parseInt(page),
        totalPages: 0,
        totalReviews: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
      averageRating: 0,
      ratingDistribution: {
        5: 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0,
      },
    })
  } catch (error) {
    console.error("❌ Get product reviews error:", error)
    res.status(500).json({
      error: "Failed to get product reviews",
      details: error.message,
      code: "REVIEWS_ERROR",
    })
  }
})

// Check product availability
router.post("/products/:productId/check-availability", async (req, res) => {
  try {
    const { productId } = req.params
    const { quantity = 1 } = req.body
    const { tenantDB } = req

    console.log(`📦 Checking availability for product: ${productId}, quantity: ${quantity}`)

    const Product = require("../models/tenant/Product")(tenantDB)

    const product = await Product.findOne({
      _id: productId,
      isActive: true,
    })

    if (!product) {
      return res.status(404).json({
        error: "Product not found",
        code: "PRODUCT_NOT_FOUND",
      })
    }

    const isAvailable = product.isAvailable(quantity)
    const stockStatus = !product.inventory?.trackQuantity
      ? "in_stock"
      : product.inventory.quantity <= 0
        ? "out_of_stock"
        : product.inventory.quantity <= (product.inventory.lowStockThreshold || 5)
          ? "low_stock"
          : "in_stock"

    res.json({
      message: "Product availability checked",
      available: isAvailable,
      stockStatus,
      requestedQuantity: quantity,
      availableQuantity: product.inventory?.trackQuantity ? product.inventory.quantity : "unlimited",
      allowBackorder: product.inventory?.allowBackorder || false,
    })
  } catch (error) {
    console.error("❌ Check availability error:", error)
    res.status(500).json({
      error: "Failed to check product availability",
      details: error.message,
      code: "AVAILABILITY_CHECK_ERROR",
    })
  }
})

module.exports = router
