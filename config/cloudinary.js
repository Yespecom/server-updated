// Make sure the Cloudinary configuration is properly set up:

const cloudinary = require("cloudinary").v2
const { CloudinaryStorage } = require("multer-storage-cloudinary")

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

console.log("🔧 Cloudinary configuration loaded:", {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? "✅ Set" : "❌ Missing",
  api_key: process.env.CLOUDINARY_API_KEY ? "✅ Set" : "❌ Missing",
  api_secret: process.env.CLOUDINARY_API_SECRET ? "✅ Set" : "❌ Missing",
})

// Upload function with better error handling
const upload = async (buffer, folder = "uploads") => {
  try {
    console.log("📸 Starting Cloudinary upload to folder:", folder)
    console.log("📸 Buffer size:", buffer.length, "bytes")

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: "image",
          quality: "auto",
          fetch_format: "auto",
          transformation: [
            { width: 1200, height: 1200, crop: "limit" }, // Limit max size
            { quality: "auto:good" }, // Optimize quality
          ],
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary upload error:", error)
            reject(error)
          } else {
            console.log("✅ Cloudinary upload success:", result.public_id)
            resolve(result)
          }
        },
      )

      uploadStream.end(buffer)
    })
  } catch (error) {
    console.error("❌ Upload function error:", error)
    throw error
  }
}

// Delete function with better error handling
const deleteImage = async (publicId) => {
  try {
    console.log("🗑️ Deleting image from Cloudinary:", publicId)

    const result = await cloudinary.uploader.destroy(publicId)
    console.log("✅ Cloudinary delete result:", result)

    return result
  } catch (error) {
    console.error("❌ Cloudinary delete error:", error)
    throw error
  }
}

// Helper function to extract public ID from URL
const getPublicIdFromUrl = (url) => {
  try {
    if (!url || !url.includes("cloudinary.com")) {
      return null
    }

    // Extract public ID from Cloudinary URL
    const parts = url.split("/")
    const uploadIndex = parts.findIndex((part) => part === "upload")

    if (uploadIndex === -1) return null

    // Get everything after version (if exists) or after upload
    let publicIdParts = parts.slice(uploadIndex + 1)

    // Remove version if it exists (starts with 'v' followed by numbers)
    if (publicIdParts[0] && /^v\d+$/.test(publicIdParts[0])) {
      publicIdParts = publicIdParts.slice(1)
    }

    // Join the remaining parts and remove file extension
    const publicId = publicIdParts.join("/").replace(/\.[^/.]+$/, "")
    console.log("🔍 Extracted public ID:", publicId, "from URL:", url)

    return publicId
  } catch (error) {
    console.error("❌ Error extracting public ID:", error)
    return null
  }
}

module.exports = {
  upload,
  deleteImage,
  getPublicIdFromUrl,
  cloudinary,
}
