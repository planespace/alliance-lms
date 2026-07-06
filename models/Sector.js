// ============================================
// File: models/Sector.js
// ============================================
const mongoose = require("mongoose");

const sectorSchema = new mongoose.Schema({
  name: String,
  parent_id: { type: String, default: null },
  is_leaf: { type: Boolean, default: false },
  min_people: { type: Number, default: 1 },
  description: String,
  duty_settings_list: [Object],
  leader_ids: [String],
  created_at: { type: Date, default: Date.now },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});

module.exports = mongoose.model("Sector", sectorSchema);