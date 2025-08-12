module.exports = (tenantDB) => {
  const mongoose = require("mongoose")

  const settingsSchema = new mongoose.Schema(
    {
      general: {
        storeName: {
          type: String,
          default: "",
        },
        storeDescription: {
          type: String,
          default: "",
        },
        logo: {
          type: String,
          default: "",
        },
        banner: {
          type: String,
          default: "",
        },
        favicon: {
          type: String,
          default: "",
        },
        tagline: {
          type: String,
          default: "Welcome to our store",
        },
        supportEmail: {
          type: String,
          default: "",
        },
        supportPhone: {
          type: String,
          default: "",
        },
        address: {
          street: String,
          city: String,
          state: String,
          zipCode: String,
          country: String,
        },
        timezone: {
          type: String,
          default: "Asia/Kolkata",
        },
        currency: {
          type: String,
          default: "INR",
        },
        language: {
          type: String,
          default: "en",
        },
      },
      payment: {
        codEnabled: {
          type: Boolean,
          default: true,
        },
        onlinePaymentEnabled: {
          type: Boolean,
          default: false,
        },
        razorpay: {
          enabled: {
            type: Boolean,
            default: false,
          },
          keyId: String,
          keySecret: String,
        },
        stripe: {
          enabled: {
            type: Boolean,
            default: false,
          },
          publishableKey: String,
          secretKey: String,
        },
        paypal: {
          enabled: {
            type: Boolean,
            default: false,
          },
          clientId: String,
          clientSecret: String,
        },
      },
      shipping: {
        freeShippingEnabled: {
          type: Boolean,
          default: false,
        },
        freeShippingAbove: {
          type: Number,
          default: 500,
        },
        charges: {
          type: Number,
          default: 50,
        },
        deliveryTime: {
          type: String,
          default: "2-3 business days",
        },
        zones: [
          {
            name: String,
            areas: [String],
            charge: Number,
            deliveryTime: String,
          },
        ],
      },
      tax: {
        enabled: {
          type: Boolean,
          default: false,
        },
        rate: {
          type: Number,
          default: 0,
        },
        inclusive: {
          type: Boolean,
          default: false,
        },
      },
      social: {
        facebook: {
          type: String,
          default: "",
        },
        instagram: {
          type: String,
          default: "",
        },
        twitter: {
          type: String,
          default: "",
        },
        youtube: {
          type: String,
          default: "",
        },
        whatsapp: {
          type: String,
          default: "",
        },
        telegram: {
          type: String,
          default: "",
        },
      },
      seo: {
        title: {
          type: String,
          default: "",
        },
        description: {
          type: String,
          default: "",
        },
        keywords: [String],
        googleAnalytics: {
          type: String,
          default: "",
        },
        facebookPixel: {
          type: String,
          default: "",
        },
      },
      notifications: {
        email: {
          enabled: {
            type: Boolean,
            default: true,
          },
          newOrder: {
            type: Boolean,
            default: true,
          },
          lowStock: {
            type: Boolean,
            default: true,
          },
        },
        sms: {
          enabled: {
            type: Boolean,
            default: false,
          },
          newOrder: {
            type: Boolean,
            default: false,
          },
        },
        push: {
          enabled: {
            type: Boolean,
            default: false,
          },
        },
      },
      theme: {
        primaryColor: {
          type: String,
          default: "#3B82F6",
        },
        secondaryColor: {
          type: String,
          default: "#64748B",
        },
        accentColor: {
          type: String,
          default: "#F59E0B",
        },
        fontFamily: {
          type: String,
          default: "Inter",
        },
        layout: {
          type: String,
          enum: ["grid", "list", "masonry"],
          default: "grid",
        },
      },
      security: {
        twoFactorEnabled: {
          type: Boolean,
          default: false,
        },
        sessionTimeout: {
          type: Number,
          default: 24, // hours
        },
        passwordPolicy: {
          minLength: {
            type: Number,
            default: 6,
          },
          requireNumbers: {
            type: Boolean,
            default: true,
          },
          requireSymbols: {
            type: Boolean,
            default: false,
          },
        },
      },
    },
    {
      timestamps: true,
    },
  )

  // Ensure only one settings document exists
  settingsSchema.index({}, { unique: true })

  // Static method to get settings (create if doesn't exist)
  settingsSchema.statics.getSettings = async function () {
    let settings = await this.findOne()
    if (!settings) {
      settings = new this()
      await settings.save()
    }
    return settings
  }

  return tenantDB.models.Settings || tenantDB.model("Settings", settingsSchema)
}
