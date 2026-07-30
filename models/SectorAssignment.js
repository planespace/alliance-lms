// ============================================
// File: models/SectorAssignment.js
// ============================================
const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema({
  sector_id: String,
  librarian_id: String,
  assigned_at: { type: Date, default: Date.now },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});
assignmentSchema.index({ sector_id: 1, librarian_id: 1 }, { unique: true });
module.exports = mongoose.model("SectorAssignment", assignmentSchema);