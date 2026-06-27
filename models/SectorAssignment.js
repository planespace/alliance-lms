// ============================================
// File: models/SectorAssignment.js   (needed by sectors routes)
// ============================================
const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema({
  sector_id: String,
  librarian_id: String,
  assigned_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SectorAssignment", assignmentSchema);
