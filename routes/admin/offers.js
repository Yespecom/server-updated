const express = require("express")
const router = express.Router()

// Get all offers
router.get("/", async (req, res) => {
  try {
    const Offer = require("../../models/tenant/Offer")(req.tenantDB)
    const offers = await Offer.find().sort({ createdAt: -1 })
    res.json(offers)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create offer
router.post("/", async (req, res) => {
  try {
    const Offer = require("../../models/tenant/Offer")(req.tenantDB)
    const offer = new Offer(req.body)
    await offer.save()
    res.status(201).json(offer)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update offer
router.put("/:id", async (req, res) => {
  try {
    const Offer = require("../../models/tenant/Offer")(req.tenantDB)
    const offer = await Offer.findByIdAndUpdate(req.params.id, req.body, { new: true })

    if (!offer) {
      return res.status(404).json({ error: "Offer not found" })
    }

    res.json(offer)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Delete offer
router.delete("/:id", async (req, res) => {
  try {
    const Offer = require("../../models/tenant/Offer")(req.tenantDB)
    const offer = await Offer.findByIdAndDelete(req.params.id)

    if (!offer) {
      return res.status(404).json({ error: "Offer not found" })
    }

    res.json({ message: "Offer deleted successfully" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
