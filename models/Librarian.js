// ============================================
// File: models/Librarian.js
// ============================================
const mongoose = require("mongoose");

const librarianSchema = new mongoose.Schema({
  name: String,
  grade: String,
  adm_no: { type: String, unique: true },
  date_joined: String,
  house: String,
  is_deleted: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Librarian", librarianSchema);
