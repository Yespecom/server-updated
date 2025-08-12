module.exports = (tenantDB) => {
  const mongoose = require("mongoose")

  const categorySchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
      },
      slug: {
        type: String,
        unique: true,
        lowercase: true,
      },
      image: {
        type: String,
        default: "",
      },
      parentCategory: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        default: null,
      },
      sortOrder: {
        type: Number,
        default: 0,
      },
      isActive: {
        type: Boolean,
        default: true,
      },
      seo: {
        title: String,
        description: String,
        keywords: [String],
      },
    },
    {
      timestamps: true,
    },
  )

  // Indexes
  categorySchema.index({ name: 1 })
  categorySchema.index({ slug: 1 })
  categorySchema.index({ isActive: 1 })
  categorySchema.index({ parentCategory: 1 })
  categorySchema.index({ sortOrder: 1 })

  // Generate slug from name
  categorySchema.pre("save", function (next) {
    if (this.isModified("name") && !this.slug) {
      this.slug = this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
    }
    next()
  })

  // Virtual for subcategories
  categorySchema.virtual("subcategories", {
    ref: "Category",
    localField: "_id",
    foreignField: "parentCategory",
  })

  // Method to get category hierarchy
  categorySchema.methods.getHierarchy = async function () {
    const hierarchy = [this]
    let current = this

    while (current.parentCategory) {
      current = await this.constructor.findById(current.parentCategory)
      if (current) {
        hierarchy.unshift(current)
      } else {
        break
      }
    }

    return hierarchy
  }

  return tenantDB.models.Category || tenantDB.model("Category", categorySchema)
}
