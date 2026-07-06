// ============================================
// File: server.js   (root of project)
// ============================================
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

// Import the protect middleware from auth routes
const { protect } = require("./routes/auth");

// Import route handlers
const authRouter = require("./routes/auth");
const librariansRouter = require("./routes/librarians");
const sectorsRouter = require("./routes/sectors");
const dutiesRouter = require("./routes/duties");
const attendanceRouter = require("./routes/attendance");
const tagsRouter = require("./routes/tags");
const notificationsRouter = require("./routes/notifications");
const halloffameRouter = require("./routes/halloffame");
// Import models for the combined endpoint
const Librarian = require("./models/Librarian");
const Sector = require("./models/Sector");
const Duty = require("./models/Duty");
const DutyInstance = require("./models/DutyInstance");
const Attendance = require("./models/Attendance");
const Tag = require("./models/Tag");
const Notification = require("./models/Notification");
const { Captain, Committee } = require("./models/HallOfFame");
const SectorAssignment = require("./models/SectorAssignment");
const app = express();
const compression = require("compression");

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json());

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, "public")));

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");
    // Keep the connection and indexes warm – a lightweight ping every 4 minutes
    setInterval(async () => {
      try {
        await mongoose.connection.db.admin().ping();
      } catch (e) {
        // silently ignore – the next request will re‑establish
      }
    }, 4 * 60 * 1000); // every 4 minutes
  })
  .catch((err) => console.error(err));

// Protect all /api routes except /api/auth
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth")) return next();
  protect(req, res, next);
});

// API routes
app.use("/api/auth", authRouter);
app.use("/api/librarians", librariansRouter);
app.use("/api/sectors", sectorsRouter);
app.use("/api/duties", dutiesRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/halloffame", halloffameRouter);
// Combined endpoint – returns all data in a single request
// Combined endpoint – returns only necessary fields for speed
// Combined endpoint – returns only necessary fields for speed, scoped to current user
app.get("/api/all", protect, async (req, res) => {
  try {
    res.set("Cache-Control", "private, max-age=120");
    const userId = req.user._id;
    const [
      librarians,
      sectors,
      duties,
      dutyInstances,
      attendance,
      tags,
      notifications,
      captains,
      committees,
      assignments,
    ] = await Promise.all([
      Librarian.find({ user_id: userId }, {
        name: 1, grade: 1, adm_no: 1, date_joined: 1, house: 1,
        is_deleted: 1, created_at: 1
      }).lean(),
      Sector.find({ user_id: userId }, {
        name: 1, parent_id: 1, is_leaf: 1, min_people: 1,
        description: 1, leader_ids: 1, duty_settings_list: 1
      }).lean(),
      Duty.find({ user_id: userId }, {
        name: 1, start_time: 1, end_time: 1, days: 1,
        recurrence_type: 1, specific_dates: 1, recurrence_interval: 1,
        end_date: 1, is_punishment: 1, sector_id: 1, created_at: 1
      }).lean(),
      DutyInstance.find({ user_id: userId }, { duty_id: 1, date: 1, is_active: 1 }).lean(),
      Attendance.find({ user_id: userId }, {
        duty_instance_id: 1, librarian_id: 1, attended: 1,
        confirmed_by: 1, confirmed_at: 1, forgiven: 1, punishment_issued: 1
      }).lean(),
      Tag.find({ user_id: userId, is_active: true }, {
        name: 1, description: 1, type: 1, librarian_id: 1,
        start_date: 1, end_date: 1, is_active: 1, duty_id: 1
      }).lean(),
      Notification.find({ user_id: userId }, {
        message: 1, type: 1, librarian_id: 1, duty_instance_id: 1,
        tag_id: 1, date: 1, is_read: 1, is_forgotten: 1, is_dismissed: 1,
        forgotten_at: 1, dismiss_until: 1
      }).lean(),
      Captain.find({ user_id: userId }, { name: 1, adm_no: 1, year: 1, house: 1, photo_url: 1 }).lean(),
      Committee.find({ user_id: userId }, { year: 1, members: 1 }).lean(),
      SectorAssignment.find({ user_id: userId }, { sector_id: 1, librarian_id: 1, assigned_at: 1 }).lean(),
    ]);
    res.json({
      librarians,
      sectors,
      duties,
      dutyInstances,
      attendance,
      tags,
      notifications,
      captains,
      committees,
      assignments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/ping", (req, res) => res.send("ok"));

// Serve frontend for any other route (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
