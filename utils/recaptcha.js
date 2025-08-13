// reCAPTCHA v3 utility functions for frontend

interface RecaptchaConfig {
  enabled: boolean
  v3: {
    enabled: boolean
    siteKey: string
    scoreThreshold: number
  }
  v2: {
    enabled: boolean
    siteKey: string
  }
}

interface RecaptchaVerificationResult {
  success: boolean
  score?: number
  action?: string
  error?: string
  code?: string
  details?: any
}

class RecaptchaUtils {
  private config: RecaptchaConfig | null = null
  private isV3Loaded = false
  private loadingPromise: Promise<void> | null = null

  // Initialize reCAPTCHA configuration
  async init(): Promise<RecaptchaConfig | null> {
    try {
      const response = await fetch("/api/recaptcha/config")
      const data = await response.json()

      if (data.success) {
        this.config = data.config
        console.log("🔒 reCAPTCHA initialized:", {
          enabled: this.config.enabled,
          v3Enabled: this.config.v3.enabled,
          v2Enabled: this.config.v2.enabled,
        })
        return this.config
      } else {
        console.error("❌ Failed to load reCAPTCHA config:", data.error)
        return null
      }
    } catch (error) {
      console.error("❌ reCAPTCHA initialization failed:", error)
      return null
    }
  }

  // Load reCAPTCHA v3 script
  private async loadV3Script(): Promise<void> {
    if (this.isV3Loaded || !this.config?.v3.enabled) {
      return
    }

    if (this.loadingPromise) {
      return this.loadingPromise
    }

    this.loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = `https://www.google.com/recaptcha/api.js?render=${this.config!.v3.siteKey}`
      script.async = true
      script.defer = true

      script.onload = () => {
        this.isV3Loaded = true
        console.log("✅ reCAPTCHA v3 script loaded")
        resolve()
      }

      script.onerror = () => {
        reject(new Error("Failed to load reCAPTCHA v3 script"))
      }

      document.head.appendChild(script)
    })

    return this.loadingPromise
  }

  // Execute reCAPTCHA v3 for specific action
  async executeV3(action: string): Promise<string> {
    if (!this.config) {
      await this.init()
    }

    if (!this.config?.enabled || !this.config.v3.enabled) {
      throw new Error("reCAPTCHA v3 is not enabled")
    }

    await this.loadV3Script()

    if (!window.grecaptcha) {
      throw new Error("reCAPTCHA v3 not loaded")
    }

    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(async () => {
        try {
          const token = await window.grecaptcha.execute(this.config!.v3.siteKey, { action })
          console.log(`✅ reCAPTCHA v3 token generated for action: ${action}`)
          resolve(token)
        } catch (error) {
          console.error(`❌ reCAPTCHA v3 execution failed for action ${action}:`, error)
          reject(error)
        }
      })
    })
  }

  // Execute reCAPTCHA for login
  async executeLogin(): Promise<string> {
    return this.executeV3("login")
  }

  // Execute reCAPTCHA for register
  async executeRegister(): Promise<string> {
    return this.executeV3("register")
  }

  // Verify token on server (for testing)
  async verifyToken(token: string, version = "v3", action?: string): Promise<RecaptchaVerificationResult> {
    try {
      const response = await fetch("/api/recaptcha/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          version,
          action,
        }),
      })

      const data = await response.json()
      return data.result || data
    } catch (error) {
      console.error("❌ reCAPTCHA verification request failed:", error)
      return {
        success: false,
        error: "Verification request failed",
        details: error,
      }
    }
  }

  // Add reCAPTCHA token to form data
  async addTokenToFormData(formData: FormData, action: string): Promise<void> {
    try {
      const token = await this.executeV3(action)
      formData.append("recaptchaToken", token)
    } catch (error) {
      console.error("❌ Failed to add reCAPTCHA token to form:", error)
      throw error
    }
  }

  // Add reCAPTCHA token to request body
  async addTokenToBody(body: any, action: string): Promise<any> {
    try {
      const token = await this.executeV3(action)
      return {
        ...body,
        recaptchaToken: token,
      }
    } catch (error) {
      console.error("❌ Failed to add reCAPTCHA token to body:", error)
      throw error
    }
  }

  // Add reCAPTCHA token to headers
  async addTokenToHeaders(headers: Record<string, string>, action: string): Promise<Record<string, string>> {
    try {
      const token = await this.executeV3(action)
      return {
        ...headers,
        "X-Recaptcha-Token": token,
      }
    } catch (error) {
      console.error("❌ Failed to add reCAPTCHA token to headers:", error)
      throw error
    }
  }

  // Check if reCAPTCHA is enabled
  isEnabled(): boolean {
    return this.config?.enabled || false
  }

  // Check if v3 is enabled
  isV3Enabled(): boolean {
    return this.config?.v3.enabled || false
  }

  // Get configuration
  getConfig(): RecaptchaConfig | null {
    return this.config
  }

  // Get v3 site key
  getV3SiteKey(): string | null {
    return this.config?.v3.siteKey || null
  }
}

// Create singleton instance
const recaptchaUtils = new RecaptchaUtils()

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      recaptchaUtils.init()
    })
  } else {
    recaptchaUtils.init()
  }
}

// Global declaration for grecaptcha
declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void
      execute: (siteKey: string, options: { action: string }) => Promise<string>
    }
  }
}

export default recaptchaUtils
export { RecaptchaUtils, type RecaptchaConfig, type RecaptchaVerificationResult }
