// ============================================
// File: routes/sectors.js
// ============================================
const express = require("express");
const router = express.Router();
const Sector = require("../models/Sector");

// GET all sectors
router.get("/", async (req, res) => {
  try {
    const sectors = await Sector.find(
      {},
      {
        name: 1,
        parent_id: 1,
        is_leaf: 1,
        min_people: 1,
        description: 1,
        leader_ids: 1,
        duty_settings_list: 1,
      }
    ).lean();
    res.json(sectors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create sector
router.post("/", async (req, res) => {
  try {
    const sector = new Sector(req.body);
    await sector.save();
    res.status(201).json(sector);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update sector
router.put("/:id", async (req, res) => {
  try {
    const sector = await Sector.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(sector);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE sector
router.delete("/:id", async (req, res) => {
  try {
    await Sector.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Sector Assignments (stored as embedded documents in a separate collection or array) ----
// For simplicity we'll use a separate model
const Assignment = require("../models/SectorAssignment");

router.get("/assignments", async (req, res) => {
  try {
    const assignments = await Assignment.find(
      {},
      { sector_id: 1, librarian_id: 1, assigned_at: 1 }
    ).lean();
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/assignments", async (req, res) => {
  try {
    const assignment = new Assignment(req.body);
    await assignment.save();
    res.status(201).json(assignment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/assignments/by-sector/:sectorId", async (req, res) => {
  try {
    await Assignment.deleteMany({ sector_id: req.params.sectorId });
    res.json({ message: "Assignments removed" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// route for removing a specific assignment by sector_id and librarian_id
router.delete("/assignments/:sectorId/:libId", async (req, res) => {
  try {
    await Assignment.deleteOne({
      sector_id: req.params.sectorId,
      librarian_id: req.params.libId,
    });
    res.json({ message: "Assignment removed" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// route for clearing all assignments (used in auto-assign type "all")
router.delete("/assignments/all", async (req, res) => {
  try {
    await Assignment.deleteMany({});
    res.json({ message: "All assignments cleared" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
