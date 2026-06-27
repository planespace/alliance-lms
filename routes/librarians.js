// ============================================
// File: routes/librarians.js
// ============================================
const express = require("express");
const router = express.Router();
const Librarian = require("../models/Librarian");

// GET all active librarians
router.get("/", async (req, res) => {
  try {
    const librarians = await Librarian.find({ is_deleted: false });
    res.json(librarians);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create librarian
router.post("/", async (req, res) => {
  try {
    const librarian = new Librarian(req.body);
    await librarian.save();
    res.status(201).json(librarian);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update librarian
router.put("/:id", async (req, res) => {
  try {
    const librarian = await Librarian.findByIdAndUpdate(
      req.params.id,
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
    await Librarian.findByIdAndUpdate(req.params.id, { is_deleted: true });
    res.json({ message: "Archived" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
