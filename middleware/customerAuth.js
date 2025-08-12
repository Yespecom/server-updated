const jwt = require("jsonwebtoken")
const AuthUtils = require("../utils/auth")

const customerAuthMiddleware = async (req, res, next) => {
  try {
    console.log("🔐 Customer auth middleware started")

    const authHeader = req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("❌ No valid customer authorization header")
      return res.status(401).json({
        error: "Access denied. Please login.",
        code: "NO_TOKEN",
      })
    }

    const token = authHeader.replace("Bearer ", "")

    // Verify token
    let decoded
    try {
      decoded = AuthUtils.verifyToken(token)
      console.log("✅ Customer token verified:", {
        customerId: decoded.customerId,
        email: decoded.email,
        storeId: decoded.storeId,
      })
    } catch (tokenError) {
      console.log("❌ Customer token verification failed:", tokenError.message)

      if (tokenError.message.includes("expired")) {
        return res.status(401).json({
          error: "Session expired. Please login again.",
          code: "TOKEN_EXPIRED",
        })
      }

      return res.status(401).json({
        error: "Invalid session. Please login again.",
        code: "INVALID_TOKEN",
      })
    }

    // Validate token type
    if (decoded.type !== "customer") {
      console.log("❌ Invalid customer token type:", decoded.type)
      return res.status(401).json({
        error: "Invalid token type for customer access.",
        code: "INVALID_TOKEN_TYPE",
      })
    }

    // Verify store context: req.tenantDB and req.storeId should already be set by storeContextMiddleware
    if (!req.tenantDB || !req.storeId) {
      console.error("❌ Customer auth middleware: Missing store context (tenantDB or storeId).")
      return res.status(500).json({
        error: "Internal server error: Store context not available.",
        code: "MISSING_STORE_CONTEXT",
      })
    }

    // Security check: Ensure the storeId in the token matches the storeId in the URL path
    if (decoded.storeId !== req.storeId) {
      console.error("❌ Customer auth middleware: Token storeId mismatch with URL storeId.", {
        tokenStoreId: decoded.storeId,
        urlStoreId: req.storeId,
      })
      return res.status(401).json({
        error: "Access denied. Token is not valid for this store.",
        code: "STORE_MISMATCH",
      })
    }

    // Get customer from tenant database
    try {
      const Customer = require("../models/tenant/Customer")(req.tenantDB)
      const customer = await Customer.findById(decoded.customerId)

      if (!customer) {
        console.log("❌ Customer not found for ID:", decoded.customerId)
        return res.status(401).json({
          error: "Customer not found.",
          code: "CUSTOMER_NOT_FOUND",
        })
      }

      if (!customer.isActive) {
        console.log("❌ Customer account is inactive:", decoded.customerId)
        return res.status(401).json({
          error: "Account is deactivated. Please contact support.",
          code: "ACCOUNT_DEACTIVATED",
        })
      }

      // Check if password was changed after token was issued (if customer has password)
      if (customer.password && customer.passwordChangedAt && decoded.iat) {
        const passwordChangedTimestamp = Math.floor(customer.passwordChangedAt.getTime() / 1000)
        if (passwordChangedTimestamp > decoded.iat) {
          console.log("❌ Customer password changed after token was issued")
          return res.status(401).json({
            error: "Password was changed. Please login again.",
            code: "PASSWORD_CHANGED",
          })
        }
      }

      console.log("✅ Customer found:", customer.email || customer.phone)

      // Set customer info on request object
      req.customer = customer
      req.customerId = customer._id
      req.authToken = token
      req.tokenPayload = decoded

      // Update last login time
      customer.lastLoginAt = new Date()
      await customer.save()

      console.log("✅ Customer auth middleware completed successfully")
      next()
    } catch (customerError) {
      console.error("❌ Error loading customer:", customerError)
      return res.status(500).json({
        error: "Failed to load customer data.",
        details: customerError.message,
        code: "CUSTOMER_LOAD_ERROR",
      })
    }
  } catch (error) {
    console.error("❌ Customer auth middleware error:", error)
    res.status(500).json({
      error: "Customer authentication failed.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
      code: "CUSTOMER_AUTH_ERROR",
    })
  }
}

module.exports = customerAuthMiddleware
