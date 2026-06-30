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
  .then(() => console.log("MongoDB connected"))
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
app.get("/api/all", protect, async (req, res) => {
  try {
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
      Librarian.find({}).lean(),
      Sector.find({}).lean(),
      Duty.find({}).lean(),
      DutyInstance.find({}).lean(),
      Attendance.find({}).lean(),
      Tag.find({ is_active: true }).lean(),
      Notification.find({}).lean(),
      Captain.find({}).lean(),
      Committee.find({}).lean(),
      SectorAssignment.find({}).lean(),
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
