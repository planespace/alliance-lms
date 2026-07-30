// ============================================
// File: models/Librarian.js
// ============================================
const mongoose = require("mongoose");

const librarianSchema = new mongoose.Schema({
  name: String,
  grade: String,
  adm_no: String,                 // remove unique:true from the field itself
  date_joined: String,
  house: String,
  is_deleted: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  // ★★★ NEW – multi‑user isolation ★★★
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
});

// ★ Scoped unique index for adm_no per user
librarianSchema.index({ adm_no: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model("Librarian", librarianSchema);