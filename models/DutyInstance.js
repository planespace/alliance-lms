// ============================================
// File: models/DutyInstance.js
// ============================================
const mongoose = require("mongoose");

const dutyInstanceSchema = new mongoose.Schema({
  duty_id: String,
  date: String,
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});
dutyInstanceSchema.index({ duty_id: 1, date: 1 }, { unique: true });
module.exports = mongoose.model("DutyInstance", dutyInstanceSchema);