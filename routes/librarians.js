// ============================================
// File: routes/librarians.js
// ============================================
const express = require("express");
const router = express.Router();
const Librarian = require("../models/Librarian");

// GET all active librarians for the logged‑in user
router.get("/", async (req, res) => {
  try {
    const librarians = await Librarian.find(
      { user_id: req.user._id, is_deleted: false },
      {
        name: 1, grade: 1, adm_no: 1, date_joined: 1, house: 1,
        is_deleted: 1, created_at: 1
      }
    ).lean();
    res.json(librarians);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create librarian – set user_id automatically
router.post("/", async (req, res) => {
  try {
    const librarianData = { ...req.body, user_id: req.user._id };
    const librarian = new Librarian(librarianData);
    await librarian.save();
    res.status(201).json(librarian);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update librarian
router.put("/:id", async (req, res) => {
  try {
    const librarian = await Librarian.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      req.body,
      { new: true }
    );
    res.json(librarian);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE (soft delete)
router.delete("/:id", async (req, res) => {
  try {
    await Librarian.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      { is_deleted: true }
    );
    res.json({ message: "Archived" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;