// ============================================
// File: models/Attendance.js
// ============================================
const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  duty_instance_id: String,
  librarian_id: String,
  attended: { type: Boolean, default: false },
  confirmed_by: String,
  confirmed_at: Date,
  forgiven: { type: Boolean, default: false },
  punishment_issued: { type: Boolean, default: false },
  notes: String,
});

module.exports = mongoose.model("Attendance", attendanceSchema);
