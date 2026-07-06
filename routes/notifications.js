// ============================================
// File: routes/notifications.js
// ============================================
const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");

// GET all notifications for user
router.get("/", async (req, res) => {
  try {
    const notifs = await Notification.find(
      { user_id: req.user._id },
      {
        message: 1,
        type: 1,
        librarian_id: 1,
        duty_instance_id: 1,
        tag_id: 1,
        date: 1,
        is_read: 1,
        is_forgotten: 1,
        is_dismissed: 1,
        forgotten_at: 1,
        dismiss_until: 1,
      }
    ).lean();
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create notification
router.post("/", async (req, res) => {
  try {
    const notifData = { ...req.body, user_id: req.user._id };
    const notification = new Notification(notifData);
    await notification.save();
    res.status(201).json(notification);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update notification
router.put("/:id", async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
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
    await Notification.findOneAndDelete({ _id: req.params.id, user_id: req.user._id });
    res.json({ message: "Notification deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;