// ============================================
// File: models/Setting.js   (optional, can be stored in localStorage)
// ============================================
const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema({
  tagExpiryNotificationDays: { type: Number, default: 1 },
  forgottenNotificationRetentionDays: { type: Number, default: 15 },
  punishmentAutoDismissDays: { type: Number, default: 2 },
  cumulativeMissedDutiesThreshold: { type: Number, default: 3 },
});

module.exports = mongoose.model("Setting", settingSchema);
