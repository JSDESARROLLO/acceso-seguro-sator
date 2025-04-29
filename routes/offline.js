const express = require("express")
const router = express.Router()

// Ruta para la página offline
router.get("/offline", (req, res) => {
  res.render("offline")
})

module.exports = router
