const mongoose = require("mongoose")

module.exports = (tenantDB) => {
  // Check if model already exists to avoid re-compilation
  if (tenantDB.models.Product) {
    return tenantDB.models.Product
  }

  // NEW: Variant Attribute Schema
  const variantAttributeSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: [true, "Variant attribute name is required."],
        trim: true,
        maxlength: [100, "Variant attribute name cannot exceed 100 characters."],
      },
      values: [
        {
          type: String,
          required: [true, "Variant attribute value is required."],
          trim: true,
          maxlength: [100, "Variant attribute value cannot exceed 100 characters."],
        },
      ],
    },
    { _id: false }, // No _id for subdocuments in this array
  )

  // FIXED: Variant subdocument schema with better stock handling
  const variantSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: [true, "Variant name is required"],
        trim: true,
        maxlength: [100, "Variant name cannot exceed 100 characters"],
      },
      // UPDATED: options now an array of objects { attributeName, value }
      options: {
        type: [
          {
            attributeName: {
              type: String,
              required: [true, "Variant option attribute name is required."],
              trim: true,
            },
            value: {
              type: String,
              required: [true, "Variant option value is required."],
              trim: true,
            },
          },
        ],
        required: [true, "Variant options are required."],
        validate: {
          validator: (options) => options.length > 0,
          message: "Variant must have at least one option.",
        },
      },
      price: {
        type: String,
        required: [true, "Variant price is required"],
        validate: {
          validator: (v) => {
            const price = Number.parseFloat(v)
            return !isNaN(price) && price >= 0
          },
          message: "Price must be a valid positive number",
        },
      },
      originalPrice: {
        type: String,
        validate: {
          validator: function (v) {
            if (v === null || v === undefined || v === "") return true // Optional field: allows null, undefined, empty string
            const price = Number.parseFloat(this.price) // Get selling price from the same variant
            const originalPrice = Number.parseFloat(v)
            // Original price must be a valid number and greater than selling price
            return !isNaN(originalPrice) && originalPrice >= 0 && originalPrice > price
          },
          message: "Original price must be a valid positive number and greater than selling price",
        },
      },
      // FIXED: Stock field with simpler validation
      stock: {
        type: String,
        validate: {
          validator: (v) => {
            // If stock field is present, validate it
            if (v !== undefined && v !== null && v !== "") {
              const stock = Number.parseInt(v)
              return !isNaN(stock) && stock >= 0
            }
            // If trackQuantity is true for the product, stock is required for variants
            // This check is primarily for the pre-save/update hooks
            return true // Allow undefined/null/empty string values, validation handled in pre-hooks
          },
          message: "Stock must be a valid non-negative number",
        },
      },
      sku: {
        type: String,
        required: [true, "Variant SKU is required"],
        trim: true,
        uppercase: true,
        maxlength: [50, "SKU cannot exceed 50 characters"],
      },
      isActive: {
        type: Boolean,
        default: true,
      },
      image: {
        type: String,
        trim: true,
        default: "",
      },
    },
    {
      timestamps: true,
      _id: true,
    },
  )

  // Dimensions subdocument schema
  const dimensionsSchema = new mongoose.Schema(
    {
      length: {
        type: Number,
        default: 0,
        min: [0, "Length cannot be negative"],
      },
      width: {
        type: Number,
        default: 0,
        min: [0, "Width cannot be negative"],
      },
      height: {
        type: Number,
        default: 0,
        min: [0, "Height cannot be negative"],
      },
    },
    { _id: false },
  )

  // Main Product schema
  const productSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: [true, "Product name is required"],
        trim: true,
        maxlength: [200, "Product name cannot exceed 200 characters"],
        index: true,
      },
      slug: {
        type: String,
        required: [true, "Product slug is required"],
        trim: true,
        lowercase: true,
        maxlength: [250, "Slug cannot exceed 250 characters"],
        index: true,
      },
      sku: {
        type: String,
        required: [true, "SKU is required"],
        trim: true,
        uppercase: true,
        unique: true,
        maxlength: [50, "SKU cannot exceed 50 characters"],
        index: true,
      },
      shortDescription: {
        type: String,
        required: [true, "Short description is required"],
        trim: true,
        maxlength: [500, "Short description cannot exceed 500 characters"],
      },
      description: {
        type: String,
        required: [true, "Description is required"],
        trim: true,
        maxlength: [5000, "Description cannot exceed 5000 characters"],
      },
      category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: [true, "Category is required"],
        index: true,
      },
      tags: [
        {
          type: String,
          trim: true,
          lowercase: true,
          maxlength: [50, "Tag cannot exceed 50 characters"],
        },
      ],
      // Quantity tracking toggle
      trackQuantity: {
        type: Boolean,
        default: true,
        index: true,
      },
      // Pricing fields (for non-variant products)
      price: {
        type: Number,
        required: function () {
          return !this.hasVariants // Required only if no variants
        },
        min: [0, "Price cannot be negative"],
        validate: {
          validator: function (v) {
            if (this.hasVariants) return true // Skip validation for variant products
            return v != null && v >= 0
          },
          message: "Price is required for non-variant products",
        },
      },
      originalPrice: {
        type: Number,
        min: [0, "Original price cannot be negative"],
        validate: {
          validator: function (v) {
            // 'this' refers to the document being validated
            const currentPrice = this.price
            const currentHasVariants = this.hasVariants

            // If originalPrice is null/undefined, or if it's a variant product, it's valid
            if (v === null || v === undefined || currentHasVariants === true) return true

            // If it's a non-variant product and originalPrice is provided,
            // currentPrice must be a valid number for comparison.
            if (typeof currentPrice !== "number" || isNaN(currentPrice)) {
              return false // Cannot validate originalPrice without a valid selling price
            }

            // Otherwise, originalPrice must be a number greater than selling price.
            return v > currentPrice
          },
          message: function (props) {
            const currentPrice = this.price
            const currentHasVariants = this.hasVariants
            if (currentHasVariants === true) {
              return "Original price is not applicable for variant products."
            }
            if (
              props.value !== null &&
              props.value !== undefined &&
              (typeof currentPrice !== "number" || isNaN(currentPrice))
            ) {
              return "Selling price must be a valid number to compare with original price."
            }
            return "Original price must be greater than selling price"
          },
        },
      },
      taxPercentage: {
        type: Number,
        default: 0,
        min: [0, "Tax percentage cannot be negative"],
        max: [100, "Tax percentage cannot exceed 100%"],
      },
      // FIXED: Stock field with simpler validation
      stock: {
        type: Number,
        min: [0, "Stock cannot be negative"],
        validate: {
          validator: function (v) {
            // Skip validation for variant products (stock is 0 for main product)
            if (this.hasVariants) return true
            // Skip validation if quantity tracking is disabled
            if (this.trackQuantity !== true) return true
            // If tracking is enabled and not variant product, stock is required
            return v != null && v >= 0
          },
          message: "Stock is required for non-variant products when quantity tracking is enabled",
        },
        index: true,
      },
      lowStockAlert: {
        type: Number,
        default: 5,
        min: [0, "Low stock alert cannot be negative"],
      },
      allowBackorders: {
        type: Boolean,
        default: false,
      },
      // Media fields
      thumbnail: {
        type: String,
        trim: true,
        default: "",
      },
      gallery: [
        {
          type: String,
          trim: true,
        },
      ],
      // Physical properties
      weight: {
        type: Number,
        default: 0,
        min: [0, "Weight cannot be negative"],
      },
      dimensions: {
        type: dimensionsSchema,
        default: () => ({ length: 0, width: 0, height: 0 }),
      },
      // SEO fields
      metaTitle: {
        type: String,
        trim: true,
        maxlength: [60, "Meta title cannot exceed 60 characters"],
      },
      metaDescription: {
        type: String,
        trim: true,
        maxlength: [160, "Meta description cannot exceed 160 characters"],
      },
      // Offer/Discount
      offer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Offer",
        default: null,
      },
      // Variant system
      hasVariants: {
        type: Boolean,
        default: false,
        index: true,
      },
      // NEW: Variant Attributes definition
      variantAttributes: {
        type: [variantAttributeSchema],
        default: [],
        validate: {
          validator: function (attributes) {
            if (this.hasVariants === true) {
              if (attributes.length === 0) {
                return false // Must have attributes if hasVariants is true
              }
              // Ensure attribute names are unique
              const attributeNames = attributes.map((attr) => attr.name.toLowerCase())
              const uniqueAttributeNames = [...new Set(attributeNames)]
              if (attributeNames.length !== uniqueAttributeNames.length) {
                return false // Duplicate attribute names
              }
              // Ensure each attribute has a name and at least one non-empty value
              return attributes.every(
                (attr) => attr.name.trim() && attr.values.length > 0 && attr.values.every((val) => val.trim()),
              )
            }
            return true // No validation if hasVariants is false
          },
          message: "At least one unique variant attribute with values is required when hasVariants is true.",
        },
      },
      // FIXED: Simplified variants validation
      variants: {
        type: [variantSchema],
        default: [],
        validate: {
          validator: function (variants) {
            // If hasVariants is false, variants array must be empty
            if (this.hasVariants === false) {
              return variants.length === 0
            }

            // If hasVariants is true, must have at least one variant
            if (this.hasVariants === true) {
              if (variants.length === 0) {
                return false
              }
              // Check for duplicate SKUs within variants
              const skus = variants.map((v) => v.sku)
              const uniqueSkus = [...new Set(skus)]
              if (skus.length !== uniqueSkus.length) {
                return false // Duplicate variant SKUs
              }

              // Validate that each variant's options match the defined variantAttributes
              const definedAttributes = this.variantAttributes.map((attr) => attr.name.toLowerCase())
              return variants.every((variant) => {
                if (!variant.options || variant.options.length !== definedAttributes.length) {
                  return false // Mismatch in number of options or options missing
                }
                const variantOptionNames = variant.options.map((opt) => opt.attributeName.toLowerCase())
                // Check if all defined attributes are present in variant options
                const allAttributesPresent = definedAttributes.every((attrName) =>
                  variantOptionNames.includes(attrName),
                )
                // Check if variant options only contain defined attributes and their values are valid
                const validOptionValues = variant.options.every((opt) => {
                  const attrDef = this.variantAttributes.find(
                    (attr) => attr.name.toLowerCase() === opt.attributeName.toLowerCase(),
                  )
                  return attrDef && attrDef.values.includes(opt.value)
                })
                return allAttributesPresent && validOptionValues
              })
            }
            return true // Default case
          },
          message: function (props) {
            if (this.hasVariants === false) {
              if (props.value.length > 0) {
                return "Variants should be empty when hasVariants is false"
              }
            }
            if (this.hasVariants === true) {
              if (props.value.length === 0) {
                return "At least one variant is required when hasVariants is true"
              }
              const skus = props.value.map((v) => v.sku)
              const uniqueSkus = [...new Set(skus)]
              if (skus.length !== uniqueSkus.length) {
                return "Duplicate variant SKUs are not allowed"
              }
              return "Variant options must match defined attributes and their values."
            }
            return "Variant validation failed"
          },
        },
      },
      // Status and timestamps
      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },
      // Computed fields
      stockStatus: {
        type: String,
        enum: ["in-stock", "low-stock", "out-of-stock", "backorderable", "not-tracked"],
        default: function () {
          return this.trackQuantity === true ? "in-stock" : "not-tracked"
        },
      },
      // Analytics fields
      viewCount: {
        type: Number,
        default: 0,
        min: 0,
      },
      salesCount: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    {
      timestamps: true,
      toJSON: {
        virtuals: true,
        transform: (doc, ret) => {
          // Convert price to numbers for JSON output
          if (!ret.hasVariants) {
            ret.price = Number.parseFloat(ret.price) || 0
            // Only include stock if quantity tracking is enabled
            if (ret.trackQuantity === true && ret.stock !== undefined) {
              ret.stock = Number.parseInt(ret.stock) || 0
            } else {
              delete ret.stock
            }
          } else {
            // For variant products, main price is 0, stock is 0
            ret.price = 0
            ret.stock = 0
          }

          // Convert variant prices and stocks to numbers
          if (ret.variants && ret.variants.length > 0) {
            ret.variants = ret.variants.map((variant) => {
              const processedVariant = {
                ...variant,
                price: Number.parseFloat(variant.price) || 0,
                originalPrice: variant.originalPrice ? Number.parseFloat(variant.originalPrice) : undefined,
              }
              // Only include stock if quantity tracking is enabled for the product AND variant has stock
              if (ret.trackQuantity === true && variant.stock !== undefined) {
                processedVariant.stock = Number.parseInt(variant.stock) || 0
              } else {
                delete processedVariant.stock
              }
              return processedVariant
            })
          }
          return ret
        },
      },
      toObject: { virtuals: true },
    },
  )

  // Indexes for better performance
  productSchema.index({ name: "text", shortDescription: "text", description: "text" })
  productSchema.index({ category: 1, isActive: 1 })
  productSchema.index({ tags: 1 })
  productSchema.index({ createdAt: -1 })
  productSchema.index({ price: 1 })
  productSchema.index({ stock: 1 })
  productSchema.index({ sku: 1 }, { unique: true })
  productSchema.index({ slug: 1 }, { unique: true })
  productSchema.index({ trackQuantity: 1 })

  // Virtual for discount percentage
  productSchema.virtual("discountPercentage").get(function () {
    if (this.originalPrice && this.originalPrice > this.price) {
      return Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100)
    }
    return 0
  })

  // Virtual for total variant stock (only if tracking quantity)
  productSchema.virtual("totalVariantStock").get(function () {
    if (!this.hasVariants || !this.variants || this.variants.length === 0 || this.trackQuantity !== true) {
      return 0
    }
    return this.variants.reduce((total, variant) => {
      return total + (Number.parseInt(variant.stock) || 0)
    }, 0)
  })

  // Virtual for lowest variant price
  productSchema.virtual("lowestVariantPrice").get(function () {
    if (!this.hasVariants || !this.variants || this.variants.length === 0) {
      return this.price || 0
    }
    const prices = this.variants.map((v) => Number.parseFloat(v.price) || 0)
    return Math.min(...prices)
  })

  // FIXED: Pre-save middleware with better error handling
  productSchema.pre("save", function (next) {
    try {
      // Generate slug if not provided
      if (!this.slug && this.name) {
        this.slug = this.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
      }

      // Set thumbnail from gallery if not set
      if (!this.thumbnail && this.gallery && this.gallery.length > 0) {
        this.thumbnail = this.gallery[0]
      }

      // Validate variant-specific logic
      if (this.hasVariants === true) {
        // Reset main product price and stock for variant products
        this.price = 0
        this.originalPrice = undefined // Original price not applicable for main product with variants
        this.stock = 0 // Variants handle their own stock

        // Ensure we have variants
        if (!this.variants || this.variants.length === 0) {
          return next(new Error("At least one variant is required when hasVariants is true"))
        }
        // Validate variant SKUs are unique
        const variantSkus = this.variants.map((v) => v.sku)
        const uniqueSkus = [...new Set(variantSkus)]
        if (variantSkus.length !== uniqueSkus.length) {
          return next(new Error("Variant SKUs must be unique"))
        }
        // Check for duplicate with main product SKU
        if (variantSkus.includes(this.sku)) {
          return next(new Error("Variant SKU cannot be the same as product SKU"))
        }

        // Validate variant stock fields based on trackQuantity
        if (this.trackQuantity === true) {
          for (const variant of this.variants) {
            if (variant.stock === undefined || variant.stock === null || variant.stock === "") {
              return next(new Error(`Variant "${variant.name}" requires stock when quantity tracking is enabled`))
            }
          }
        }
      } else {
        // Clear variants and variant attributes for non-variant products
        this.variants = []
        this.variantAttributes = []

        // Handle stock for non-variant products
        if (this.trackQuantity === true) {
          // Set default stock if tracking quantity and no stock is set
          if (this.stock === undefined || this.stock === null) {
            this.stock = 0
          }
        } else {
          // Remove stock field if not tracking quantity
          this.stock = undefined
        }
      }

      // Update stock status only if tracking quantity
      if (this.trackQuantity === true) {
        this.updateStockStatus()
      } else {
        this.stockStatus = "not-tracked"
      }

      next()
    } catch (error) {
      next(error)
    }
  })

  // FIXED: Pre-update middleware for findByIdAndUpdate operations
  productSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
    try {
      const update = this.getUpdate()
      // Get the effective hasVariants and trackQuantity from the update object or the existing document
      const effectiveHasVariants = update.hasVariants !== undefined ? update.hasVariants : this.hasVariants
      const effectiveTrackQuantity = update.trackQuantity !== undefined ? update.trackQuantity : this.trackQuantity

      // Ensure boolean values are correctly interpreted
      const isVariantProduct = effectiveHasVariants === true || effectiveHasVariants === "true"
      const shouldTrackQuantity = effectiveTrackQuantity === true || effectiveTrackQuantity === "true"

      console.log("🔍 PRE-UPDATE: Processing update operation:", {
        updateHasVariants: update.hasVariants,
        isVariantProduct,
        updateTrackQuantity: update.trackQuantity,
        shouldTrackQuantity,
        variantsLength: update.variants ? update.variants.length : 0,
      })

      // Handle variants and variant attributes validation for update operations
      if (isVariantProduct) {
        if (!update.variants || update.variants.length === 0) {
          return next(new Error("At least one variant is required when hasVariants is true"))
        }
        if (!update.variantAttributes || update.variantAttributes.length === 0) {
          return next(new Error("At least one variant attribute is required when hasVariants is true"))
        }

        // If variants are being updated, ensure their stock is valid if tracking quantity
        if (shouldTrackQuantity) {
          for (const variant of update.variants) {
            if (variant.stock === undefined || variant.stock === null || variant.stock === "") {
              return next(new Error(`Variant "${variant.name}" requires stock when quantity tracking is enabled`))
            }
          }
        }
        // Set main product price and stock to 0 for variant products
        update.price = 0
        update.originalPrice = undefined // Original price not applicable for main product with variants
        update.stock = 0
      } else {
        // If hasVariants is explicitly set to false, ensure variants and variantAttributes arrays are empty
        if (update.variants && update.variants.length > 0) {
          update.variants = []
          this.setUpdate(update)
          console.log("📝 PRE-UPDATE: Cleared variants array because hasVariants is false.")
        }
        if (update.variantAttributes && update.variantAttributes.length > 0) {
          update.variantAttributes = []
          this.setUpdate(update)
          console.log("📝 PRE-UPDATE: Cleared variantAttributes array because hasVariants is false.")
        }

        // Handle main product stock logic based on shouldTrackQuantity
        if (shouldTrackQuantity) {
          // For non-variant products with quantity tracking enabled
          if (update.stock === undefined || update.stock === null || update.stock === "") {
            // If stock is not provided in update, set it to 0 or keep existing if it's a number
            const currentStock = this.stock // Get existing stock from the document
            if (typeof currentStock !== "number" || isNaN(currentStock)) {
              update.stock = 0
            } else {
              update.stock = currentStock
            }
            this.setUpdate(update)
            console.log(
              "📝 PRE-UPDATE: Set main product stock to default/existing value for non-variant, tracked product.",
            )
          }
        } else {
          // If quantity tracking is disabled, ensure stock is unset for the main product
          if (update.stock !== undefined) {
            update.$unset = { ...update.$unset, stock: 1 }
            delete update.stock // Remove stock from $set if it was there
            this.setUpdate(update)
            console.log("📝 PRE-UPDATE: Unset main product stock because quantity tracking is disabled.")
          }
        }
      }

      // Update stock status based on the new state
      // Note: updateStockStatus is an instance method, not directly usable here.
      // The API route should handle setting stockStatus based on the final data.
      // Or, we can trigger a post-update hook if needed. For now, rely on API route.

      next()
    } catch (error) {
      next(error)
    }
  })

  // Instance method to update stock status (only if tracking quantity)
  productSchema.methods.updateStockStatus = function () {
    if (this.trackQuantity !== true) {
      this.stockStatus = "not-tracked"
      return
    }
    let currentStock = this.stock || 0
    if (this.hasVariants) {
      currentStock = this.totalVariantStock
    }
    if (currentStock === 0) {
      this.stockStatus = this.allowBackorders ? "backorderable" : "out-of-stock"
    } else if (currentStock <= this.lowStockAlert) {
      this.stockStatus = "low-stock"
    } else {
      this.stockStatus = "in-stock"
    }
  }

  // Instance method to check if product is in stock (only if tracking quantity)
  productSchema.methods.isInStock = function () {
    if (this.trackQuantity !== true) {
      return true // Always available if not tracking quantity
    }
    if (this.hasVariants) {
      return this.variants.some((variant) => Number.parseInt(variant.stock) > 0)
    }
    return (this.stock || 0) > 0
  }

  // Instance method to get available stock (only if tracking quantity)
  productSchema.methods.getAvailableStock = function (variantId = null) {
    if (this.trackQuantity !== true) {
      return Number.POSITIVE_INFINITY // Unlimited if not tracking quantity
    }
    if (this.hasVariants && variantId) {
      const variant = this.variants.id(variantId)
      return variant ? Number.parseInt(variant.stock) : 0
    }
    if (this.hasVariants) {
      return this.totalVariantStock
    }
    return this.stock || 0
  }

  // Instance method to reduce stock (only if tracking quantity)
  productSchema.methods.reduceStock = function (quantity, variantId = null) {
    if (this.trackQuantity !== true) {
      return // Do nothing if not tracking quantity
    }
    if (this.hasVariants && variantId) {
      const variant = this.variants.id(variantId)
      if (variant) {
        const currentStock = Number.parseInt(variant.stock)
        variant.stock = Math.max(0, currentStock - quantity).toString()
      }
    } else if (!this.hasVariants) {
      this.stock = Math.max(0, (this.stock || 0) - quantity)
    }
    this.updateStockStatus()
  }

  // Static method to find products by category
  productSchema.statics.findByCategory = function (categoryId, options = {}) {
    const query = { category: categoryId, isActive: true }
    return this.find(query, null, options).populate("category", "name slug").populate("offer", "name type value")
  }

  // Static method to search products
  productSchema.statics.search = function (searchTerm, options = {}) {
    const query = {
      $and: [
        { isActive: true },
        {
          $or: [
            { name: { $regex: searchTerm, $options: "i" } },
            { shortDescription: { $regex: searchTerm, $options: "i" } },
            { tags: { $in: [new RegExp(searchTerm, "i")] } },
            { sku: { $regex: searchTerm, $options: "i" } },
          ],
        },
      ],
    }
    return this.find(query, null, options).populate("category", "name slug").populate("offer", "name type value")
  }

  // Static method to get low stock products (only for products tracking quantity)
  productSchema.statics.getLowStockProducts = function () {
    return this.find({
      trackQuantity: true,
      $or: [
        {
          hasVariants: false,
          stock: { $lte: this.schema.paths.lowStockAlert.default() }, // Use default function
        },
        {
          hasVariants: true,
          "variants.stock": { $lte: this.schema.paths.lowStockAlert.default() }, // Use default function
        },
      ],
      isActive: true,
    }).populate("category", "name")
  }

  // Create and return the model
  const Product = tenantDB.model("Product", productSchema)
  return Product
}
