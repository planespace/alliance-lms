// ============================================
// File: routes/attendance.js
// ============================================
const express = require("express");
const router = express.Router();
const Attendance = require("../models/Attendance");

// GET all attendance records for logged‑in user
router.get("/", async (req, res) => {
  try {
    const records = await Attendance.find(
      { user_id: req.user._id },
      {
        duty_instance_id: 1,
        librarian_id: 1,
        attended: 1,
        confirmed_by: 1,
        confirmed_at: 1,
        forgiven: 1,
        punishment_issued: 1,
      }
    ).lean();
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create attendance record – set user_id
router.post("/", async (req, res) => {
  try {
    const recordData = { ...req.body, user_id: req.user._id };
    const record = new Attendance(recordData);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update attendance record
router.put("/:id", async (req, res) => {
  try {
    const record = await Attendance.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      req.body,
      { new: true }
    );
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE attendance records by instance id (for clearing history)
router.delete("/by-instance/:instanceId", async (req, res) => {
  try {
    await Attendance.deleteMany({
      duty_instance_id: req.params.instanceId,
      user_id: req.user._id
    });
    res.json({ message: "Attendance records deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;