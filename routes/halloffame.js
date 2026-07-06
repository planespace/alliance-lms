// ============================================
// File: routes/halloffame.js
// ============================================
const express = require("express");
const router = express.Router();
const { Captain, Committee } = require("../models/HallOfFame");

// CAPTAINS
router.get("/captains", async (req, res) => {
  try {
    const captains = await Captain.find(
      { user_id: req.user._id },
      { name: 1, adm_no: 1, year: 1, house: 1, photo_url: 1 }
    ).lean();
    res.json(captains);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/captains", async (req, res) => {
  try {
    const captainData = { ...req.body, user_id: req.user._id };
    const captain = new Captain(captainData);
    await captain.save();
    res.status(201).json(captain);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/captains/:id", async (req, res) => {
  try {
    const captain = await Captain.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      req.body,
      { new: true }
    );
    res.json(captain);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/captains/:id", async (req, res) => {
  try {
    await Captain.findOneAndDelete({ _id: req.params.id, user_id: req.user._id });
    res.json({ message: "Captain deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// COMMITTEES
router.get("/committees", async (req, res) => {
  try {
    const committees = await Committee.find(
      { user_id: req.user._id },
      { year: 1, members: 1 }
    ).lean();
    res.json(committees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/committees", async (req, res) => {
  try {
    const committeeData = { ...req.body, user_id: req.user._id };
    const committee = new Committee(committeeData);
    await committee.save();
    res.status(201).json(committee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/committees/:id", async (req, res) => {
  try {
    const committee = await Committee.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      req.body,
      { new: true }
    );
    res.json(committee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/committees/:id", async (req, res) => {
  try {
    await Committee.findOneAndDelete({ _id: req.params.id, user_id: req.user._id });
    res.json({ message: "Committee deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;