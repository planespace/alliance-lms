// ============================================
// File: routes/auth.js
// ============================================
const express = require("express");
const router = express.Router();

// Simple login – no real authentication yet
router.post("/", (req, res) => {
  const { username, password } = req.body;
  if (username && password) {
    res.json({ success: true, user: username });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

module.exports = router;
