// ============================================
// File: models/Tag.js
// ============================================
const mongoose = require("mongoose");

const tagSchema = new mongoose.Schema({
  name: String,
  description: String,
  type: String,
  librarian_id: String,
  start_date: String,
  end_date: String,
  is_active: { type: Boolean, default: true },
  duty_id: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  removed_at: Date,
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});

tagSchema.index({ librarian_id: 1 });
tagSchema.index({ type: 1, librarian_id: 1 });
module.exports = mongoose.model("Tag", tagSchema);