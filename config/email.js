const nodemailer = require("nodemailer")

// Create SMTP transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER, // Your email
      pass: process.env.SMTP_PASS, // Your email password or app password
    },
  })
}

// Send OTP email
const sendOTPEmail = async (email, otp, purpose = "verification") => {
  try {
    const transporter = createTransporter()

    const mailOptions = {
      from: `"${process.env.APP_NAME || "YourStore"}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Your OTP Code - ${purpose}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">OTP Verification</h1>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; text-align: center;">
            <h2 style="color: #333; margin-bottom: 20px;">Your Verification Code</h2>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px dashed #667eea;">
              <span style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${otp}</span>
            </div>
            <p style="color: #666; font-size: 16px; margin: 20px 0;">
              This OTP is valid for <strong>10 minutes</strong> only.
            </p>
            <p style="color: #999; font-size: 14px;">
              If you didn't request this code, please ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding: 20px; color: #999; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ${process.env.APP_NAME || "YourStore"}. All rights reserved.</p>
          </div>
        </div>
      `,
    }

    const info = await transporter.sendMail(mailOptions)
    console.log(`📧 OTP email sent to ${email}: ${info.messageId}`)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error("❌ Email sending error:", error)
    throw new Error(`Failed to send OTP email: ${error.message}`)
  }
}

// Send welcome email
const sendWelcomeEmail = async (email, name) => {
  try {
    const transporter = createTransporter()

    const mailOptions = {
      from: `"${process.env.APP_NAME || "YourStore"}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Welcome to ${process.env.APP_NAME || "YourStore"}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to ${process.env.APP_NAME || "YourStore"}!</h1>
          </div>
          
          <div style="padding: 30px; text-align: center;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${name}! 👋</h2>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
              Thank you for joining us! Your account has been successfully created and verified.
            </p>
            <p style="color: #666; font-size: 16px; line-height: 1.6;">
              You can now start building your online store and reach more customers.
            </p>
            
            <div style="margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard" 
                 style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                Get Started
              </a>
            </div>
          </div>
        </div>
      `,
    }

    const info = await transporter.sendMail(mailOptions)
    console.log(`📧 Welcome email sent to ${email}: ${info.messageId}`)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error("❌ Welcome email error:", error)
    // Don't throw error for welcome email as it's not critical
    return { success: false, error: error.message }
  }
}

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
}
