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

app.get("/ping", (req, res) => res.send("ok"));

// Serve frontend for any other route (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
