// ============================================
// File: models/TagHistory.js
// ============================================
const mongoose = require("mongoose");

const tagHistorySchema = new mongoose.Schema({
  tag_id: String,
  librarian_id: String,
  tag_name: String,
  description: String,
  type: String,
  start_date: String,
  end_date: String,
  removed_at: Date,
  removal_reason: String,
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});

module.exports = mongoose.model("TagHistory", tagHistorySchema);