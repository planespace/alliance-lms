// ============================================
// File: models/Notification.js
// ============================================
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  message: String,
  type: String,
  librarian_id: String,
  duty_instance_id: String,
  tag_id: String,
  date: String,
  is_read: { type: Boolean, default: false },
  is_forgotten: { type: Boolean, default: false },
  is_dismissed: { type: Boolean, default: false },
  forgotten_at: Date,
  dismiss_until: Date,
  created_at: { type: Date, default: Date.now },
});

notificationSchema.index({ type: 1, librarian_id: 1 });
notificationSchema.index({ date: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
