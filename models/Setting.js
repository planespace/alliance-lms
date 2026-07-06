// ============================================
// File: models/Setting.js
// ============================================
const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema({
  tagExpiryNotificationDays: { type: Number, default: 1 },
  forgottenNotificationRetentionDays: { type: Number, default: 15 },
  punishmentAutoDismissDays: { type: Number, default: 2 },
  cumulativeMissedDutiesThreshold: { type: Number, default: 3 },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});

module.exports = mongoose.model("Setting", settingSchema);