// ============================================
// File: models/Duty.js
// ============================================
const mongoose = require("mongoose");

const dutySchema = new mongoose.Schema({
  name: String,
  start_time: String,
  end_time: String,
  days: [String],
  recurrence_type: String,
  specific_dates: [String],
  recurrence_interval: Number,
  end_date: String,
  is_punishment: { type: Boolean, default: false },
  sector_id: { type: String, default: null },
  created_by: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});
dutySchema.index({ sector_id: 1 });
module.exports = mongoose.model("Duty", dutySchema);