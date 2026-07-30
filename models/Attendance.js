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
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});
attendanceSchema.index({ duty_instance_id: 1 });
attendanceSchema.index({ librarian_id: 1 });
attendanceSchema.index(
  { duty_instance_id: 1, librarian_id: 1 },
  { unique: true }
);
module.exports = mongoose.model("Attendance", attendanceSchema);