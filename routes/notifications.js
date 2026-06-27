// ============================================
// File: routes/notifications.js
// ============================================
const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");

// GET all notifications
router.get("/", async (req, res) => {
  try {
    const notifs = await Notification.find({});
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create notification
router.post("/", async (req, res) => {
  try {
    const notification = new Notification(req.body);
    await notification.save();
    res.status(201).json(notification);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update notification
router.put("/:id", async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(notification);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE notification
router.delete("/:id", async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
