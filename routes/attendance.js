// ============================================
// File: routes/attendance.js
// ============================================
const express = require("express");
const router = express.Router();
const Attendance = require("../models/Attendance");

// GET all attendance records
router.get("/", async (req, res) => {
  try {
    const records = await Attendance.find({});
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create attendance record
router.post("/", async (req, res) => {
  try {
    const record = new Attendance(req.body);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update attendance record
router.put("/:id", async (req, res) => {
  try {
    const record = await Attendance.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE attendance records by instance id (for clearing history)
router.delete("/by-instance/:instanceId", async (req, res) => {
  try {
    await Attendance.deleteMany({ duty_instance_id: req.params.instanceId });
    res.json({ message: "Attendance records deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
