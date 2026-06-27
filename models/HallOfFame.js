// ============================================
// File: models/HallOfFame.js
// ============================================
const mongoose = require("mongoose");

// Captains
const captainSchema = new mongoose.Schema({
  name: String,
  adm_no: String,
  year: Number,
  house: String,
  photo_url: String,
  created_at: { type: Date, default: Date.now },
});

// Committees
const committeeMemberSchema = new mongoose.Schema(
  {
    name: String,
    adm_no: String,
    class: String,
    house: String,
    position: String,
    photo_url: String,
  },
  { _id: false }
);

const committeeSchema = new mongoose.Schema({
  year: Number,
  members: [committeeMemberSchema],
  created_at: { type: Date, default: Date.now },
});

const Captain = mongoose.model("Captain", captainSchema);
const Committee = mongoose.model("Committee", committeeSchema);

module.exports = { Captain, Committee };
