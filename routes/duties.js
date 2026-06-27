// ============================================
// File: routes/duties.js
// ============================================
const express = require("express");
const router = express.Router();
const Duty = require("../models/Duty");
const DutyInstance = require("../models/DutyInstance");

// GET all duties
router.get("/", async (req, res) => {
  try {
    const duties = await Duty.find({});
    res.json(duties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all duty instances
router.get("/instances", async (req, res) => {
  try {
    const instances = await DutyInstance.find({});
    res.json(instances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create duty
router.post("/", async (req, res) => {
  try {
    const duty = new Duty(req.body);
    await duty.save();
    res.status(201).json(duty);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update duty
router.put("/:id", async (req, res) => {
  try {
    const duty = await Duty.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(duty);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE duty
router.delete("/:id", async (req, res) => {
  try {
    await Duty.findByIdAndDelete(req.params.id);
    res.json({ message: "Duty deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Duty Instances ----
router.post("/instances", async (req, res) => {
  try {
    const instance = new DutyInstance(req.body);
    await instance.save();
    res.status(201).json(instance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/instances/:id", async (req, res) => {
  try {
    await DutyInstance.findByIdAndDelete(req.params.id);
    res.json({ message: "Instance deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
