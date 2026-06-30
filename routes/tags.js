// ============================================
// File: routes/tags.js
// ============================================
const express = require("express");
const router = express.Router();
const Tag = require("../models/Tag");

// GET all tags
router.get("/", async (req, res) => {
  try {
    const tags = await Tag.find(
      { is_active: true },
      {
        name: 1,
        description: 1,
        type: 1,
        librarian_id: 1,
        start_date: 1,
        end_date: 1,
        is_active: 1,
        duty_id: 1,
      }
    ).lean();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create tag
router.post("/", async (req, res) => {
  try {
    const tag = new Tag(req.body);
    await tag.save();
    res.status(201).json(tag);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update tag
router.put("/:id", async (req, res) => {
  try {
    const tag = await Tag.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(tag);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE tag (soft delete by setting is_active to false)
router.delete("/:id", async (req, res) => {
  try {
    await Tag.findByIdAndUpdate(req.params.id, {
      is_active: false,
      removed_at: new Date(),
    });
    res.json({ message: "Tag removed" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Tag history – separate endpoint (optional)
const TagHistory = require("../models/TagHistory");
router.post("/history", async (req, res) => {
  try {
    const history = new TagHistory(req.body);
    await history.save();
    res.status(201).json(history);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
