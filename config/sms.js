const axios = require("axios")

const sendSMS = async (phone, message) => {
  try {
    console.log(`📱 Sending SMS to ${phone}: ${message}`)

    // Check if Fast2SMS is configured
    if (process.env.FAST2SMS_API_KEY) {
      // Use Fast2SMS for production
      const fast2smsUrl = "https://www.fast2sms.com/dev/bulkV2"

      // Clean phone number (remove + and country code if present)
      let cleanPhone = phone.replace(/\s+/g, "").replace(/^\+/, "")

      // If phone starts with country code, remove it (assuming Indian numbers)
      if (cleanPhone.startsWith("91") && cleanPhone.length === 12) {
        cleanPhone = cleanPhone.substring(2)
      }

      // Validate Indian mobile number (10 digits starting with 6-9)
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        throw new Error(`Invalid Indian mobile number format: ${cleanPhone}`)
      }

      console.log(`📱 Using Fast2SMS API`)
      console.log(`📱 API Key (first 10 chars): ${process.env.FAST2SMS_API_KEY.substring(0, 10)}...`)

      // Simple payload without sender ID (Fast2SMS will use default)
      const payload = {
        authorization: process.env.FAST2SMS_API_KEY,
        message: message,
        language: "english",
        route: "q", // Quality route (promotional)
        numbers: cleanPhone,
      }

      // Only add sender_id if explicitly provided in env
      if (process.env.FAST2SMS_SENDER_ID) {
        payload.sender_id = process.env.FAST2SMS_SENDER_ID
        console.log(`📱 Using custom sender ID: ${process.env.FAST2SMS_SENDER_ID}`)
      } else {
        console.log(`📱 Using default sender ID (Fast2SMS will choose)`)
      }

      try {
        const response = await axios.post(fast2smsUrl, payload, {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 15000, // 15 second timeout
        })

        console.log(`📱 Fast2SMS response status:`, response.status)
        console.log(`📱 Fast2SMS response data:`, response.data)

        if (response.data.return === true) {
          console.log(`✅ SMS sent successfully via Fast2SMS`)
          return {
            success: true,
            messageId: response.data.request_id,
            provider: "fast2sms",
            details: response.data,
          }
        } else {
          // Handle specific Fast2SMS error responses
          if (response.data.status_code === 412) {
            throw new Error(
              `Fast2SMS Authentication Error: Invalid API key. Please get a new API key from https://www.fast2sms.com/ > Dashboard > API Keys`,
            )
          } else if (response.data.status_code === 400) {
            throw new Error(`Fast2SMS Request Error: ${response.data.message || "Bad request"}`)
          } else {
            throw new Error(`Fast2SMS Error: ${response.data.message || "Unknown error"}`)
          }
        }
      } catch (error) {
        console.error(`❌ Fast2SMS API Error:`, error.response?.data || error.message)

        // Handle specific Fast2SMS errors
        if (error.response?.data?.status_code === 412) {
          throw new Error(
            `Fast2SMS Authentication Error: Invalid API key. Please check your FAST2SMS_API_KEY in .env file. ` +
              `Go to https://www.fast2sms.com/ > Dashboard > API Keys to get a valid key.`,
          )
        } else if (error.response?.data?.status_code === 400) {
          throw new Error(`Fast2SMS Request Error: ${error.response.data.message || "Bad request"}`)
        } else if (error.response) {
          throw new Error(`Fast2SMS API Error: ${error.response.data.message || error.response.statusText}`)
        } else if (error.request) {
          throw new Error(`Network error while sending SMS: ${error.message}`)
        } else {
          throw new Error(`Failed to send SMS: ${error.message}`)
        }
      }
    } else {
      // For development/testing - just log the SMS
      console.log(`📱 DEV MODE - SMS to ${phone}: ${message}`)
      console.log(`⚠️ Fast2SMS not configured. Add FAST2SMS_API_KEY to .env`)
      console.log(`📋 Fast2SMS Setup Guide:`)
      console.log(`   1. Sign up at https://www.fast2sms.com/`)
      console.log(`   2. Add credits to your account`)
      console.log(`   3. Go to Dashboard > API Keys`)
      console.log(`   4. Copy your API key`)
      console.log(`   5. Add FAST2SMS_API_KEY=your_api_key to .env`)
      console.log(`   6. Sender ID is optional - system will use defaults`)

      return {
        success: true,
        messageId: `dev_${Date.now()}`,
        provider: "development",
        devMode: true,
      }
    }
  } catch (error) {
    console.error("❌ SMS sending error:", error)
    throw error
  }
}

const sendCustomerOTP = async (phone, otp, storeName = "Store") => {
  // Fast2SMS has a 160 character limit for messages
  const message = `Your OTP for ${storeName}: ${otp}. Valid for 10 minutes. Do not share.`

  // Ensure message is within character limit
  if (message.length > 160) {
    const shortMessage = `OTP for ${storeName}: ${otp}. Valid 10 min. Do not share.`
    return await sendSMS(phone, shortMessage)
  }

  return await sendSMS(phone, message)
}

const sendWelcomeSMS = async (phone, customerName, storeName = "Store") => {
  const message = `Welcome to ${storeName}, ${customerName}! Thank you for joining us.`
  return await sendSMS(phone, message)
}

const sendOrderConfirmationSMS = async (phone, orderNumber, storeName = "Store") => {
  const message = `Order #${orderNumber} confirmed at ${storeName}. Thank you!`
  return await sendSMS(phone, message)
}

const sendOrderStatusSMS = async (phone, orderNumber, status, storeName = "Store") => {
  const statusMessages = {
    confirmed: `Order #${orderNumber} confirmed at ${storeName}`,
    shipped: `Order #${orderNumber} shipped from ${storeName}`,
    delivered: `Order #${orderNumber} delivered. Thank you for shopping with ${storeName}!`,
    cancelled: `Order #${orderNumber} cancelled at ${storeName}`,
  }

  const message = statusMessages[status] || `Order #${orderNumber} status: ${status}`
  return await sendSMS(phone, message)
}

// Test SMS function
const testSMS = async (phone, testMessage = "Test message from your store") => {
  try {
    console.log(`🧪 Testing SMS to ${phone}`)
    const result = await sendSMS(phone, testMessage)
    console.log(`✅ Test SMS result:`, result)
    return result
  } catch (error) {
    console.error(`❌ Test SMS failed:`, error)
    throw error
  }
}

// Validate Fast2SMS configuration - SIMPLIFIED
const validateFast2SMSConfig = () => {
  const apiKey = process.env.FAST2SMS_API_KEY

  if (!apiKey) {
    return {
      valid: false,
      error: "FAST2SMS_API_KEY not found in environment variables",
      help: [
        "1. Sign up at https://www.fast2sms.com/",
        "2. Add credits to your account",
        "3. Go to Dashboard > API Keys",
        "4. Copy your API key",
        "5. Add FAST2SMS_API_KEY=your_api_key to .env file",
        "6. Sender ID is optional - Fast2SMS will use default",
      ],
    }
  }

  // Check minimum length (Fast2SMS keys are typically long)
  if (apiKey.length < 20) {
    return {
      valid: false,
      error: "Fast2SMS API key seems too short",
      help: [
        "Fast2SMS API keys are typically 50-80 characters long",
        "Please verify you copied the complete key",
        "Check Fast2SMS dashboard for the correct key",
        "Make sure your account is active and has credits",
      ],
    }
  }

  return {
    valid: true,
    message: "Fast2SMS configuration looks valid",
    keyLength: apiKey.length,
    keyPrefix: apiKey.substring(0, 10) + "...",
    senderIdRequired: false,
    note: "Sender ID is optional - Fast2SMS will use default if not provided",
  }
}

// Get SMS service status
const getSMSStatus = () => {
  const config = validateFast2SMSConfig()
  const isConfigured = !!process.env.FAST2SMS_API_KEY

  return {
    provider: "Fast2SMS",
    configured: isConfigured,
    valid: config.valid,
    apiKey: process.env.FAST2SMS_API_KEY ? process.env.FAST2SMS_API_KEY.substring(0, 10) + "..." : "Not set",
    senderId: process.env.FAST2SMS_SENDER_ID || "Default (Fast2SMS will choose)",
    senderIdRequired: false,
    supportedCountries: ["India"],
    validation: config,
    features: {
      otp: true,
      promotional: true,
      transactional: true,
      unicode: true,
    },
    limits: {
      messageLength: 160,
      dailyLimit: "Depends on your Fast2SMS plan",
    },
    setupInstructions: [
      "1. Visit https://www.fast2sms.com/",
      "2. Create account and verify your mobile number",
      "3. Add credits to your account (minimum ₹10-20)",
      "4. Go to Dashboard > API Keys",
      "5. Copy your API key (50-80 characters long)",
      "6. Add to .env: FAST2SMS_API_KEY=your_key_here",
      "7. Sender ID is optional - leave blank for default",
      "8. Restart your server",
    ],
    troubleshooting: [
      "Common issues and solutions:",
      "• 401/412 errors: Invalid or expired API key",
      "• No credits: Add money to your Fast2SMS account",
      "• Account not verified: Complete phone/email verification",
      "• API key too short: Make sure you copied the full key",
      "• Sender ID issues: Leave sender ID blank to use default",
    ],
  }
}

module.exports = {
  sendSMS,
  sendCustomerOTP,
  sendWelcomeSMS,
  sendOrderConfirmationSMS,
  sendOrderStatusSMS,
  testSMS,
  getSMSStatus,
  validateFast2SMSConfig,
}
