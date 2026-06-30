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
    const duties = await Duty.find(
      {},
      {
        name: 1,
        start_time: 1,
        end_time: 1,
        days: 1,
        recurrence_type: 1,
        specific_dates: 1,
        recurrence_interval: 1,
        end_date: 1,
        is_punishment: 1,
        sector_id: 1,
        created_at: 1,
      }
    ).lean();
    res.json(duties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all duty instances
router.get("/instances", async (req, res) => {
  try {
    const instances = await DutyInstance.find(
      {},
      { duty_id: 1, date: 1, is_active: 1 }
    ).lean();
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
