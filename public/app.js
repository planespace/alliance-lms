// ============================================
// ALLIANCE LMS – public/app.js (ONLINE EDITION)
// ============================================

const API_BASE = "/api"; // assumes frontend & backend on same domain
let selectedCommitteeId = null;
// global cache – replaces localStorage
let appData = {
  librarians: [],
  sectors: [],
  sector_assignments: [],
  duties: [],
  duty_instances: [],
  attendance: [],
  tags: [],
  tag_history: [],
  notifications: [],
  hall_of_fame_captains: [],
  hall_of_fame_committees: [],
  sector_assignment_history: [],
  current_user: "",
  settings: {
    tagExpiryNotificationDays: 1,
    forgottenNotificationRetentionDays: 15,
    punishmentAutoDismissDays: 2,
    cumulativeMissedDutiesThreshold: 3,
  },
};
function getCacheKey() {
  const user = currentUser || JSON.parse(localStorage.getItem("currentUser") || "null");
  return user ? `appDataCache_${user.id}` : "appDataCache_guest";
}

let isSaving = false;
let generatingMissedNotifications = false;
let pendingAttendanceSaves = new Map();
let attendanceBatchTimer = null;
let removingInProgress = false;
let attendanceMarkingInProgress = false;
let currentManagementLibId = null;
let simulatedDate = null;
let currentPage = "dashboard";
let selectedLibrarianId = null;
let selectedTagId = null;
let saveQuickLeafInProgress = false;
let searchTimer;
let confirmCallback = null;
let showDismissed = false;
let currentViewDate = new Date().toISOString().split("T")[0];
let isCalendarView = false;
let specificDatesList = [];
let currentSectorPath = [];
let selectedLeafId = null;
let currentHallTab = "captains";
let editingLibrarianId = null;
let editingDutyId = null;
let viewingDutyId = null;
let editSpecificDatesList = [];
let sectorSpecificDatesList = [];
let modalZIndex = 1000;
let sectorModalOriginalBody = "";
let sectorModalOriginalFooter = "";
// Authentication
let authToken = localStorage.getItem("authToken") || null;
let currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
let devMode = false;
let attendanceSortState = {};
let lastAttendanceAction = {};   
// ============================================
// ONLINE DATA LAYER (replaces localStorage)
// ============================================

// ============================================
// GLOBAL LOADING BAR
// ============================================
let loadingTimer = null;
function showLoading() {
  const bar = document.getElementById("loadingBar");
  if (!bar) return;
  bar.classList.add("active"); // makes it visible (opacity:1)
}
function hideLoading() {
  const bar = document.getElementById("loadingBar");
  if (!bar) return;
  bar.classList.remove("active"); // fades out
}

function loadData() {
  const cached = localStorage.getItem(getCacheKey());
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      appData.librarians = parsed.librarians || [];
      appData.sectors = parsed.sectors || [];
      appData.duties = parsed.duties || [];
      appData.duty_instances = parsed.duty_instances || [];
      appData.attendance = parsed.attendance || [];
      appData.tags = parsed.tags || [];
      appData.tag_history = parsed.tag_history || [];   // ★
      appData.notifications = parsed.notifications || [];
      appData.hall_of_fame_captains = parsed.hall_of_fame_captains || [];
      appData.hall_of_fame_committees = parsed.hall_of_fame_committees || [];
      appData.sector_assignments = parsed.sector_assignments || [];

      appData.librarians.forEach(l => recalcAttendancePct(l.id));
    } catch (e) { /* ignore corrupt cache */ }
  }
}

async function startBackgroundSync() {
  const headers = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  try {
    const data = await fetch(`${API_BASE}/all`, { headers }).then((r) => r.json());

    const fresh = {
      librarians: (data.librarians || []).map(l => ({ ...l, id: l._id })),
      sectors: (data.sectors || []).map(s => ({ ...s, id: s._id })),
      duties: (data.duties || []).map(d => ({ ...d, id: d._id })),
      duty_instances: (data.dutyInstances || []).map(di => ({ ...di, id: di._id })),
      attendance: (data.attendance || []).map(a => ({ ...a, id: a._id })),
      tags: (data.tags || []).map(t => ({ ...t, id: t._id })),
      notifications: (data.notifications || []).map(n => ({ ...n, id: n._id })),
      hall_of_fame_captains: (data.captains || []).map(c => ({ ...c, id: c._id })),
      hall_of_fame_committees: (data.committees || []).map(c => ({ ...c, id: c._id })),
      sector_assignments: (data.assignments || []).map(a => ({ ...a, id: a._id })),
    };

    const { notifications: _, ...restOfFresh } = fresh;

    if (!isSaving) {
      Object.assign(appData, restOfFresh);
      localStorage.setItem(getCacheKey(), JSON.stringify(fresh));
      appData.librarians.forEach(l => recalcAttendancePct(l.id));

      // ★ Fetch tag history
      try {
        const historyRes = await fetch(`${API_BASE}/tags/history`, { headers });
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          appData.tag_history = historyData.map(h => ({ ...h, id: h._id }));
        }
      } catch (e) {
        console.error("Failed to load tag history", e);
      }
    }

    syncLocalNotifications();
    updateDutyBadge();
    updateNotificationBadge();

    if (currentPage !== "notifications") {
      renderCurrentPage();
    }

    updateDutyBadge();
    updateNotificationBadge();
  } catch (err) {
    console.error("Background sync failed", err);
  } finally {
    hideLoading();
  }
}

async function bulkAddLibrarians() {
  const rows = document.querySelectorAll("#bulkBody tr");
  let added = 0,
    skipped = 0,
    duplicates = [];
  const tempLibs = []; // track temporary objects for rollback

  // ---- 1. Create temporary librarians for instant UI ----
  for (const row of rows) {
    const name = row.querySelector(".bulk-name").value.trim();
    const grade = row.querySelector(".bulk-grade").value.trim();
    const adm = row.querySelector(".bulk-adm").value.trim();
    const joined = row.querySelector(".bulk-joined").value;
    const house = row.querySelector(".bulk-house")?.value.trim() || "";
    if (!name || !grade || !adm || !joined) continue;
    if (appData.librarians.some((l) => l.adm_no === adm && !l.is_deleted)) {
      skipped++;
      duplicates.push(adm);
      continue;
    }

    const tempLib = {
      id: "temp_" + Date.now() + Math.random(),
      name,
      grade,
      adm_no: adm,
      date_joined: joined,
      house,
      is_deleted: false,
      created_at: new Date().toISOString(),
      _temp: true,
    };
    appData.librarians.push(tempLib);
    tempLibs.push({ tempLib, name, grade, adm, joined, house });
  }

  closeModal("bulkModal");
  renderCurrentPage();
  toast(`Adding ${tempLibs.length} librarians…`);

  // ---- 2. Save to server in background ----
  const promises = [];
  for (const item of tempLibs) {
    const newLib = {
      name: item.name,
      grade: item.grade,
      adm_no: item.adm,
      date_joined: item.joined,
      house: item.house,
      is_deleted: false,
      created_at: new Date().toISOString(),
    };
    promises.push(
      saveEntity("librarians", newLib)
        .then((saved) => ({ success: true, tempId: item.tempLib.id, saved }))
        .catch((err) => ({
          success: false,
          tempId: item.tempLib.id,
          error: err,
        }))
    );
  }

  const results = await Promise.all(promises);
  let finalAdded = 0;
  results.forEach((res) => {
    if (res.success) {
      // Replace temp with real
      const idx = appData.librarians.findIndex((l) => l.id === res.tempId);
      if (idx !== -1) {
        appData.librarians[idx] = { ...res.saved, id: res.saved._id };
      }
      finalAdded++;
    } else {
      // Remove failed temp
      appData.librarians = appData.librarians.filter(
        (l) => l.id !== res.tempId
      );
      console.error("Failed to add librarian", res.error);
    }
  });

  renderCurrentPage();
  toast(
    `Added ${finalAdded}${
      skipped ? `, skipped ${skipped} (${duplicates.join(", ")})` : ""
    }`
  );
}

async function saveEntity(type, data, id = null, skipLoading = false) {
  isSaving = true;
  if (!skipLoading) showLoading();
  try {
    const url = id ? `${API_BASE}/${type}/${id}` : `${API_BASE}/${type}`;
    const method = id ? "PUT" : "POST";
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    const saved = await res.json();
    saved.id = saved._id;
    return saved;
  } finally {
    if (!skipLoading) hideLoading();
    isSaving = false;
  }
}

async function deleteEntity(type, id, skipLoading = false) {
  if (!skipLoading) showLoading();
  try {
    const headers = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    await fetch(`${API_BASE}/${type}/${id}`, { method: "DELETE", headers });
  } finally {
    if (!skipLoading) hideLoading();
  }
}

function saveData() {
  localStorage.setItem("settings", JSON.stringify(appData.settings));
  updateNotificationBadge();

  const cacheCopy = {
    librarians: appData.librarians,
    sectors: appData.sectors,
    duties: appData.duties,
    duty_instances: appData.duty_instances,
    attendance: appData.attendance,
    tags: appData.tags,
    tag_history: appData.tag_history,   // ★
    notifications: appData.notifications,
    hall_of_fame_captains: appData.hall_of_fame_captains,
    hall_of_fame_committees: appData.hall_of_fame_committees,
    sector_assignments: appData.sector_assignments,
  };
  localStorage.setItem(getCacheKey(), JSON.stringify(cacheCopy));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function getToday() {
  if (simulatedDate && simulatedDate > new Date().toISOString().split("T")[0])
    return simulatedDate;
  return new Date().toISOString().split("T")[0];
}

function getLib(id) {
  return appData.librarians.find((l) => l.id === id);
}
function recalcAttendancePct(libId) {
  const lib = getLib(libId);
  if (!lib) return;
  const recs = appData.attendance.filter(a => a.librarian_id === libId);
  if (!recs.length) {
    lib.attendancePct = null;
  } else {
    const attended = recs.filter(r => r.attended || r.forgiven).length;
    lib.attendancePct = Math.round((attended / recs.length) * 100);
  }
}

function getSector(id) {
  return appData.sectors.find((s) => s.id === id);
}
function getLibSectors(libId) {
  return appData.sector_assignments
    .filter((a) => a.librarian_id === libId)
    .map((a) => getSector(a.sector_id))
    .filter(Boolean);
}
function getSectorPeople(secId) {
  return appData.sector_assignments
    .filter((a) => a.sector_id === secId)
    .map((a) => getLib(a.librarian_id))
    .filter(Boolean);
}

async function cleanExpiredTags() {
  const today = getToday();
  const expired = [];
  appData.tags = appData.tags.filter((t) => {
    if (t.end_date && t.end_date < today) {
      expired.push(t);
      return false;
    }
    return true;
  });
  if (expired.length === 0) return;

  for (const t of expired) {
    await deleteEntity("tags", t.id, true);
    const savedHistory = await saveEntity(
      "tags/history",
      {
        tag_id: t.id,
        librarian_id: t.librarian_id,
        tag_name: t.name,
        description: t.description,
        type: t.type,
        start_date: t.start_date,
        end_date: t.end_date,
        removed_at: new Date().toISOString(),
        removal_reason: "auto_expired",
      },
      null,
      true
    );
    // Push the server-saved object with real _id
    appData.tag_history.push({ ...savedHistory, id: savedHistory._id });
  }

  saveData();
}

function getLibTags(libId) {
  return appData.tags.filter(
    (t) =>
      t.librarian_id === libId &&
      t.is_active &&
      (!t.end_date || t.end_date >= getToday())
  );
}
function getLibAttendance(libId) {
  return appData.attendance.filter((a) => a.librarian_id === libId);
}
function getAttendancePct(libId) {
  const lib = getLib(libId);
  if (!lib || lib.attendancePct == null) return "N/A";
  return lib.attendancePct;
}

// ============================================
// DUTY INSTANCE GENERATION
// ============================================

// ============================================
// FORMATTING
// ============================================
function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function formatDateFull(date) {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function formatTime(time) {
  if (!time) return "—";
  const [h, m] = time.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}
function getDayName(day) {
  const days = {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  };
  return days[day.toLowerCase()] || day;
}
function getFullDayName(day) {
  const days = {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday",
  };
  return days[day.toLowerCase()] || day;
}
function getInitials(name) {
  return name
    ? name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "??";
}
function getDateGroupLabel(date) {
  const today = getToday();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split("T")[0];
  if (date === today) return "Today";
  if (date === yDate) return "Yesterday";
  return formatDateFull(date);
}
function tagColor(type) {
  const m = {
    punishment: "tag-badge punishment",
    praise: "tag-badge praise",
    warning: "tag-badge warning",
    rep: "tag-badge rep",
    normal: "tag-badge normal",
  };
  return m[type] || m.normal;
}

// ============================================
// AUTH & NAVIGATION
// ============================================
async function handleLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const errorDiv = document.getElementById("loginError");
  errorDiv.style.display = "none";
  if (!email || !password) {
    errorDiv.textContent = "Email and password are required.";
    errorDiv.style.display = "block";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("appContainer").classList.add("active");
    document.getElementById("currentUser").textContent = currentUser.username;
    document.getElementById("userAvatar").textContent = currentUser.username
      .charAt(0)
      .toUpperCase();
    appData.current_user = currentUser.username;
    saveData();
    initApp();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = "block";
  }
}
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    document.getElementById("loginPage").style.display !== "none"
  )
    handleLogin();
});
function handleLogout() {
  if (confirm("Are you sure you want to logout?")) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("currentUser");
    authToken = null;
    currentUser = null;
    location.reload();
  }
}

// --- REGISTER ---
async function handleRegister() {
  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirm = document.getElementById("regConfirmPassword").value;
  const errorDiv = document.getElementById("registerError");
  errorDiv.style.display = "none";
  if (password !== confirm) {
    errorDiv.textContent = "Passwords do not match.";
    errorDiv.style.display = "block";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("appContainer").classList.add("active");
    document.getElementById("currentUser").textContent = currentUser.username;
    document.getElementById("userAvatar").textContent = currentUser.username
      .charAt(0)
      .toUpperCase();
    appData.current_user = currentUser.username;
    initApp();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = "block";
  }
}

// --- FORGOT PASSWORD ---
async function handleForgotPassword() {
  const email = document.getElementById("forgotEmail").value.trim();
  const errorDiv = document.getElementById("forgotError");
  errorDiv.style.display = "none";
  if (!email) {
    errorDiv.textContent = "Email is required.";
    errorDiv.style.display = "block";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById("loginSuccess").textContent = data.message;
    document.getElementById("loginSuccess").style.display = "block";
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = "block";
  }
}

// --- RESET PASSWORD (called from /reset-password.html?token=...) ---
async function handleResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const newPassword = document.getElementById("newPassword").value;
  const confirm = document.getElementById("confirmNewPassword").value;
  const errorDiv = document.getElementById("resetError");
  const successDiv = document.getElementById("resetSuccess");
  errorDiv.style.display = "none";
  if (!token) {
    errorDiv.textContent = "Invalid reset link.";
    errorDiv.style.display = "block";
    return;
  }
  if (newPassword !== confirm) {
    errorDiv.textContent = "Passwords do not match.";
    errorDiv.style.display = "block";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    successDiv.textContent = data.message + " Redirecting to login...";
    successDiv.style.display = "block";
    // Redirect to login page after 2 seconds
    setTimeout(() => {
      window.location.href = window.location.pathname; // reload without query string
    }, 2000);
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = "block";
  }
}

// --- CHANGE USERNAME (for logged-in user) ---
async function changeUsername() {
  const newUsername = document
    .getElementById("newProfileUsername")
    .value.trim();
  const currentPassword = document.getElementById(
    "usernameCurrentPassword"
  ).value;
  const msgDiv = document.getElementById("usernameMsg");
  if (!newUsername) {
    msgDiv.innerHTML =
      '<span style="color:red;">Please enter a new username.</span>';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/change-username`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ currentPassword, newUsername }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Update currentUser in memory and localStorage
    currentUser.username = newUsername;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    document.getElementById("profileUsername").textContent = newUsername;
    document.getElementById("currentUser").textContent = newUsername;
    document.getElementById("userAvatar").textContent = newUsername
      .charAt(0)
      .toUpperCase();
    appData.current_user = newUsername;
    // Clear inputs
    document.getElementById("newProfileUsername").value = "";
    document.getElementById("usernameCurrentPassword").value = "";
    msgDiv.innerHTML = '<span style="color:green;">Username updated!</span>';
  } catch (err) {
    msgDiv.innerHTML = `<span style="color:red;">${err.message}</span>`;
  }
}

// --- CHANGE EMAIL (modified – clears inputs on success) ---
async function changeEmail() {
  const newEmail = document.getElementById("newProfileEmail").value.trim();
  const currentPassword = document.getElementById("emailCurrentPassword").value;
  const msgDiv = document.getElementById("emailMsg");
  if (!newEmail) {
    msgDiv.innerHTML =
      '<span style="color:red;">Please enter a new email.</span>';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/change-email`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ currentPassword, newEmail }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Update currentUser in memory and localStorage
    currentUser.email = newEmail;
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    document.getElementById("profileEmail").textContent = newEmail;
    // Clear inputs
    document.getElementById("newProfileEmail").value = "";
    document.getElementById("emailCurrentPassword").value = "";
    msgDiv.innerHTML = '<span style="color:green;">Email updated!</span>';
  } catch (err) {
    msgDiv.innerHTML = `<span style="color:red;">${err.message}</span>`;
  }
}

// --- CHANGE PASSWORD (modified – clears inputs on success) ---
async function changePassword() {
  const current = document.getElementById("currentPassword").value;
  const newPass = document.getElementById("newProfilePassword").value;
  const confirm = document.getElementById("confirmNewProfilePassword").value;
  const msgDiv = document.getElementById("profileMsg");
  if (newPass !== confirm) {
    msgDiv.innerHTML =
      '<span style="color:red;">New passwords do not match.</span>';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ currentPassword: current, newPassword: newPass }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Clear inputs
    document.getElementById("currentPassword").value = "";
    document.getElementById("newProfilePassword").value = "";
    document.getElementById("confirmNewProfilePassword").value = "";
    msgDiv.innerHTML = '<span style="color:green;">Password updated!</span>';
  } catch (err) {
    msgDiv.innerHTML = `<span style="color:red;">${err.message}</span>`;
  }
}

// --- RENDER PROFILE PAGE ---
function renderProfile() {
  if (!currentUser) return;
  document.getElementById("profileUsername").textContent = currentUser.username;
  document.getElementById("profileEmail").textContent = currentUser.email;
}

function navigateTo(page) {
  currentPage = page;
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add("active");
  document
    .querySelectorAll(".sidebar nav a")
    .forEach((a) => a.classList.remove("active"));
  const link = document.querySelector(`.sidebar nav a[data-page="${page}"]`);
  if (link) link.classList.add("active");
  const titles = {
    dashboard: "Dashboard",
    sectors: "Sectors",
    duties: "Duties",
    attendance: "Attendance",
    notifications: "Notifications",
    halloffame: "Hall of Fame",
    committee: "Committee",
    archive: "Archive",
    profile: "Profile",
  };
  document.getElementById("pageTitle").textContent = titles[page] || page;
  if (page === "sectors") currentSectorPath = [];
  switch (page) {
    case "dashboard":
      renderDashboard();
      break;
    case "sectors":
      renderSectors();
      break;
    case "duties":
      renderDuties();
      break;
    case "attendance":
      renderAttendance();
      break;
    case "notifications":
      renderNotifications();
      break;
    case "halloffame":
      renderHallOfFame();
      break;
    case "committee":
      renderCommittee();
      break;
    case "archive":
      renderArchive();
      break;
    case "profile":
      renderProfile();
      break;
  }
  document.getElementById("sidebar").classList.remove("open");
}
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ============================================
// MODALS & STACKING
// ============================================
async function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modalZIndex += 2;
  modal.style.zIndex = modalZIndex;
  modal.classList.add("active");

  if (id === "dutyModal") {
    specificDatesList = [];
    document.getElementById("specificDatesList").innerHTML = "";
    document.getElementById("specificDatesContainer").style.display = "none";
    document.getElementById("recurrenceExtra").style.display = "none";
  }

  if (id === "sectorModal") {
    const leafCheck = document.getElementById("sectorIsLeaf");
    leafCheck.checked = false;
    leafCheck.disabled = true;
    leafCheck.closest(".form-group.checkbox-group").style.display = "none";
    document.getElementById("sectorDutySettings").style.display = "none";
    document.getElementById("sectorName").value = "";
    document.getElementById("sectorDesc").value = "";

    const header = document.querySelector("#sectorModal .modal-header h3");
    if (header) header.textContent = "📁 Add Category";
    sectorSpecificDatesList = [];
    document.getElementById("sectorSpecificDatesList").innerHTML = "";
    document.getElementById("sectorRecurrenceExtra").style.display = "none";
    document.getElementById("sectorSpecificDatesContainer").style.display =
      "none";
    document.getElementById("sectorDutyName").value = "";
    document.getElementById("sectorDutyStart").value = "";
    document.getElementById("sectorDutyEnd").value = "";
    document.getElementById("sectorDutyEndDate").value = "";
    document.getElementById("sectorDutyIsPunishment").value = "false";
    document
      .querySelectorAll(".sector-duty-day")
      .forEach((cb) => (cb.checked = false));
    toggleSectorIsLeaf();
  }

  if (id === "attendanceModal") {
    document.getElementById("attendanceModalDate").value = getToday();
    await renderAttendanceModal();
  }
  if (id === "librarianModal")
    document.getElementById("libJoined").value = getToday();
  if (id === "bulkModal") {
    document
      .querySelectorAll("#bulkBody .bulk-joined")
      .forEach((inp) => (inp.value = getToday()));
  }

  // ★ Auto‑assign modal – make sure the multi‑select list is ready
  if (id === "autoAssignModal") {
    if (document.getElementById("autoAssignMulti").checked) {
      populateMultiSelect();
    }
  }
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("active");

  // Refresh after closing attendance‑history modal
  if (id === "attendanceHistoryModal") {
    renderCurrentPage();
  }

  // Refresh after closing sector‑management modals (Manage Sectors AND Add People)
  if (id === "sectorManagementModal" || id === "addPeopleModal") {
    renderCurrentPage();
  }

  if (id === "sectorModal") {
    const body = document.querySelector("#sectorModal .modal-body");
    const footer = document.querySelector("#sectorModal .modal-footer");
    if (body && sectorModalOriginalBody)
      body.innerHTML = sectorModalOriginalBody;
    if (footer && sectorModalOriginalFooter)
      footer.innerHTML = sectorModalOriginalFooter;
  }

  // ★ Clear management ID
  if (id === "sectorManagementModal") {
    currentManagementLibId = null;
  }
}
document.querySelectorAll(".modal-overlay").forEach((el) => {
  el.addEventListener("click", function (e) {
    if (e.target === this) {
      const modal = this.querySelector(".modal");
      if (modal && modal.parentElement === this) {
        closeModal(this.id);
      } else {
        this.classList.remove("active");
      }
    }
  });
});

// ============================================
// CONFIRMATION (using Swal)
// ============================================
function showConfirm(title, content, callback) {
  Swal.fire({
    title: title,
    html: content,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Yes",
    cancelButtonText: "Cancel",
    reverseButtons: true,
  }).then((result) => {
    if (result.isConfirmed && callback) callback();
  });
}
// replace the old confirmAction – no longer needed

// ============================================
// GLOBAL DATE NAVIGATOR
// ============================================
async function setViewDate(date) {
  const realToday = new Date().toISOString().split("T")[0];
  simulatedDate = date > realToday ? date : null;
  currentViewDate = date;
  document.getElementById("viewDate").value = date;
  document.getElementById("dateDisplay").textContent = formatDate(date);
  await generateDutyInstancesForDate(date);
  renderCurrentPage();
  if (document.getElementById("attendanceDate")) {
    document.getElementById("attendanceDate").max = getToday();
  }
}
async function changeDate(delta) {
  const d = new Date(currentViewDate);
  d.setDate(d.getDate() + delta);
  await setViewDate(d.toISOString().split("T")[0]);
}
async function onDateChange() {
  await setViewDate(document.getElementById("viewDate").value);
}
async function setToday() {
  simulatedDate = null;
  await setViewDate(new Date().toISOString().split("T")[0]);
}

// ============================================
// ACTION POPUP & MANAGE SECTORS
// ============================================
function viewSectorManagement(libId) {
  const lib = getLib(libId);
  if (!lib) return;
  const sectors = getLibSectors(libId);
  const allLeaf = appData.sectors.filter((s) => s.is_leaf);
  const assignedIds = sectors.map((s) => s.id);

  const sectorRows = sectors
    .map(
      (s) => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td style="font-size:13px;color:var(--text-secondary);">${getSectorPath(
        s.id
      )}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeFromSector('${
        s.id
      }','${libId}'); viewSectorManagement('${libId}');">✕ Remove</button></td>
    </tr>`
    )
    .join("");

  const availableSectors = allLeaf.filter((s) => !assignedIds.includes(s.id));

  const html = `
    <div style="margin-bottom:20px;">
      <h4 style="margin-bottom:12px;">📂 Current Sectors for ${lib.name}</h4>
      ${
        sectors.length === 0
          ? '<p class="text-muted">No sectors assigned.</p>'
          : `
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#f8fafc; border-bottom:2px solid var(--border);"><th style="padding:8px 12px; text-align:left;">Sector</th><th style="padding:8px 12px; text-align:left;">Path</th><th style="padding:8px 12px; text-align:left;">Action</th></tr></thead>
          <tbody>${sectorRows}</tbody>
        </table>
      `
      }
    </div>
    <div style="border-top:1px solid var(--border); padding-top:16px;">
      <h4 style="margin-bottom:8px;">➕ Add to a Sector</h4>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <select id="addSectorSelect" style="padding:6px 12px; border:1px solid var(--border); border-radius:6px; min-width:200px;">
          <option value="">— Select a sector —</option>
          ${availableSectors
            .map(
              (s) =>
                `<option value="${s.id}">${s.name} (${getSectorPath(
                  s.id
                )})</option>`
            )
            .join("")}
        </select>
        <button class="btn btn-primary btn-sm" onclick="addLibrarianToSector('${libId}')">Add</button>
      </div>
      ${
        availableSectors.length === 0
          ? '<p class="text-muted mt-8">All available sectors are already assigned.</p>'
          : ""
      }
    </div>`;
  document.getElementById("sectorMgmtContent").innerHTML = html;
  // ★ Store the librarian ID for refreshing the modal after removals
  currentManagementLibId = libId;
  openModal("sectorManagementModal");
}
async function addLibrarianToSector(libId) {
  const secId = document.getElementById("addSectorSelect").value;
  if (!secId) {
    toast("Select a sector.");
    return;
  }
  if (
    !appData.sector_assignments.some(
      (a) => a.sector_id === secId && a.librarian_id === libId
    )
  ) {
    const newAssignment = {
      sector_id: secId,
      librarian_id: libId,
      assigned_at: new Date().toISOString(),
    };
    const saved = await saveEntity("sectors/assignments", newAssignment);
    appData.sector_assignments.push(saved);

    // ★ Force today’s duty instance to exist (creates it if needed)
    await generateDutyInstancesForDate(getToday());

    // ★ Manually ensure the new librarian is added to today’s instance
    const today = getToday();
    const duties = appData.duties.filter(d => d.sector_id === secId);
    for (const duty of duties) {
      if (dutyOccursOnDate(duty, today)) {
        // Find (or create) today's instance
        let inst = appData.duty_instances.find(
          di => di.duty_id === duty.id && di.date === today
        );
        if (!inst) {
          // Create the instance on the fly (rare, generateDutyInstancesForDate should have done it)
          const newInst = {
            duty_id: duty.id,
            date: today,
            is_active: true,
            created_at: new Date().toISOString(),
          };
          const savedInst = await saveEntity("duties/instances", newInst);
          appData.duty_instances.push(savedInst);
          inst = savedInst;
        }

        // Add attendance record for this librarian if it doesn't already exist
        if (!appData.attendance.some(a => a.duty_instance_id === inst.id && a.librarian_id === libId)) {
          const att = {
            duty_instance_id: inst.id,
            librarian_id: libId,
            attended: false,
            confirmed_by: "system",
            confirmed_at: new Date().toISOString(),
            forgiven: false,
            punishment_issued: false,
          };
          const savedAtt = await saveEntity("attendance", att);
          appData.attendance.push(savedAtt);
          recalcAttendancePct(libId);
        }
      }
    }

    // Sync future instances as usual
    await syncDutyInstancesForSector(secId);

    // Refresh UI
    if (currentPage === "attendance") {
      renderAttendance();
    }
    viewSectorManagement(libId);
    renderSectors();
    toast("Added.");
  }
}
// ============================================
// BULK EDIT LIBRARIANS (FULL-SCREEN TABLE)
// ============================================

function openBulkEditModal() {
  const librarians = appData.librarians.filter(l => !l.is_deleted);
  if (librarians.length === 0) {
    toast("No librarians to edit.");
    return;
  }

  // Build table rows with prefilled inputs
  let html = '';
  librarians.forEach(l => {
    html += `
      <tr data-lib-id="${l.id}">
        <td><input type="text" class="bulk-edit-name" value="${escapeHtml(l.name)}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:4px;"></td>
        <td><input type="text" class="bulk-edit-grade" value="${escapeHtml(l.grade)}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:4px;"></td>
        <td><input type="text" class="bulk-edit-adm" value="${escapeHtml(l.adm_no)}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:4px;"></td>
        <td><input type="text" class="bulk-edit-house" value="${escapeHtml(l.house || '')}" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:4px;"></td>
      </tr>
    `;
  });

  document.getElementById('bulkEditTableBody').innerHTML = html;
  openModal('bulkEditModal');
}

async function saveBulkEdit() {
  const rows = document.querySelectorAll('#bulkEditTableBody tr');
  let savedCount = 0;
  let errors = [];

  showLoading();

  for (const row of rows) {
    const libId = row.getAttribute('data-lib-id');
    const lib = getLib(libId);
    if (!lib) continue;

    const nameInput = row.querySelector('.bulk-edit-name');
    const gradeInput = row.querySelector('.bulk-edit-grade');
    const admInput = row.querySelector('.bulk-edit-adm');
    const houseInput = row.querySelector('.bulk-edit-house');

    const newName = nameInput.value.trim();
    const newGrade = gradeInput.value.trim();
    const newAdm = admInput.value.trim();
    const newHouse = houseInput.value.trim();

    // Skip if nothing changed
    if (newName === lib.name && newGrade === lib.grade && newAdm === lib.adm_no && newHouse === (lib.house || '')) {
      continue;
    }

    // Basic validation
    if (!newName || !newGrade || !newAdm) {
      errors.push(`${lib.name}: all fields except House are required.`);
      continue;
    }

    // Check duplicate adm_no (against other active librarians, excluding self)
    if (newAdm !== lib.adm_no && appData.librarians.some(l => l.adm_no === newAdm && l.id !== libId && !l.is_deleted)) {
      errors.push(`${lib.name}: admission number "${newAdm}" already exists.`);
      continue;
    }

    // Update local object
    lib.name = newName;
    lib.grade = newGrade;
    lib.adm_no = newAdm;
    lib.house = newHouse;

    try {
      await saveEntity('librarians', lib, libId);
      savedCount++;
    } catch (err) {
      errors.push(`${lib.name}: server save failed.`);
    }
  }

  hideLoading();

  if (errors.length > 0) {
    toast(`⚠️ ${savedCount} saved. Errors: ${errors.join(', ')}`);
  } else {
    toast(`✅ ${savedCount} librarians updated.`);
  }

  closeModal('bulkEditModal');
  renderCurrentPage();
}

function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showActionPopup(librarianId) {
  const lib = getLib(librarianId);
  if (!lib) return;
  document.getElementById("actionPopupTitle").textContent = `⚙️ ${lib.name}`;
  document.getElementById("actionPopupContent").innerHTML = `
    <div class="action-column">
      <button class="btn btn-primary" style="width:100%;" onclick="viewLibrarianProfile('${librarianId}');closeModal('actionPopup');">👁️ View Profile</button>
      <button class="btn btn-warning" style="width:100%;" onclick="openTagModalForLibrarian('${librarianId}');closeModal('actionPopup');">🏷️ Add Tag</button>
      <button class="btn btn-secondary" style="width:100%;" onclick="viewSectorManagement('${librarianId}');closeModal('actionPopup');">📂 Manage Sectors</button>
      <button class="btn btn-secondary" style="width:100%;" onclick="viewAttendanceHistory('${librarianId}');closeModal('actionPopup');">📊 Attendance History</button>
      <button class="btn btn-info" style="width:100%;" onclick="viewTagHistoryForLibrarian('${librarianId}')">📜 Tag History</button>
      <button class="btn btn-danger" style="width:100%;" onclick="deleteLibrarian('${librarianId}');closeModal('actionPopup');">🗑️ Delete</button>
    </div>`;
  openModal("actionPopup");
}

// ============================================
// DASHBOARD
// ============================================
function renderDashboard() {
  const active = appData.librarians.filter((l) => !l.is_deleted);
  document.getElementById("statLibrarians").textContent = active.length;
  const todayDuties = appData.duty_instances.filter((di) => {
    if (di.date !== currentViewDate || !di.is_active) return false;
    const duty = appData.duties.find((d) => d.id === di.duty_id);
    if (!duty) return false;
    if (duty.end_date && duty.end_date < currentViewDate) return false;
    return true;
  });
  document.getElementById("statDutiesToday").textContent = todayDuties.length;
  const missed = appData.attendance.filter((a) => !a.attended && !a.forgiven);
  document.getElementById("statMissed").textContent = missed.length;
  const allAttendance = appData.attendance;
  const statAttendance = document.getElementById("statAttendance");
  if (allAttendance.length) {
    const att = allAttendance.filter((a) => a.attended || a.forgiven).length;
    statAttendance.textContent =
      Math.round((att / allAttendance.length) * 100) + "%";
  } else statAttendance.textContent = "N/A";
  document.getElementById("dutyBadge").textContent = todayDuties.length;
  populateTagFilterDropdown();
  renderDashboardTable();
}

let sectorSearchTimer;
function debounceRenderSectors() {
  clearTimeout(sectorSearchTimer);
  sectorSearchTimer = setTimeout(renderSectors, 200);
}

function debounceRenderDashboard() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderDashboardTable, 200);
}

function renderDashboardTable() {
  const tbody = document.getElementById("dashboardTableBody");
  if (!tbody) return;

  const searchType = document.getElementById("dashboardSearchType").value;
  const searchTerm = document
    .getElementById("dashboardSearch")
    .value.trim()
    .toLowerCase();
  const sortBy = document.getElementById("dashboardSort").value;

  let librarians = appData.librarians.filter((l) => !l.is_deleted);

  if (searchTerm) {
    librarians = librarians.filter((l) => {
      if (searchType === "name")
        return l.name.toLowerCase().includes(searchTerm);
      if (searchType === "grade")
        return l.grade.toLowerCase().includes(searchTerm);
      if (searchType === "adm")
        return l.adm_no.toLowerCase().includes(searchTerm);
      return true;
    });
  }

  // Tag filter
  const tagFilterValue = document.getElementById("tagFilterDropdown")?.value || "";
  if (tagFilterValue) {
    if (tagFilterValue.startsWith("type:")) {
      const type = tagFilterValue.substring(5);
      librarians = librarians.filter(l => getLibTags(l.id).some(t => t.type === type));
    } else if (tagFilterValue.startsWith("name:")) {
      const name = tagFilterValue.substring(5);
      librarians = librarians.filter(l => getLibTags(l.id).some(t => t.name === name));
    }
  }

  if (sortBy === "newest")
    librarians.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sortBy === "oldest")
    librarians.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sortBy === "name")
    librarians.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === "attendance")
    librarians.sort((a, b) => {
      const pctA = getAttendancePct(a.id),
        pctB = getAttendancePct(b.id);
      if (pctA === "N/A" && pctB === "N/A") return 0;
      if (pctA === "N/A") return 1;
      if (pctB === "N/A") return -1;
      return pctB - pctA;
    });

  if (!librarians.length) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="text-center text-muted">No junior librarians found.</td></tr>';
    return;
  }

  let html = "";
  librarians.forEach((l) => {
    const sectors = getLibSectors(l.id);
    let sectorDisplay = sectors.length
      ? sectors.map((s) => s.name).join(", ")
      : "—";
    const tags = getLibTags(l.id);
    let tagDisplay = "—";
    if (tags.length === 1) {
      const t = tags[0];
      tagDisplay = `<span class="tag-badge ${tagColor(
        t.type
      )}" onclick="event.stopPropagation();viewTagDetails('${t.id}')">${
        t.name
      }</span>`;
    } else if (tags.length > 1) {
      tagDisplay = `<span class="tag-badge tags-btn" onclick="event.stopPropagation();showAllTagsPopup('${l.id}')">Tags (${tags.length})</span>`;
    }
    const pct = getAttendancePct(l.id);
    const pctDisp = pct === "N/A" ? "N/A" : pct + "%";
    const pctClass =
      pct === "N/A"
        ? "text-muted"
        : pct <= 30
        ? "text-danger"
        : pct <= 60
        ? "text-warning"
        : pct <= 80
        ? "text-warning"
        : "text-success";
    const isRep = tags.some((t) => t.type === "rep");

    // 8 cells, no checkbox
    html += `<tr>
      <td class="${isRep ? "rep-name" : ""}" style="min-width:120px;">${l.name || "—"}</td>
      <td style="min-width:60px;">${l.grade || "—"}</td>
      <td style="min-width:80px;">${l.adm_no || "—"}</td>
      <td style="min-width:80px;">${l.house || "—"}</td>
      <td style="font-size:13px; min-width:100px;">${sectorDisplay}</td>
      <td style="min-width:100px;"><div class="tag-container">${tagDisplay}</div></td>
      <td style="min-width:80px;"><span class="${pctClass}" style="font-weight:600;">${pctDisp}</span></td>
      <td style="min-width:50px;"><button class="action-btn" onclick="showActionPopup('${
        l.id
      }')">⚙️</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

// ============================================
// TAG FILTER ON DASHBOARD
// ============================================

function populateTagFilterDropdown() {
  const dropdown = document.getElementById("tagFilterDropdown");
  if (!dropdown) return;

  // Get all unique active tag types
  const types = [...new Set(appData.tags.filter(t => t.is_active).map(t => t.type))];
  // Get all unique active tag names
  const names = [...new Set(appData.tags.filter(t => t.is_active).map(t => t.name))];

  let options = '<option value="">🏷️ All Tags</option>';
  if (types.length > 0) {
    options += '<optgroup label="By Type">';
    types.forEach(type => {
      options += `<option value="type:${type}">${type.charAt(0).toUpperCase() + type.slice(1)}</option>`;
    });
    options += '</optgroup>';
  }
  if (names.length > 0) {
    options += '<optgroup label="By Tag Name">';
    names.forEach(name => {
      options += `<option value="name:${name}">${name}</option>`;
    });
    options += '</optgroup>';
  }
  options += '<option value="__expired__">🕒 View Past / Expired Tags</option>';

  dropdown.innerHTML = options;
}

function filterByTag() {
  const value = document.getElementById("tagFilterDropdown").value;
  if (value === "__expired__") {
    openExpiredTagsModal();
    // reset dropdown to "All Tags"
    document.getElementById("tagFilterDropdown").value = "";
    renderDashboardTable(); // show all
    return;
  }
  // Re-render the dashboard table with the filter applied
  renderDashboardTable();
}

function openExpiredTagsModal() {
  const history = appData.tag_history || [];
  let html = '';
  if (history.length === 0) {
    html = '<p class="text-muted">No expired or deleted tags found.</p>';
  } else {
    html += '<table style="width:100%; font-size:13px;"><thead><tr><th>Tag Name</th><th>Type</th><th>Librarian</th><th>Start</th><th>End</th><th>Removed</th><th>Reason</th></tr></thead><tbody>';
    history.forEach(h => {
      const lib = getLib(h.librarian_id);
      html += `<tr>
        <td><strong>${h.tag_name}</strong></td>
        <td>${h.type}</td>
        <td>${lib ? lib.name : "Unknown"}</td>
        <td>${formatDate(h.start_date)}</td>
        <td>${h.end_date ? formatDate(h.end_date) : "Forever"}</td>
        <td>${formatDate(h.removed_at)}</td>
        <td>${h.removal_reason || "—"}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }
  document.getElementById("expiredTagsContent").innerHTML = html;
  openModal("expiredTagsModal");
}

async function clearAllExpiredTags() {
  showConfirm(
    "Clear All Expired Tags",
    "Permanently delete all expired tag history? This cannot be undone.",
    async () => {
      try {
        const ids = appData.tag_history.map(h => h.id);
        for (const id of ids) {
          await deleteEntity("tags/history", id);
        }
        appData.tag_history = [];
        saveData();
        closeModal("expiredTagsModal");
        toast("All expired tags cleared.");
      } catch (err) {
        console.error(err);
        toast("Failed to clear expired tags.");
      }
    }
  );
}

// ============================================
// ADD LIBRARIAN (single & bulk) + HOUSE
// ============================================
async function addLibrarian() {
  const name = document.getElementById("libName").value.trim();
  const grade = document.getElementById("libGrade").value.trim();
  const adm = document.getElementById("libAdm").value.trim();
  const joined = document.getElementById("libJoined").value;
  const house = document.getElementById("libHouse").value.trim() || "";

  if (!name || !grade || !adm || !joined) {
    Swal.fire("Error", "All fields required.", "error");
    return;
  }
  if (appData.librarians.some((l) => l.adm_no === adm && !l.is_deleted)) {
    Swal.fire("Error", "Admission number already exists!", "error");
    return;
  }

  // ---- Create a temporary librarian object for instant UI ----
  const tempId = "temp_" + Date.now();
  const tempLib = {
    id: tempId,
    name,
    grade,
    adm_no: adm,
    date_joined: joined,
    house,
    is_deleted: false,
    created_at: new Date().toISOString(),
    _temp: true, // marker so we can identify the pending row
  };

  // Add to local cache instantly
  appData.librarians.push(tempLib);

  // Close modal and reset inputs immediately
  closeModal("librarianModal");
  ["libName", "libGrade", "libAdm", "libJoined", "libHouse"].forEach(
    (id) => (document.getElementById(id).value = "")
  );

  // Re‑render the dashboard table instantly (the new row appears with a subtle indicator)
  renderCurrentPage();
  toast("Adding librarian…");

  try {
    // Save to server in background
    const newLib = {
      name,
      grade,
      adm_no: adm,
      date_joined: joined,
      house,
      is_deleted: false,
      created_at: new Date().toISOString(),
    };
    const saved = await saveEntity("librarians", newLib);

    // Replace the temporary object with the real one
    const idx = appData.librarians.findIndex((l) => l.id === tempId);
    if (idx !== -1) {
      appData.librarians[idx] = { ...saved, id: saved._id }; // replace
    } else {
      // fallback if race condition
      appData.librarians.push({ ...saved, id: saved._id });
    }

    // Re‑render again to update the row with real data and remove any temp indicator
    renderCurrentPage();
    toast("Librarian added.");
  } catch (err) {
    // Remove the temporary entry on failure
    appData.librarians = appData.librarians.filter((l) => l.id !== tempId);
    renderCurrentPage();
    toast("Error adding librarian – rolled back.");
    console.error(err);
  }
}
async function deleteLibrarian(id) {
  const lib = getLib(id);
  if (!lib) return;
  showConfirm(
    "Delete Junior Librarian",
    `<p>Move <strong>${lib.name}</strong> (${lib.adm_no}) to archive?</p>`,
    async () => {
      lib.is_deleted = true;
      await saveEntity("librarians", lib, id);
      appData.sector_assignments = appData.sector_assignments.filter(
        (a) => a.librarian_id !== id
      );
      renderCurrentPage();
      toast("Librarian moved to archive.");
    }
  );
}
// ============================================
// HALL OF FAME (unchanged from localStorage)
// ============================================
function switchHallTab(tab) {
  currentHallTab = tab;
  document
    .querySelectorAll(".hall-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelector(`.hall-tab[data-tab="${tab}"]`)
    .classList.add("active");
  renderHallOfFame();
}
function renderHallOfFame() {
  const captains = appData.hall_of_fame_captains || [];
  const committees = appData.hall_of_fame_committees || [];
  const container = document.getElementById("hallContainer");

  if (currentHallTab === "captains") {
    const addButton = `<div style="margin-bottom:16px;"><button class="btn btn-primary" onclick="openModal('hallCaptainModal')">+ Add Captain</button></div>`;
    const cards =
      captains.length === 0
        ? '<p class="text-muted">No captains added yet.</p>'
        : `<div class="hall-grid">${captains
            .sort((a, b) => b.year - a.year)
            .map(
              (c) => `
        <div class="hall-card captain-card">
          <div class="avatar">${
            c.photo_url
              ? `<img src="${c.photo_url}" onerror="this.style.display='none'">`
              : getInitials(c.name)
          }</div>
          <div class="name">${c.name}</div>
          <div class="year-title">${c.year} Library Captain</div>
          ${c.house ? `<div class="detail">House: ${c.house}</div>` : ""}
          ${c.adm_no ? `<div class="detail">Adm No.: ${c.adm_no}</div>` : ""}
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" onclick="editCaptain('${
              c.id
            }')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCaptain('${
              c.id
            }')">🗑️</button>
          </div>
        </div>`
            )
            .join("")}</div>`;
    container.innerHTML = addButton + cards;
  } else {
    const addButton = `<div style="margin-bottom:16px;"><button class="btn btn-success" onclick="openModal('committeeModal')">+ Add Committee</button></div>`;
    const committeeCards =
      committees.length === 0
        ? '<p class="text-muted">No committees added yet.</p>'
        : committees
            .sort((a, b) => b.year - a.year)
            .map(
              (c) => `
        <div class="committee-card">
          <div class="year">${c.year} Library Committee</div>
          <div class="members">
            ${c.members
              .map(
                (m) => `
              <span class="member">
                <span class="member-avatar">${
                  m.photo_url
                    ? `<img src="${m.photo_url}" onerror="this.style.display='none'">`
                    : getInitials(m.name)
                }</span>
                ${m.name} <span class="pos">(${m.position})</span>
                ${m.house ? ` – ${m.house}` : ""} ${
                  m.adm_no ? ` – Adm: ${m.adm_no}` : ""
                } ${m.class ? ` – Class: ${m.class}` : ""}
              </span>`
              )
              .join("")}
          </div>
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" onclick="editCommittee('${
              c.id
            }')">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCommittee('${
              c.id
            }')">🗑️</button>
          </div>
        </div>`
            )
            .join("");
    container.innerHTML = addButton + committeeCards;
  }
}

// ============================================
// BULK ADD (unchanged)
// ============================================
function addBulkRow() {
  const tbody = document.getElementById("bulkBody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="bulk-name" placeholder="Name"></td>
    <td><input type="text" class="bulk-grade" placeholder="Grade"></td>
    <td><input type="text" class="bulk-adm" placeholder="Adm No."></td>
    <td><input type="text" class="bulk-house" placeholder="House (optional)"></td>
    <td><input type="date" class="bulk-joined" value="${getToday()}"></td>
    <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(row);
}

// ============================================
// CAPTAINS & COMMITTEE (unchanged UI, but data ops are async)
// ============================================
async function editCaptain(captainId) {
  const captain = appData.hall_of_fame_captains.find((c) => c.id === captainId);
  if (!captain) return;
  document.getElementById("captainName").value = captain.name;
  document.getElementById("captainAdm").value = captain.adm_no || "";
  document.getElementById("captainYear").value = captain.year;
  document.getElementById("captainHouse").value = captain.house || "";
  document.getElementById("captainPhoto").value = captain.photo_url || "";
  // Show preview if a photo exists
  const preview = document.getElementById("captainPhotoPreview");
  if (preview) {
    if (captain.photo_url) {
      preview.src = captain.photo_url;
      preview.style.display = "inline-block";
    } else {
      preview.style.display = "none";
    }
  }
  window._editingCaptainId = captainId;
  openModal("hallCaptainModal");
}
async function addCaptain() {
  const name = document.getElementById("captainName").value.trim();
  const adm = document.getElementById("captainAdm").value.trim();
  const year = parseInt(document.getElementById("captainYear").value);
  const house = document.getElementById("captainHouse").value.trim() || "";
  const photo = document.getElementById("captainPhoto").value.trim() || null;

  if (!name || !year || !adm) {
    Swal.fire(
      "Error",
      "Name, Admission Number, and Year are required.",
      "error"
    );
    return;
  }

  if (window._editingCaptainId) {
    // Editing existing – this is a save, not an add; we skip optimistic for edit for now.
    const captain = appData.hall_of_fame_captains.find(
      (c) => c.id === window._editingCaptainId
    );
    if (captain) {
      captain.name = name;
      captain.adm_no = adm;
      captain.year = year;
      captain.house = house;
      captain.photo_url = photo;
      await saveEntity("halloffame/captains", captain, captain.id);
    }
    window._editingCaptainId = null;
  } else {
    // ---- Add new captain optimistically ----
    const tempId = "temp_" + Date.now();
    const tempCaptain = {
      id: tempId,
      name,
      adm_no: adm,
      year,
      house,
      photo_url: photo,
      created_at: new Date().toISOString(),
      _temp: true,
    };

    appData.hall_of_fame_captains.push(tempCaptain);
    closeModal("hallCaptainModal");
    renderHallOfFame();
    toast("Adding captain…");

    try {
      const newCaptain = {
        name,
        adm_no: adm,
        year,
        house,
        photo_url: photo,
        created_at: new Date().toISOString(),
      };
      const saved = await saveEntity("halloffame/captains", newCaptain);

      // Replace temporary captain with the real one
      const idx = appData.hall_of_fame_captains.findIndex(
        (c) => c.id === tempId
      );
      if (idx !== -1) {
        appData.hall_of_fame_captains[idx] = { ...saved, id: saved._id };
      } else {
        appData.hall_of_fame_captains.push({ ...saved, id: saved._id });
      }

      renderHallOfFame();
      toast("Captain saved.");
      return; // success, skip the final block
    } catch (err) {
      appData.hall_of_fame_captains = appData.hall_of_fame_captains.filter(
        (c) => c.id !== tempId
      );
      renderHallOfFame();
      toast("Error adding captain – rolled back.");
      console.error(err);
      return;
    }
  }

  // If editing (the other branch)
  closeModal("hallCaptainModal");
  renderHallOfFame();
  toast("Captain saved.");
}
async function deleteCaptain(id) {
  showConfirm(
    "Delete Captain",
    "Remove this captain from Hall of Fame?",
    async () => {
      await deleteEntity("halloffame/captains", id);
      appData.hall_of_fame_captains = appData.hall_of_fame_captains.filter(
        (c) => c.id !== id
      );
      renderHallOfFame();
      toast("Captain removed.");
    }
  );
}

// Committee functions are similar, using saveEntity/deleteEntity.  We'll include them in the second half.

// ============================================
// PROFILE
// ============================================
function viewLibrarianProfile(id) {
  const lib = getLib(id);
  if (!lib) return;
  editingLibrarianId = id;
  document.getElementById("profileTitle").textContent = `👤 ${lib.name}`;
  document.getElementById("profileContent").innerHTML = `
    <div class="profile-field"><span class="label">Name</span><span class="value"><input type="text" id="profileName" value="${
      lib.name
    }"></span></div>
    <div class="profile-field"><span class="label">Grade</span><span class="value"><input type="text" id="profileGrade" value="${
      lib.grade
    }"></span></div>
    <div class="profile-field"><span class="label">Admission No.</span><span class="value"><input type="text" id="profileAdm" value="${
      lib.adm_no
    }"></span></div>
    <div class="profile-field"><span class="label">House</span><span class="value"><input type="text" id="profileHouse" value="${
      lib.house || ""
    }" placeholder="e.g., Sanders"></span></div>
    <div class="profile-field"><span class="label">Date Joined</span><span class="value"><input type="date" id="profileJoined" value="${
      lib.date_joined
    }"></span></div>
    <div class="profile-field"><span class="label">Attendance</span><span class="value">${getAttendancePct(
      id
    )}%</span></div>
    <div class="profile-field"><span class="label">Active Tags</span><span class="value">${
      getLibTags(id)
        .map(
          (t) =>
            `<span class="tag-badge ${tagColor(
              t.type
            )}" onclick="viewTagDetails('${t.id}')">${t.name}</span>`
        )
        .join(" ") || "—"
    }</span></div>`;
  openModal("profileModal");
}
async function saveProfile() {
  const lib = getLib(editingLibrarianId);
  if (!lib) return;
  const name = document.getElementById("profileName").value.trim();
  const grade = document.getElementById("profileGrade").value.trim();
  const adm = document.getElementById("profileAdm").value.trim();
  const house = document.getElementById("profileHouse").value.trim();
  const joined = document.getElementById("profileJoined").value;
  if (!name || !grade || !adm || !joined) {
    Swal.fire("Error", "All fields required.", "error");
    return;
  }
  if (
    adm !== lib.adm_no &&
    appData.librarians.some(
      (l) => l.adm_no === adm && l.id !== editingLibrarianId && !l.is_deleted
    )
  ) {
    Swal.fire("Error", "Admission number already exists!", "error");
    return;
  }
  lib.name = name;
  lib.grade = grade;
  lib.adm_no = adm;
  lib.house = house;
  lib.date_joined = joined;
  await saveEntity("librarians", lib, lib.id);
  closeModal("profileModal");
  renderCurrentPage();
  toast("Profile updated.");
}

// ============================================
// TAGS
// ============================================
function openTagModalForLibrarian(librarianId) {
  selectedLibrarianId = librarianId;
  selectedTagId = null;
  document.getElementById("tagNameInput").value = "";
  document.getElementById("tagDescInput").value = "";
  document.getElementById("tagEndDate").value = "";
  document.getElementById("tagTypeSelect").value = "normal";
  document.getElementById("tagModalSaveBtn").textContent = "Add Tag";
  openModal("tagModal");
}
function setTagTemplate(name) {
  document.getElementById("tagNameInput").value = name;
}
async function addTagFromModal() {
  const name = document.getElementById("tagNameInput").value.trim();
  const desc = document.getElementById("tagDescInput").value.trim();
  const type = document.getElementById("tagTypeSelect").value;
  const endDate = document.getElementById("tagEndDate").value || null;

  if (!name) {
    Swal.fire("Error", "Enter tag name.", "error");
    return;
  }
  if (type === "rep" && !selectedTagId) {
    const existingRep = appData.tags.some(
      (t) =>
        t.librarian_id === selectedLibrarianId &&
        t.type === "rep" &&
        t.is_active
    );
    if (existingRep) {
      Swal.fire(
        "Error",
        "This librarian already has a Representative tag.",
        "error"
      );
      return;
    }
  }

  // ---- temporary tag for instant UI ----
  const tempTag = {
    id: "temp_" + Date.now(),
    name,
    description: desc || "No description",
    type,
    librarian_id: selectedLibrarianId,
    start_date: getToday(),
    end_date: endDate,
    is_active: true,
    duty_id: null,
    created_at: new Date().toISOString(),
    _temp: true,
  };

  appData.tags.push(tempTag);
  closeModal("tagModal");
  renderCurrentPage();
  toast("Adding tag…");

  try {
    const newTag = {
      name,
      description: desc || "No description",
      type,
      librarian_id: selectedLibrarianId,
      start_date: getToday(),
      end_date: endDate,
      is_active: true,
      duty_id: null,
      created_at: new Date().toISOString(),
    };
    const saved = await saveEntity("tags", newTag);
    // Replace temp with real tag
    const idx = appData.tags.findIndex((t) => t.id === tempTag.id);
    if (idx !== -1) {
      appData.tags[idx] = { ...saved, id: saved._id };
    } else {
      appData.tags.push({ ...saved, id: saved._id });
    }

    if (type === "punishment") {
      await addNotification(
        `⚠️ Punishment tag "${name}" issued for ${
          getLib(selectedLibrarianId)?.name
        }`,
        "punishment",
        selectedLibrarianId,
        null,
        saved.id
      );
    }

    renderCurrentPage();
    toast("Tag added.");
  } catch (err) {
    appData.tags = appData.tags.filter((t) => t.id !== tempTag.id);
    renderCurrentPage();
    toast("Error adding tag – rolled back.");
    console.error(err);
  }
}
async function deleteTagFromModal() {
  if (!selectedTagId) return;
  const tag = appData.tags.find((t) => t.id === selectedTagId);
  if (!tag) return;
  showConfirm(
    "Delete Tag",
    `<p>Delete "<strong>${tag.name}</strong>"?</p>`,
    async () => {
            tag.is_active = false;
      tag.removed_at = new Date().toISOString();
      await saveEntity("tags", tag, tag.id);
      appData.tag_history.push({
        tag_id: tag.id,
        librarian_id: tag.librarian_id,
        tag_name: tag.name,
        description: tag.description,
        type: tag.type,
        start_date: tag.start_date,
        end_date: tag.end_date,
        removed_at: tag.removed_at,
        removal_reason: "manual_delete",
      });
      saveData();   // ★ persist the history
      renderCurrentPage();
      toast("Tag removed.");
    }
  );
}
// viewTagDetails, editTag, showAllTagsPopup, quickDeleteTag remain the same as in localStorage,
// but with saveEntity for delete/update.  I'll omit them for brevity; they follow the same pattern.

// ============================================
// SECTORS – TWO‑LEVEL HIERARCHY + WIZARD (API adapted)
// ============================================
function renderSectors() {
  if (currentSectorPath.length === 0) {
    const categories = appData.sectors.filter((s) => s.parent_id === null);
    renderCategoryCards(categories);
  } else {
    const categoryId = currentSectorPath[0];
    const category = getSector(categoryId);
    if (!category) {
      currentSectorPath = [];
      renderSectors();
      return;
    }
    const leafSectors = appData.sectors.filter(
      (s) => s.parent_id === categoryId
    );
    renderLeafList(category, leafSectors);
  }
}
function renderCategoryCards(categories) {
  const container = document.getElementById("sectorContainer");
  categories = categories.filter((cat) => typeof cat.name === "string");
  categories.sort((a, b) => a.name.localeCompare(b.name));
  let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
    <h2 style="font-size:20px; color:var(--primary);">📁 Library Categories</h2>
    <button class="btn btn-primary" onclick="openModal('sectorModal')">+ Add Category</button>
  </div>`;
  if (!categories.length) {
    html += `<div class="text-center text-muted" style="padding:40px;">No categories yet. Click "+ Add Category" to start.</div>`;
  } else {
    html += `<div class="category-grid">`;
    categories.forEach((cat) => {
      const leafCount = appData.sectors.filter(
        (s) => s.parent_id === cat.id
      ).length;
      html += `
        <div class="category-card" onclick="openCategory('${cat.id}')">
          <div class="card-icon">📁</div>
          <div class="card-content">
            <div class="card-title">${cat.name}</div>
            <div class="card-subtitle">${leafCount} leaf sector${
        leafCount !== 1 ? "s" : ""
      }</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteSector('${
            cat.id
          }')" title="Delete category">🗑️</button>
        </div>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}
function openCategory(categoryId) {
  currentSectorPath = [categoryId];
  selectedLeafId = null;
  renderSectors();
}
function renderLeafList(category, leafSectors) {
  const container = document.getElementById("sectorContainer");
  let html = `<div class="sector-path" style="margin-bottom:16px;">
    <span class="sector-path-link" onclick="currentSectorPath=[];renderSectors();">📁 All Categories</span>
    › <span class="sector-path-current">📂 ${category.name}</span>
  </div>`;
  html += `<button class="btn btn-secondary btn-sm" onclick="currentSectorPath=[];renderSectors();">⬅ Back to Categories</button>`;
  html += `<button class="btn btn-success btn-sm ml-8" onclick="openQuickAddLeafModal('${category.id}')">+ Add Leaf Sector</button>`;
  html += `<div style="margin-top:16px;"><h3>📄 Leaf Sectors in ${category.name}</h3></div>`;

  if (!leafSectors.length) {
    html += `<p class="text-muted">No leaf sectors yet. Click "+ Add Leaf Sector" to create one.</p>`;
  } else {
    html += `<div class="leaf-grid">`;
    leafSectors.forEach((s) => {
      const people = getSectorPeople(s.id);
      const isFull = people.length >= (s.min_people || 1);
      const isActive = s.id === selectedLeafId;
      html += `
        <div class="leaf-card ${isFull ? "staffed" : "understaffed"} ${
        isActive ? "active" : ""
      }" 
             onclick="selectLeafSector('${s.id}')">
          <div class="card-icon">📄</div>
          <div class="card-content">
            <div class="card-title">${s.name}</div>
            <div class="card-subtitle">${people.length}/${
        s.min_people || 1
      } junior librarians</div>
          </div>
          <div class="leaf-actions">
            <button onclick="event.stopPropagation(); editLeafSector('${
              s.id
            }')" title="Edit">✏️</button>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteSector('${
              s.id
            }')" title="Delete">🗑️</button>
          </div>
        </div>`;
    });
    html += `</div>`;

    if (selectedLeafId && leafSectors.some((s) => s.id === selectedLeafId)) {
      html += renderLeafContent(selectedLeafId);
    } else {
      selectedLeafId = null;
    }
  }
  container.innerHTML = html;
}
function selectLeafSector(sectorId) {
  selectedLeafId = sectorId;
  renderSectors();
}

// ---------- WIZARD (leaf sector creation) ----------
let wizardSpecificDatesList = [];

function openAddLeafModal(categoryId) {
  window._wizardCategoryId = categoryId;
  window._wizardName = "";
  window._wizardMin = 1;
  window._wizardDesc = "";
  wizardSpecificDatesList = [];

  const modal = document.getElementById("sectorModal");
  modalZIndex += 2;
  modal.style.zIndex = modalZIndex;
  modal.classList.add("active");

  document.getElementById("sectorIsLeaf").checked = true;
  document
    .getElementById("sectorIsLeaf")
    .closest(".form-group.checkbox-group").style.display = "none";
  document.getElementById("sectorDutySettings").style.display = "none";

  const header = modal.querySelector(".modal-header h3");
  if (header) header.textContent = "📄 New Leaf Sector – Step 1 of 2";

  const body = modal.querySelector(".modal-body");
  body.innerHTML = `
    <div style="padding:4px 0;">
      <div class="wizard-steps">
        <span class="wizard-step active">1. Basic Info</span>
        <span class="wizard-step-sep">›</span>
        <span class="wizard-step">2. Duty Settings</span>
      </div>
      <div class="form-group"><label>Name *</label><input type="text" id="wizardSectorName" placeholder="e.g., Fiction Shelves 3-5"></div>
      <div class="form-group"><label>Minimum People Required *</label><input type="number" id="wizardSectorMin" value="1" min="1"></div>
      <div class="form-group"><label>Description (optional)</label><textarea id="wizardSectorDesc" placeholder="Brief description of this leaf sector"></textarea></div>
    </div>`;

  const footer = modal.querySelector(".modal-footer");
  footer.innerHTML = `<button class="btn btn-secondary" onclick="closeModal('sectorModal')">Cancel</button><button class="btn btn-primary" onclick="goToWizardStep2()">Next →</button>`;
}

// ---------- QUICK ADD LEAF (single screen) ----------
let quickSpecificDates = [];

function openQuickAddLeafModal(categoryId) {
  document.getElementById("quickParentCategoryId").value = categoryId;
  // Reset form
  document.getElementById("quickLeafName").value = "";
  document.getElementById("quickLeafMin").value = "1";
  document.getElementById("quickLeafDesc").value = "";
  document.getElementById("quickDutyName").value = "";
  document.getElementById("quickDutyStart").value = "";
  document.getElementById("quickDutyEnd").value = "";
  document
    .querySelectorAll(".quick-duty-day")
    .forEach((cb) => (cb.checked = false));
  document.getElementById("quickRecurrence").value = "weekly";
  document.getElementById("quickRecurrenceExtra").style.display = "none";
  document.getElementById("quickSpecificDatesContainer").style.display = "none";
  document.getElementById("quickEndDate").value = "";
  document.getElementById("quickIsPunishment").value = "false";
  quickSpecificDates = [];
  document.getElementById("quickSpecificDatesList").innerHTML = "";
  openModal("quickLeafModal");
}

function toggleQuickRecurrence() {
  const rec = document.getElementById("quickRecurrence").value;
  document.getElementById("quickRecurrenceExtra").style.display =
    rec === "biweekly" ? "block" : "none";
  document.getElementById("quickSpecificDatesContainer").style.display =
    rec === "specific" ? "block" : "none";
}

function addQuickSpecificDate() {
  const input = document.getElementById("quickSpecificDateInput");
  const date = input.value;
  if (!date) return;
  if (quickSpecificDates.includes(date)) {
    Swal.fire("Error", "Date already added.", "error");
    return;
  }
  quickSpecificDates.push(date);
  renderQuickSpecificDates();
  input.value = "";
}

function removeQuickSpecificDate(date) {
  quickSpecificDates = quickSpecificDates.filter((d) => d !== date);
  renderQuickSpecificDates();
}

function renderQuickSpecificDates() {
  const container = document.getElementById("quickSpecificDatesList");
  container.innerHTML = quickSpecificDates
    .map(
      (d) =>
        `<span>${formatDate(
          d
        )} <span class="remove-date" onclick="removeQuickSpecificDate('${d}')">×</span></span>`
    )
    .join("");
}

async function saveQuickLeaf() {
  if (saveQuickLeafInProgress) return;
  saveQuickLeafInProgress = true;

  const saveBtn = document.querySelector(
    "#quickLeafModal .quick-leaf-buttons .btn-primary"
  );
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ Saving...";
  }
  showLoading();

  try {
    // 1. Read & validate all inputs
    const categoryId = document.getElementById("quickParentCategoryId").value;
    const name = document.getElementById("quickLeafName").value.trim();
    const min = parseInt(document.getElementById("quickLeafMin").value);
    const desc = document.getElementById("quickLeafDesc").value.trim();
    const dutyName = document.getElementById("quickDutyName").value.trim();
    if (!dutyName) {
      Swal.fire("Error", "Duty name is required.", "error");
      return;
    }
    const start = document.getElementById("quickDutyStart").value;
    const end = document.getElementById("quickDutyEnd").value;
    const recurrence = document.getElementById("quickRecurrence").value;
    const isPunishment =
      document.getElementById("quickIsPunishment").value === "true";
    const endDate = document.getElementById("quickEndDate").value || null;
    const interval =
      recurrence === "biweekly"
        ? parseInt(document.getElementById("quickRecurrenceInterval").value) ||
          1
        : null;
    const specificDates =
      recurrence === "specific" ? [...quickSpecificDates] : null;

    const days = [];
    document
      .querySelectorAll(".quick-duty-day:checked")
      .forEach((cb) => days.push(cb.value));

    if (!name) {
      Swal.fire("Error", "Leaf name is required.", "error");
      return;
    }
    if (!min || min < 1) {
      Swal.fire("Error", "Min people must be at least 1.", "error");
      return;
    }
    if (!dutyName || !start || !end) {
      Swal.fire("Error", "Duty name, start, and end time are required.", "error");
      return;
    }
    if (start >= end) {
      Swal.fire("Error", "End time must be after start.", "error");
      return;
    }
    if (days.length === 0) {
      Swal.fire("Error", "Select at least one day.", "error");
      return;
    }

    // 2. Create temporary objects for instant UI
    const tempSectorId = "temp_sector_" + Date.now();
    const tempDutyId = "temp_duty_" + Date.now();

    const tempSector = {
      id: tempSectorId,
      name,
      parent_id: categoryId,
      leader_ids: [],
      min_people: min,
      is_leaf: true,
      description: desc || null,
      duty_settings_list: [
        {
          name: dutyName,
          start_time: start,
          end_time: end,
          days,
          recurrence,
          recurrence_interval: interval,
          specific_dates: specificDates,
          is_punishment: isPunishment,
          end_date: endDate,
        },
      ],
      created_at: new Date().toISOString(),
      _temp: true,
    };

    const tempDuty = {
      id: tempDutyId,
      name: dutyName,
      start_time: start,
      end_time: end,
      days,
      recurrence_type: recurrence,
      specific_dates: specificDates,
      recurrence_interval: interval,
      end_date: endDate || null,
      is_punishment: isPunishment,
      sector_id: tempSectorId,
      created_by: appData.current_user,
      created_at: new Date().toISOString(),
      _temp: true,
    };

    // 3. Push only temporary objects, then close modal immediately
    appData.sectors.push(tempSector);
    appData.duties.push(tempDuty);

    currentSectorPath = [categoryId];
    selectedLeafId = tempSectorId;
    closeModal("quickLeafModal");
    renderCurrentPage();
    toast(`Creating leaf sector "${name}"…`);

    // 4. Save sector first (to get a real ID)
    const newSector = { ...tempSector };
    delete newSector.id;
    delete newSector._temp;

    const savedSector = await saveEntity("sectors", newSector);

    // Replace temp sector with real one
    const sectorIdx = appData.sectors.findIndex((s) => s.id === tempSectorId);
    if (sectorIdx !== -1) {
      appData.sectors[sectorIdx] = { ...savedSector, id: savedSector._id };
    } else {
      appData.sectors.push({ ...savedSector, id: savedSector._id });
    }

    // 5. Save duty with the real sector_id
    const newDuty = {
      name: dutyName,
      start_time: start,
      end_time: end,
      days,
      recurrence_type: recurrence,
      specific_dates: specificDates,
      recurrence_interval: interval,
      end_date: endDate || null,
      is_punishment: isPunishment,
      sector_id: savedSector._id,
      created_by: appData.current_user,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const savedDuty = await saveEntity("duties", newDuty);

    // ★ Replace temporary duty with the real one, NOT push an extra
    const dutyIdx = appData.duties.findIndex((d) => d.id === tempDutyId);
    if (dutyIdx !== -1) {
      appData.duties[dutyIdx] = { ...savedDuty, id: savedDuty._id };
    } else {
      // Fallback: if the temp was somehow removed, push it (safeguard)
      appData.duties.push({ ...savedDuty, id: savedDuty._id });
    }

    // 6. Generate today's instance if the duty occurs today
    const today = getToday();
    if (dutyOccursOnDate(savedDuty, today)) {
      const newInst = {
        duty_id: savedDuty._id,
        date: today,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      const savedInst = await saveEntity("duties/instances", newInst);
      appData.duty_instances.push({ ...savedInst, id: savedInst._id });
      const sectorPeopleIds = getSectorPeople(savedSector._id).map((p) => p.id);
      for (const libId of sectorPeopleIds) {
        const att = {
          duty_instance_id: savedInst._id,
          librarian_id: libId,
          attended: false,
          confirmed_by: "system",
          confirmed_at: new Date().toISOString(),
          forgiven: false,
          punishment_issued: false,
        };
        const savedAtt = await saveEntity("attendance", att);
        appData.attendance.push({ ...savedAtt, id: savedAtt._id });
        recalcAttendancePct(libId);
      }
    }

    // 7. Update the UI with the real objects
    selectedLeafId = savedSector._id;
    renderCurrentPage();
    toast(`Leaf sector "${name}" added.`);
  } catch (err) {
    // Remove temporary objects on failure
    appData.sectors = appData.sectors.filter((s) => s._temp !== true);
    appData.duties = appData.duties.filter((d) => d._temp !== true);
    renderCurrentPage();
    toast("Error saving leaf sector – rolled back.");
    console.error(err);
  } finally {
    saveQuickLeafInProgress = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save Leaf Sector";
    }
    hideLoading();
  }
}

function goToWizardStep2() {
  const nameEl = document.getElementById("wizardSectorName");
  if (!nameEl) return;
  const name = nameEl.value.trim();
  const min = document.getElementById("wizardSectorMin").value;
  if (!name) {
    Swal.fire("Error", "Please enter a sector name.", "error");
    return;
  }
  if (!min || parseInt(min) < 1) {
    Swal.fire("Error", "Minimum people must be at least 1.", "error");
    return;
  }

  window._wizardName = name;
  window._wizardMin = parseInt(min);
  window._wizardDesc = document.getElementById("wizardSectorDesc").value.trim();

  const modal = document.getElementById("sectorModal");
  const header = modal.querySelector(".modal-header h3");
  if (header) header.textContent = "📄 New Leaf Sector – Step 2 of 2";

  const body = modal.querySelector(".modal-body");
  body.innerHTML = `
    <div style="padding:4px 0;">
      <div class="wizard-steps"><span class="wizard-step completed">1. Basic Info</span><span class="wizard-step-sep">›</span><span class="wizard-step active">2. Duty Settings</span></div>
      <div class="form-group"><label>Duty Name *</label><input type="text" id="wizardDutyName" placeholder="e.g., Fiction Duty"></div>
      <div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="wizardDutyStart"></div><div class="form-group"><label>End Time *</label><input type="time" id="wizardDutyEnd"></div></div>
      <div class="form-group"><label>Days *</label><div class="day-checkboxes">${[
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ]
        .map(
          (d) =>
            `<label><input type="checkbox" class="wizard-duty-day" value="${d}"> ${d.slice(
              0,
              3
            )}</label>`
        )
        .join("")}</div></div>
      <div class="form-row"><div class="form-group"><label>Recurrence</label><select id="wizardDutyRecurrence" onchange="toggleWizardRecurrence()"><option value="weekly">Weekly</option><option value="biweekly">After X Weeks</option><option value="forever">Forever</option><option value="specific">Specific Dates</option></select></div><div class="form-group" id="wizardRecurrenceExtra" style="display:none;"><label>After how many weeks?</label><input type="number" id="wizardRecurrenceInterval" value="1" min="1"></div></div>
      <div class="form-group" id="wizardSpecificDatesContainer" style="display:none;"><label>Specific Dates</label><div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;"><input type="date" id="wizardSpecificDateInput" style="flex:1; min-width:150px;"><button class="btn btn-secondary btn-sm" onclick="addWizardSpecificDate()">+ Add Date</button></div><div id="wizardSpecificDatesList" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;"></div></div>
      <div class="form-group"><label>End Date (optional)</label><input type="date" id="wizardDutyEndDate"></div>
      <div class="form-group"><label>Punishment Duty?</label><select id="wizardDutyIsPunishment"><option value="false">No</option><option value="true">Yes (Red styling)</option></select></div>
    </div>`;

  const footer = modal.querySelector(".modal-footer");
  footer.innerHTML = `<button class="btn btn-secondary" onclick="goToWizardStep1()">← Previous</button><button class="btn btn-secondary" onclick="closeModal('sectorModal')">Cancel</button><button class="btn btn-primary" onclick="saveLeafWizard()">💾 Save Leaf Sector</button>`;
}

function goToWizardStep1() {
  const modal = document.getElementById("sectorModal");
  modal.querySelector(".modal-header h3").textContent =
    "📄 New Leaf Sector – Step 1 of 2";
  modal.querySelector(".modal-body").innerHTML = `
    <div style="padding:4px 0;"><div class="wizard-steps"><span class="wizard-step active">1. Basic Info</span><span class="wizard-step-sep">›</span><span class="wizard-step">2. Duty Settings</span></div>
      <div class="form-group"><label>Name *</label><input type="text" id="wizardSectorName" value="${
        window._wizardName || ""
      }"></div>
      <div class="form-group"><label>Minimum People Required *</label><input type="number" id="wizardSectorMin" value="${
        window._wizardMin || 1
      }" min="1"></div>
      <div class="form-group"><label>Description (optional)</label><textarea id="wizardSectorDesc">${
        window._wizardDesc || ""
      }</textarea></div>
    </div>`;
  modal.querySelector(
    ".modal-footer"
  ).innerHTML = `<button class="btn btn-secondary" onclick="closeModal('sectorModal')">Cancel</button><button class="btn btn-primary" onclick="goToWizardStep2()">Next →</button>`;
}

async function saveLeafWizard() {
  if (!window._wizardCategoryId || !window._wizardName) {
    Swal.fire("Error", "Wizard session lost. Please try again.", "error");
    closeModal("sectorModal");
    return;
  }

  const dutyNameEl = document.getElementById("wizardDutyName");
  const startEl = document.getElementById("wizardDutyStart");
  const endEl = document.getElementById("wizardDutyEnd");
  if (!dutyNameEl || !startEl || !endEl) {
    Swal.fire("Error", "Something went wrong. Please start over.", "error");
    closeModal("sectorModal");
    return;
  }

  const dutyName = dutyNameEl.value.trim();
  const start = startEl.value;
  const end = endEl.value;
  const days = [];
  document.querySelectorAll(".wizard-duty-day:checked").forEach((cb) => days.push(cb.value));

  if (!dutyName || !start || !end) { /* … */ return; }
  if (start >= end) { /* … */ return; }
  if (days.length === 0) { /* … */ return; }

  const recurrence = document.getElementById("wizardDutyRecurrence").value;
  const isPunishment = document.getElementById("wizardDutyIsPunishment").value === "true";
  const endDate = document.getElementById("wizardDutyEndDate").value || null;
  const interval = recurrence === "biweekly"
    ? parseInt(document.getElementById("wizardRecurrenceInterval").value) || 1
    : null;
  const specificDates = recurrence === "specific" ? [...wizardSpecificDatesList] : null;

  const newSector = { /* … same as before … */ };
  const savedSector = await saveEntity("sectors", newSector);

  const newDuty = {
    name: dutyName,
    start_time: start,
    end_time: end,
    days,
    recurrence_type: recurrence,
    specific_dates: specificDates,
    recurrence_interval: interval,
    end_date: endDate || null,
    is_punishment: isPunishment,
    sector_id: savedSector.id,
    created_by: appData.current_user,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const savedDuty = await saveEntity("duties", newDuty);

  // ★ Replace existing duty for this sector (by ID) instead of pushing a duplicate
  const existingIdx = appData.duties.findIndex(d => d.sector_id === savedSector.id && d.name === dutyName);
  if (existingIdx !== -1) {
    appData.duties[existingIdx] = { ...savedDuty, id: savedDuty._id };
  } else {
    appData.duties.push({ ...savedDuty, id: savedDuty._id });
  }

  appData.sectors.push(savedSector);
  currentSectorPath = [window._wizardCategoryId];
  selectedLeafId = savedSector.id;

  // … rest of the function (clear wizard vars, close modal, etc.) …
}

// ============================================
// DUTY ATTENDANCE VIEW (viewingDutyId)
// ============================================
function viewDutyAttendance(dutyId) {
  viewingDutyId = dutyId;
  const duty = appData.duties.find((d) => d.id === dutyId);
  if (!duty) return;
  document.getElementById(
    "dutyAttendanceTitle"
  ).textContent = `📋 ${duty.name} - Attendance`;
  document.getElementById("dutyAttendanceFilter").value = "today";
  document.getElementById("customDateRange").style.display = "none";
  renderDutyAttendance();
  openModal("dutyAttendanceModal");
}

function toggleDutyView() {
  isCalendarView = !isCalendarView;
  renderDuties();
}

function renderDutyAttendance() {
  const filter = document.getElementById("dutyAttendanceFilter").value;
  const dutyId = viewingDutyId;
  const duty = appData.duties.find((d) => d.id === dutyId);
  if (!duty) return;
  let startDate, endDate;
  const today = getToday();
  if (filter === "today") {
    startDate = today;
    endDate = today;
  } else if (filter === "week") {
    const w = getWeekDates();
    startDate = w[0];
    endDate = w[6];
  } else if (filter === "month") {
    const d = new Date();
    startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-01`;
    endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(getDaysInMonth(d.getFullYear(), d.getMonth() + 1)).padStart(
      2,
      "0"
    )}`;
  } else if (filter === "custom") {
    startDate = document.getElementById("dutyAttendanceStart").value;
    endDate = document.getElementById("dutyAttendanceEnd").value;
    if (!startDate || !endDate) return;
  }
  const instances = appData.duty_instances.filter(
    (di) =>
      di.duty_id === dutyId &&
      di.date >= startDate &&
      di.date <= endDate &&
      di.is_active
  );
  const container = document.getElementById("dutyAttendanceContainer");
  if (!instances.length) {
    container.innerHTML = '<p class="text-muted">No duties in range.</p>';
    return;
  }
  const grouped = {};
  instances.forEach((di) => {
    const k = di.date;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(di);
  });
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  let html = "";
  dates.forEach((date) => {
    html += `<div class="duty-attendance-group"><div class="group-header">${formatDateFull(
      date
    )}<div class="controls"><button class="btn btn-secondary btn-sm" onclick="selectAllDutyAttendance('${dutyId}','${date}',true)">Select All</button><button class="btn btn-secondary btn-sm" onclick="selectAllDutyAttendance('${dutyId}','${date}',false)">Unselect All</button></div></div>`;
    grouped[date].forEach((di) => {
      const records = appData.attendance.filter(
        (a) => a.duty_instance_id === di.id
      );
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;border-bottom:1px solid var(--border);"><div style="font-size:13px;min-width:60px;">${formatTime(
        duty.start_time
      )}</div><div style="display:flex;flex-wrap:wrap;gap:4px;flex:1;">${records
        .map((r) => {
          const lib = getLib(r.librarian_id);
          if (!lib) return "";
          const status = r.attended || r.forgiven;
          return `<label style="display:flex;align-items:center;gap:4px;padding:2px 10px;border-radius:var(--radius-sm);cursor:pointer;font-size:13px;${
            status
              ? "background:#dcfce7;border:1px solid #86efac"
              : "background:var(--bg);border:1px solid var(--border)"
          }"><input type="checkbox" class="duty-attendance-check" data-record="${
            r.id
          }" ${status ? "checked" : ""} onchange="updateDutyAttendance('${
            r.id
          }',this.checked)"> ${lib.name}</label>`;
        })
        .join("")}</div></div>`;
    });
    html += `</div>`;
  });
  container.innerHTML = html;
}

async function updateDutyAttendance(recordId, checked) {
  const record = appData.attendance.find((a) => a.id === recordId);
  if (!record) return;
  record.attended = checked;
  if (checked) record.forgiven = false;
  record.confirmed_at = new Date().toISOString();
  record.confirmed_by = appData.current_user;
  await saveEntity("attendance", record, record.id);
  renderDutyAttendance();
}

async function selectAllDutyAttendance(dutyId, date, sel) {
  const instances = appData.duty_instances.filter(
    (di) => di.duty_id === dutyId && di.date === date && di.is_active
  );
  for (const di of instances) {
    const records = appData.attendance.filter(
      (a) => a.duty_instance_id === di.id
    );
    for (const r of records) {
      r.attended = sel;
      if (sel) r.forgiven = false;
      r.confirmed_at = new Date().toISOString();
      r.confirmed_by = appData.current_user;
      await saveEntity("attendance", r, r.id);
    }
  }
  await generateMissedNotifications();
  renderDutyAttendance();
  toast(sel ? "All present" : "All absent");
}

function getWeekDates() {
  const today = getToday();
  const d = new Date(today);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    week.push(date.toISOString().split("T")[0]);
  }
  return week;
}
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// ============================================
// EDIT DUTY (full async implementation)
// ============================================
function editDuty(dutyId) {
  const duty = appData.duties.find((d) => d.id === dutyId);
  if (!duty) return;
  editingDutyId = dutyId;

  const recurrence = duty.recurrence_type;
  document.getElementById("editDutyContent").innerHTML = `
    <div class="form-group"><label>Duty Name</label><input type="text" id="editDutyName" value="${
      duty.name
    }"></div>
    <div class="form-row">
      <div class="form-group"><label>Start Time</label><input type="time" id="editDutyStart" value="${
        duty.start_time
      }"></div>
      <div class="form-group"><label>End Time</label><input type="time" id="editDutyEnd" value="${
        duty.end_time
      }"></div>
    </div>
    <div class="form-group">
      <label>Days</label>
      <div class="day-checkboxes">
        ${[
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ]
          .map(
            (d) =>
              `<label><input type="checkbox" class="edit-duty-day" value="${d}" ${
                duty.days.includes(d) ? "checked" : ""
              }> ${d.slice(0, 3)}</label>`
          )
          .join("")}
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Recurrence</label>
        <select id="editDutyRecurrence" onchange="toggleEditRecurrenceOptions()">
          <option value="weekly" ${
            recurrence === "weekly" ? "selected" : ""
          }>Weekly</option>
          <option value="biweekly" ${
            recurrence === "biweekly" ? "selected" : ""
          }>After X Weeks</option>
          <option value="forever" ${
            recurrence === "forever" ? "selected" : ""
          }>Forever</option>
          <option value="specific" ${
            recurrence === "specific" ? "selected" : ""
          }>Specific Dates</option>
        </select>
      </div>
      <div class="form-group" id="editRecurrenceExtra" style="display:${
        recurrence === "biweekly" ? "block" : "none"
      };">
        <label>After how many weeks?</label>
        <input type="number" id="editRecurrenceInterval" value="${
          duty.recurrence_interval || 1
        }" min="1">
      </div>
    </div>
    <div class="form-group" id="editSpecificDatesContainer" style="display:${
      recurrence === "specific" ? "block" : "none"
    };">
      <label>Specific Dates</label>
      <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
        <input type="date" id="editSpecificDateInput" style="flex:1; min-width:150px;">
        <button class="btn btn-secondary btn-sm" onclick="addEditSpecificDate()">+ Add Date</button>
      </div>
      <div id="editSpecificDatesList" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;">
        ${(duty.specific_dates || [])
          .map(
            (d) =>
              `<span style="display:inline-flex;gap:4px;padding:2px 10px;background:#f8fafc;border-radius:12px;">${formatDate(
                d
              )} <span onclick="removeEditSpecificDate('${d}')" style="cursor:pointer;color:#e53e3e;">×</span></span>`
          )
          .join("")}
      </div>
    </div>
    <div class="form-group">
      <label>End Date (optional)</label>
      <input type="date" id="editDutyEndDate" value="${duty.end_date || ""}">
    </div>
    <div class="form-group">
      <label>Punishment Duty?</label>
      <select id="editDutyIsPunishment">
        <option value="false" ${
          !duty.is_punishment ? "selected" : ""
        }>No</option>
        <option value="true" ${
          duty.is_punishment ? "selected" : ""
        }>Yes</option>
      </select>
    </div>
    <div class="form-group">
      <label>Assign to Junior Librarians</label>
      <div id="editDutyLibrarianCheckboxes" style="padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); margin:6px 0;"></div>
      <div id="editDutySelectAllBtns" style="display:flex; gap:8px; margin-top:4px;">
        <button class="btn btn-secondary btn-sm" onclick="selectAllEditDutyLibrarians(true)">Select All</button>
        <button class="btn btn-secondary btn-sm" onclick="selectAllEditDutyLibrarians(false)">Clear All</button>
      </div>
    </div>
  `;

  if (duty.sector_id) {
   const sector = getSector(duty.sector_id);
const sectorPath = sector ? getSectorPath(sector.id) : "the sector";
document.getElementById("editDutyLibrarianCheckboxes").innerHTML = `
  <p class="text-muted" style="padding:10px;">
    📌 Librarians are inherited from <strong>${sectorPath}</strong>.<br>
    To change them, edit the sector assignments.
  </p>`;
    const selectBtns = document.getElementById("editDutySelectAllBtns");
    if (selectBtns) selectBtns.style.display = "none";
  } else {
    const container = document.getElementById("editDutyLibrarianCheckboxes");
    const librarians = appData.librarians.filter((l) => !l.is_deleted);
    const assignedIds = appData.duty_instances
      .filter((di) => di.duty_id === dutyId)
      .flatMap((di) =>
        appData.attendance
          .filter((a) => a.duty_instance_id === di.id)
          .map((a) => a.librarian_id)
      )
      .filter((v, i, a) => a.indexOf(v) === i);

    let html = `<table><thead><tr><th>Select</th><th>Name</th><th>Grade</th><th>Adm No.</th><th>House</th></tr></thead><tbody>`;
    librarians.forEach((l) => {
      html += `<tr><td><input type="checkbox" class="edit-duty-lib-check" value="${
        l.id
      }" ${assignedIds.includes(l.id) ? "checked" : ""}></td><td>${
        l.name
      }</td><td>${l.grade}</td><td>${l.adm_no}</td><td>${
        l.house || "—"
      }</td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
  }

  editSpecificDatesList = [...(duty.specific_dates || [])];
  window._originalDuty = JSON.parse(JSON.stringify(duty));

  openModal("editDutyModal");
}

async function saveEditDuty() {
  const duty = appData.duties.find((d) => d.id === editingDutyId);
  if (!duty) return;

  const name = document.getElementById("editDutyName").value.trim();
  const start = document.getElementById("editDutyStart").value;
  const end = document.getElementById("editDutyEnd").value;
  const recurrence = document.getElementById("editDutyRecurrence").value;
  const isPunishment = document.getElementById("editDutyIsPunishment").value === "true";
  const endDate = document.getElementById("editDutyEndDate").value || null;
  const interval = recurrence === "biweekly"
    ? parseInt(document.getElementById("editRecurrenceInterval").value) || 1
    : null;
  const days = [];
  document.querySelectorAll(".edit-duty-day:checked").forEach((cb) => days.push(cb.value));

  if (!name || !start || !end || days.length === 0) {
    Swal.fire("Error", "Fill name, start, end, and select days.", "error");
    return;
  }
  if (start >= end) {
    Swal.fire("Error", "End must be after start.", "error");
    return;
  }

  let libs = [];
  if (duty.sector_id) {
    libs = getSectorPeople(duty.sector_id).map((p) => p.id);
    if (libs.length === 0) {
      Swal.fire("Error", "The linked sector has no librarians. Assign some first.", "error");
      return;
    }
  } else {
    document.querySelectorAll(".edit-duty-lib-check:checked").forEach((cb) => libs.push(cb.value));
    if (!libs.length) {
      Swal.fire("Error", "Select at least one librarian.", "error");
      return;
    }
  }

  showConfirm(
    "⚠️ Confirm Changes",
    `<p>Editing <strong>${duty.name}</strong> will affect <strong>ALL FUTURE instances</strong>. Past instances remain unchanged.</p>`,
    async () => {
      // Lock background sync for the entire save sequence
      isSaving = true;
      showLoading();
      Swal.fire({
        title: "Saving duty...",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      try {
        // 1. Update duty properties
        duty.name = name;
        duty.start_time = start;
        duty.end_time = end;
        duty.days = days;
        duty.recurrence_type = recurrence;
        duty.recurrence_interval = interval;
        duty.specific_dates = recurrence === "specific" ? [...editSpecificDatesList] : null;
        duty.end_date = endDate;
        duty.is_punishment = isPunishment;
        duty.updated_at = new Date().toISOString();

        // 2. Delete all future instances and their attendance
        const futureInsts = appData.duty_instances.filter(
          (di) => di.duty_id === duty.id && di.date >= getToday()
        );

        for (const inst of futureInsts) {
          await deleteEntity("attendance/by-instance", inst.id);
          appData.attendance = appData.attendance.filter(
            (a) => a.duty_instance_id !== inst.id
          );
          await deleteEntity("duties/instances", inst.id);
        }

        appData.duty_instances = appData.duty_instances.filter(
          (di) => !(di.duty_id === duty.id && di.date >= getToday())
        );

        // 3. Save the updated duty
        await saveEntity("duties", duty, duty.id);

        // 4. Create today's instance with the new librarian set
        const today = getToday();
        if (dutyOccursOnDate(duty, today)) {
          const newInst = {
            duty_id: duty.id,
            date: today,
            is_active: true,
            created_at: new Date().toISOString(),
          };
          const savedInst = await saveEntity("duties/instances", newInst);
          appData.duty_instances.push(savedInst);

          for (const libId of libs) {
            const att = {
              duty_instance_id: savedInst.id,
              librarian_id: libId,
              attended: false,
              confirmed_by: "system",
              confirmed_at: new Date().toISOString(),
              forgiven: false,
              punishment_issued: false,
            };
            const savedAtt = await saveEntity("attendance", att);
            appData.attendance.push(savedAtt);
            recalcAttendancePct(libId); 
          }
        }

        Swal.close();
        closeModal("editDutyModal");
        renderCurrentPage();
        updateDutyBadge();
        toast("Duty updated – today’s instance has been refreshed.");
      } catch (err) {
        Swal.close();
        console.error(err);
        toast("Error saving duty. Please try again.");
      } finally {
        isSaving = false;
        hideLoading();
      }
    }
  );
}

function toggleRecurrenceOptions() {
  const rec = document.getElementById("dutyRecurrence").value;
  document.getElementById("recurrenceExtra").style.display =
    rec === "biweekly" ? "block" : "none";
  document.getElementById("specificDatesContainer").style.display =
    rec === "specific" ? "block" : "none";
}

// Edit duty helpers (toggle, add/remove specific dates, select all)
function toggleEditRecurrenceOptions() {
  const rec = document.getElementById("editDutyRecurrence").value;
  document.getElementById("editRecurrenceExtra").style.display =
    rec === "biweekly" ? "block" : "none";
  document.getElementById("editSpecificDatesContainer").style.display =
    rec === "specific" ? "block" : "none";
}
function addEditSpecificDate() {
  const input = document.getElementById("editSpecificDateInput");
  const date = input.value;
  if (!date) return;
  if (editSpecificDatesList.includes(date)) {
    Swal.fire("Error", "Date already added.", "error");
    return;
  }
  editSpecificDatesList.push(date);
  renderEditSpecificDates();
  input.value = "";
}
function removeEditSpecificDate(date) {
  editSpecificDatesList = editSpecificDatesList.filter((d) => d !== date);
  renderEditSpecificDates();
}
function renderEditSpecificDates() {
  const container = document.getElementById("editSpecificDatesList");
  container.innerHTML = editSpecificDatesList
    .map(
      (d) =>
        `<span style="display:inline-flex;gap:4px;padding:2px 10px;background:#f8fafc;border-radius:12px;">${formatDate(
          d
        )} <span onclick="removeEditSpecificDate('${d}')" style="cursor:pointer;color:#e53e3e;">×</span></span>`
    )
    .join("");
}
function selectAllEditDutyLibrarians(sel) {
  document
    .querySelectorAll(".edit-duty-lib-check")
    .forEach((cb) => (cb.checked = sel));
}

// Delete Duty
async function deleteDuty(dutyId) {
  const duty = appData.duties.find((d) => d.id === dutyId);
  if (!duty) return;

  showConfirm(
    "Stop / Delete Duty",
    `<div>
      <p>What would you like to do with <strong>${duty.name}</strong>?</p>
      <div class="confirm-warning">
        <strong>🛑 Stop future occurrences</strong>
        <ul>
          <li>The duty will no longer be created for today or any future date.</li>
          <li>Past attendance records will <strong>remain unchanged</strong> and the duty will still appear in history with its name.</li>
          <li>The duty will be marked as “Ended” in the duty list.</li>
        </ul>
        <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:14px;">
          <input type="checkbox" id="clearDutyHistory" />
          <strong>Permanently delete</strong> – also erase all past attendance records and the duty itself (cannot be undone).
        </label>
      </div>
    </div>`,
    async () => {
      showLoading();
      try {
        const clearHistory =
          document.getElementById("clearDutyHistory")?.checked || false;

        if (clearHistory) {
          // --- Permanently delete everything ---
          const allInstances = appData.duty_instances.filter(
            (di) => di.duty_id === dutyId
          );

          // 1. Delete attendance for ALL instances
          for (const inst of allInstances) {
            await deleteEntity("attendance/by-instance", inst.id);
          }
          // 2. Delete all instances
          for (const inst of allInstances) {
            await deleteEntity("duties/instances", inst.id);
          }
          // 3. Delete the duty itself
          await deleteEntity("duties", dutyId);

          // 4. Update local cache ONLY after all server calls succeeded
          // Remove attendance records for this duty
          appData.attendance = appData.attendance.filter(
            (a) => !allInstances.some((inst) => inst.id === a.duty_instance_id)
          );
          // Remove instances
          appData.duty_instances = appData.duty_instances.filter(
            (di) => di.duty_id !== dutyId
          );
          // Remove the duty
          appData.duties = appData.duties.filter((d) => d.id !== dutyId);

          // Recalculate percentages for affected librarians
          const affectedLibIds = new Set();
          allInstances.forEach(inst => {
            appData.attendance
              .filter(a => a.duty_instance_id === inst.id)
              .forEach(a => affectedLibIds.add(a.librarian_id));
          });
          affectedLibIds.forEach(id => recalcAttendancePct(id));
        } else {
          // --- Stop future occurrences ---
          const today = getToday();
          const d = new Date(today);
          d.setDate(d.getDate() - 1);
          const yesterday = d.toISOString().split("T")[0];

          // 1. Set end_date on the server
          duty.end_date = yesterday;
          await saveEntity("duties", duty, duty.id);

          // 2. Delete future instances and their attendance
          const futureInsts = appData.duty_instances.filter(
            (di) => di.duty_id === dutyId && di.date >= today
          );
          for (const inst of futureInsts) {
            await deleteEntity("attendance/by-instance", inst.id);
          }
          for (const inst of futureInsts) {
            await deleteEntity("duties/instances", inst.id);
          }

          // 3. Update local cache – remove future attendance and instances, keep the duty (now with end_date)
          appData.attendance = appData.attendance.filter(
            (a) => !futureInsts.some((inst) => inst.id === a.duty_instance_id)
          );
          appData.duty_instances = appData.duty_instances.filter(
            (di) => !(di.duty_id === dutyId && di.date >= today)
          );
          // Duty stays in appData.duties – it's just "Ended"

          // Recalculate percentages for affected librarians
          const affectedLibIds = new Set();
          futureInsts.forEach(inst => {
            appData.attendance
              .filter(a => a.duty_instance_id === inst.id)
              .forEach(a => affectedLibIds.add(a.librarian_id));
          });
          affectedLibIds.forEach(id => recalcAttendancePct(id));
        }

        saveData();
        renderCurrentPage();
        updateDutyBadge();
        toast(
          clearHistory
            ? "Duty permanently deleted."
            : "Duty stopped – past records preserved."
        );
      } catch (err) {
        console.error(err);
        toast("Action failed – your data has been kept as it was.");
      } finally {
        hideLoading();
      }
    }
  );
}
// ============================================
// ATTENDANCE (past & today only)
// ============================================
let attendanceDateTimeout;
async function changeAttendanceDate(delta) {
  const input = document.getElementById("attendanceDate");
  const current = new Date(input.value);
  const today = new Date(getToday());

  const newDate = new Date(current);
  newDate.setDate(newDate.getDate() + delta);

  // Prevent going past today
  if (newDate > today) {
    if (current.getTime() === today.getTime()) {
      toast("You can't view future attendance.");
    } else {
      input.value = getToday();
      await renderAttendance();
      toast("You can't view future dates. Showing today.");
    }
    return;
  }

  input.value = newDate.toISOString().split("T")[0];

  // Debounce the actual render – wait 200ms after the last click
  clearTimeout(attendanceDateTimeout);
  attendanceDateTimeout = setTimeout(async () => {
    await renderAttendance();
  }, 200);
}

async function renderAttendance() {
  const dateInput = document.getElementById("attendanceDate");
  let date = dateInput.value || getToday();
  dateInput.value = date;
  dateInput.max = getToday();
  if (date > getToday()) {
    document.getElementById("attendanceContainer").innerHTML =
      '<p class="text-muted">Cannot view future dates.</p>';
    return;
  }

  await generateDutyInstancesForDate(date);

  const instances = appData.duty_instances.filter(
    (di) => di.date === date && di.is_active
  );

  const container = document.getElementById("attendanceContainer");
  if (!instances.length) {
    container.innerHTML = '<p class="text-muted">No duties on this date.</p>';
    return;
  }

  // ---- Sticky tabs wrapper ----
  let html = `<div style="position:sticky; top:0; z-index:20; background:var(--bg); padding:8px 0 4px 0;">
    <div class="sector-tabs" style="display:flex; flex-wrap:wrap; gap:6px;">`;

  instances.forEach((di, idx) => {
    const duty = appData.duties.find((d) => d.id === di.duty_id);
    if (!duty) return;
    const records = appData.attendance.filter((a) => a.duty_instance_id === di.id);
    const attended = records.filter((r) => r.attended || r.forgiven).length;
    html += `<div class="sector-tab ${idx === 0 ? 'active' : ''}" 
                  onclick="switchAttendanceDutyTab('${di.id}')" 
                  data-instance="${di.id}">
               ${duty.name}
               <span class="count-badge">${attended}/${records.length}</span>
             </div>`;
  });
  html += `</div></div>`;

  // ---- Table wrapper ----
  html += `<div id="attendanceTableWrapper">${renderAttendanceTable(instances[0].id)}</div>`;

  container.innerHTML = html;
}
async function saveAttendance() {
  let saved = 0;
  const promises = [];
  document.querySelectorAll(".attendance-check").forEach((cb) => {
    const rec = appData.attendance.find((a) => a.id === cb.dataset.record);
    if (rec && rec.attended !== cb.checked) {
      rec.attended = cb.checked;
      rec.forgiven = false;
      rec.confirmed_at = new Date().toISOString();
      rec.confirmed_by = appData.current_user;
      promises.push(saveEntity("attendance", rec, rec.id));
      saved++;
    }
  });
  await Promise.all(promises);
  if (saved) {
    await generateMissedNotifications();
    updateDutyBadge();
    saveData();
    renderAttendance();
    renderNotifications();
    syncLocalNotifications();
    if (currentPage === "notifications") {
      renderNotifications();
    }
    toast(`Saved ${saved} records.`);
  } else toast("No changes.");
}

function switchAttendanceDutyTab(instanceId) {
  // Highlight the active tab
  document.querySelectorAll("#attendanceContainer .sector-tab").forEach(tab => {
    tab.classList.remove("active");
    if (tab.dataset.instance === instanceId) tab.classList.add("active");
  });
  // Render the table for the selected duty
  const wrapper = document.getElementById("attendanceTableWrapper");
  wrapper.innerHTML = renderAttendanceTable(instanceId);
}

function renderAttendanceTable(instanceId) {
  const records = appData.attendance.filter((a) => a.duty_instance_id === instanceId);
  const instance = appData.duty_instances.find((di) => di.id === instanceId);
  const duty = instance ? appData.duties.find((d) => d.id === instance.duty_id) : null;
  if (!duty || !records.length) return '<p class="text-muted">No records.</p>';

  // ---------- SORT ----------
  const sortState = attendanceSortState[instanceId] || { key: "name", dir: "asc" };
  const sortedRecords = [...records].sort((a, b) => {
    const libA = getLib(a.librarian_id);
    const libB = getLib(b.librarian_id);
    let valA, valB;
    switch (sortState.key) {
      case "name":
        valA = (libA?.name || "").toLowerCase();
        valB = (libB?.name || "").toLowerCase();
        break;
      case "grade":
        valA = (libA?.grade || "").toLowerCase();
        valB = (libB?.grade || "").toLowerCase();
        break;
      case "adm":
        valA = (libA?.adm_no || "").toLowerCase();
        valB = (libB?.adm_no || "").toLowerCase();
        break;
      case "house":
        valA = (libA?.house || "").toLowerCase();
        valB = (libB?.house || "").toLowerCase();
        break;
      case "status":
        valA = a.attended || a.forgiven ? 1 : 0;
        valB = b.attended || b.forgiven ? 1 : 0;
        break;
      default:
        return 0;
    }
    if (valA < valB) return sortState.dir === "asc" ? -1 : 1;
    if (valA > valB) return sortState.dir === "asc" ? 1 : -1;
    return 0;
  });

  // ---------- HTML ----------
  const attendedCount = records.filter(r => r.attended || r.forgiven).length;
  const sortArrow = (key) => {
    if (sortState.key !== key) return "";
    return sortState.dir === "asc" ? " ▲" : " ▼";
  };

  const hasLastAction = !!lastAttendanceAction[instanceId];

  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <div>
        <strong>${duty.name}</strong>
        <span style="font-size:13px; color:var(--text-secondary); margin-left:8px;">
          ${formatTime(duty.start_time)} – ${formatTime(duty.end_time)}
        </span>
        <span style="font-size:13px; margin-left:8px;" id="attendanceCount_${instanceId}">
          ${attendedCount}/${records.length} attended
        </span>
      </div>
      <div>
        <input type="text" id="attendanceSearch_${instanceId}" 
               placeholder="Search librarian…" 
               oninput="filterAttendanceTable('${instanceId}')"
               style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; width:180px;" />
        <button class="btn btn-secondary btn-sm" onclick="selectAllAttendance('${instanceId}', true)">✅ All Present</button>
        <button class="btn btn-secondary btn-sm" onclick="selectAllAttendance('${instanceId}', false)">❌ All Absent</button>
        <button class="btn btn-secondary btn-sm" onclick="undoLastAttendance('${instanceId}')" 
                ${hasLastAction ? '' : 'disabled'} 
                title="Undo last action">↩️ Undo</button>
      </div>
    </div>
    <table style="width:100%; font-size:13px; border-collapse:collapse;">
      <thead>
        <tr style="background:#f8fafc; position:sticky; top:48px; z-index:10;">
          <th style="padding:8px 10px; text-align:left; cursor:pointer;" onclick="sortAttendanceTable('${instanceId}', 'name')">Name${sortArrow('name')}</th>
          <th style="padding:8px 10px; text-align:left; cursor:pointer;" onclick="sortAttendanceTable('${instanceId}', 'grade')">Grade${sortArrow('grade')}</th>
          <th style="padding:8px 10px; text-align:left; cursor:pointer;" onclick="sortAttendanceTable('${instanceId}', 'adm')">Adm No.${sortArrow('adm')}</th>
          <th style="padding:8px 10px; text-align:left; cursor:pointer;" onclick="sortAttendanceTable('${instanceId}', 'house')">House${sortArrow('house')}</th>
          <th style="padding:8px 10px; text-align:center; cursor:pointer;" onclick="sortAttendanceTable('${instanceId}', 'status')">Status${sortArrow('status')}</th>
        </tr>
      </thead>
      <tbody id="attendanceTableBody_${instanceId}">
  `;

  sortedRecords.forEach((r) => {
    const lib = getLib(r.librarian_id);
    if (!lib) return;
    const isPresent = r.attended || r.forgiven;
    const rowBg = isPresent ? "#f0fdf4" : "#fef2f2";

    html += `
      <tr class="attendance-row" data-lib-name="${lib.name.toLowerCase()}" data-lib-adm="${lib.adm_no.toLowerCase()}"
          style="background:${rowBg}; cursor:pointer;"
          onclick="toggleAttendanceRow(this, '${instanceId}')">
        <td>${lib.name}</td>
        <td>${lib.grade}</td>
        <td>${lib.adm_no}</td>
        <td>${lib.house || "—"}</td>
        <td style="text-align:center;">
          <span class="attendance-status-badge" style="display:inline-block; padding:2px 12px; border-radius:12px; font-size:12px; font-weight:600; 
                ${isPresent ? "background:#dcfce7; color:#166534;" : "background:#fee2e2; color:#991b1b;"}">
            ${isPresent ? "Present" : "Absent"}
          </span>
        </td>
      </tr>`;
  });

  html += `
      </tbody>
    </table>`;
  return html;
}
function filterAttendanceTable(instanceId) {
  const searchTerm = document.getElementById(`attendanceSearch_${instanceId}`).value.toLowerCase();
  const rows = document.querySelectorAll(`#attendanceTableBody_${instanceId} .attendance-row`);
  rows.forEach(row => {
    const name = row.dataset.libName;
    const adm = row.dataset.libAdm;
    row.style.display = (name.includes(searchTerm) || adm.includes(searchTerm)) ? "" : "none";
  });
}

// Toggle attendance by clicking anywhere on the row (except the checkbox itself)
function toggleAttendanceRow(row, instanceId) {
  const checkbox = row.querySelector(".attendance-check");
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
  }
}

// Sort the attendance table by a given column
function sortAttendanceTable(instanceId, key) {
  const current = attendanceSortState[instanceId] || { key: "name", dir: "asc" };
  if (current.key === key) {
    current.dir = current.dir === "asc" ? "desc" : "asc";
  } else {
    current.key = key;
    current.dir = "asc";
  }
  attendanceSortState[instanceId] = current;
  // Re-render the table for this instance
  const wrapper = document.getElementById("attendanceTableWrapper");
  if (wrapper) {
    wrapper.innerHTML = renderAttendanceTable(instanceId);
  }
}

function toggleSelectAllAttendance(instanceId, checked) {
  const checkboxes = document.querySelectorAll(`#attendanceTableBody_${instanceId} .attendance-check`);
  checkboxes.forEach(cb => {
    if (cb.checked !== checked) {
      cb.checked = checked;
      cb.dispatchEvent(new Event('change'));
    }
  });
}

function updateAttendanceTabBadge(instanceId) {
  const tab = document.querySelector(`.sector-tab[data-instance="${instanceId}"]`);
  if (!tab) return;
  const records = appData.attendance.filter(a => a.duty_instance_id === instanceId);
  const attended = records.filter(r => r.attended || r.forgiven).length;
  const badge = tab.querySelector(".count-badge");
  if (badge) badge.textContent = `${attended}/${records.length}`;
}

function filterAttendanceTable(instanceId) {
  const searchTerm = document.getElementById(`attendanceSearch_${instanceId}`).value.toLowerCase();
  const rows = document.querySelectorAll(`#attendanceTableBody_${instanceId} .attendance-row`);
  rows.forEach(row => {
    const name = row.dataset.libName;
    const adm = row.dataset.libAdm;
    row.style.display = (name.includes(searchTerm) || adm.includes(searchTerm)) ? "" : "none";
  });
}

function toggleSelectAllAttendance(instanceId, checked) {
  const checkboxes = document.querySelectorAll(`#attendanceTableBody_${instanceId} .attendance-check`);
  checkboxes.forEach(cb => {
    if (cb.checked !== checked) {
      cb.checked = checked;
      cb.dispatchEvent(new Event('change'));
    }
  });
}

function updateAttendanceTabBadge(instanceId) {
  const tab = document.querySelector(`.sector-tab[data-instance="${instanceId}"]`);
  if (!tab) return;
  const records = appData.attendance.filter(a => a.duty_instance_id === instanceId);
  const attended = records.filter(r => r.attended || r.forgiven).length;
  const badge = tab.querySelector(".count-badge");
  if (badge) badge.textContent = `${attended}/${records.length}`;
}

async function selectAllAttendance(instId, attended) {
  const records = appData.attendance.filter(
    (a) => a.duty_instance_id === instId
  );

  records.forEach((r) => {
    r.attended = attended;
    r.forgiven = false;
    r.confirmed_at = new Date().toISOString();
    r.confirmed_by = appData.current_user;
    recalcAttendancePct(r.librarian_id);
  });

  // Write to localStorage immediately
  saveData();

  // ★ Remember this bulk action as the last action for this duty
  lastAttendanceAction[instId] = { type: 'bulk', attended };

  // Refresh only the visible table content if we are on the attendance page
  if (currentPage === "attendance") {
    const activeTab = document.querySelector("#attendanceContainer .sector-tab.active");
    const activeInstanceId = activeTab?.dataset.instance;
    if (activeInstanceId === instId) {
      const wrapper = document.getElementById("attendanceTableWrapper");
      if (wrapper) wrapper.innerHTML = renderAttendanceTable(instId);
    }
    updateAttendanceTabBadge(instId);
  }

  updateDutyBadge();
  syncLocalNotifications();
  if (currentPage === "notifications") {
    renderNotifications();
  }

  toast(`All marked ${attended ? "present" : "absent"}.`);

  records.forEach((r) => pendingAttendanceSaves.set(r.id, r));
  if (attendanceBatchTimer) clearTimeout(attendanceBatchTimer);
  attendanceBatchTimer = setTimeout(flushAttendanceSaves, 300);
  showLoading();
}

async function flushAttendanceSaves() {
  const recordsToSave = Array.from(pendingAttendanceSaves.values());
  pendingAttendanceSaves.clear();
  attendanceBatchTimer = null;

  let hadError = false;

  const promises = recordsToSave.map((r) =>
    saveEntity("attendance", r, r.id, true)
      .then(() => {
        recalcAttendancePct(r.librarian_id);
      })
      .catch((err) => {
        console.error("Failed to save attendance record", r.id, err);
        hadError = true;
      })
  );
  await Promise.all(promises);

  if (hadError) {
    toast("⚠️ Some changes could not be saved. Please try again.");
  }

  await generateMissedNotifications();
  hideLoading();   // hide loading bar after all saves complete
}

async function toggleSingleAttendance(recordId, checkbox) {
  const rec = appData.attendance.find((a) => a.id === recordId);
  if (!rec) return;

  const newChecked = checkbox.checked;
  rec.attended = newChecked;
  rec.forgiven = false;
  rec.confirmed_at = new Date().toISOString();
  rec.confirmed_by = appData.current_user;

  // ★ Update the pre‑computed percentage
  recalcAttendancePct(rec.librarian_id);

  // ★ Write the change to localStorage immediately
  saveData();

  // ★ Update the inline status badge (new table layout)
  const row = checkbox.closest('tr');
  if (row) {
    const badge = row.querySelector('.attendance-status-badge');
    if (badge) {
      if (newChecked) {
        badge.textContent = 'Present';
        badge.style.background = '#dcfce7';
        badge.style.color = '#166534';
      } else {
        badge.textContent = 'Absent';
        badge.style.background = '#fee2e2';
        badge.style.color = '#991b1b';
      }
    }
  }

  // ★ Update the duty tab's attendance count
  const instanceId = rec.duty_instance_id;
  updateAttendanceTabBadge(instanceId);

  // Also update the count text inside the table header
  const countEl = document.getElementById(`attendanceCount_${instanceId}`);
  if (countEl) {
    const records = appData.attendance.filter(a => a.duty_instance_id === instanceId);
    const attended = records.filter(r => r.attended || r.forgiven).length;
    countEl.textContent = `${attended}/${records.length} attended`;
  }

  updateNotificationBadge();
  updateDutyBadge();
  syncLocalNotifications();
  if (currentPage === "notifications") {
    renderNotifications();
  }

  // ★ Remember this single action as the last action for this duty
  lastAttendanceAction[instanceId] = { type: 'single', recordId };

  pendingAttendanceSaves.set(recordId, rec);

  if (attendanceBatchTimer) clearTimeout(attendanceBatchTimer);
  attendanceBatchTimer = setTimeout(flushAttendanceSaves, 300);
  showLoading();

  toast(newChecked ? "✅ Present" : "❌ Absent");
}
// ============================================
// ATTENDANCE HISTORY
// ============================================
function viewAttendanceHistory(libId) {
  const lib = getLib(libId);
  if (!lib) return;
  const records = appData.attendance.filter((a) => a.librarian_id === libId);

  const grouped = {};
  records.forEach((r) => {
    const instance = appData.duty_instances.find(
      (di) => di.id === r.duty_instance_id
    );
    const date = instance ? instance.date : r.confirmed_at.split("T")[0];
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(r);
  });

  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  let html = "";
  const rowColors = ["#f8fafc", "#f1f5f9"];

  dates.forEach((date, idx) => {
    const recs = grouped[date];
    const presentCount = recs.filter((r) => r.attended || r.forgiven).length;
    const absentCount = recs.length - presentCount;
    const headerBg = idx % 2 === 0 ? "#e8f0fe" : "#e6f7e6";

    html += `
      <div class="duty-attendance-group" style="margin-bottom:16px;">
        <div style="background:${headerBg}; padding:8px 12px; border-radius:6px 6px 0 0; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:#1e293b; font-size:15px;">📅 ${formatDateFull(
            date
          )}</span>
          <span style="font-size:13px;">
            <span style="color:#166534; background:#dcfce7; padding:2px 8px; border-radius:10px; margin-right:6px;">✅ ${presentCount}</span>
            <span style="color:#991b1b; background:#fee2e2; padding:2px 8px; border-radius:10px;">❌ ${absentCount}</span>
          </span>
        </div>
        <div style="background:var(--card-bg); border:1px solid var(--border); border-top:none; border-radius:0 0 6px 6px; padding:8px;">
    `;

    const sorted = recs.sort((a, b) => {
      const ia = appData.duty_instances.find(
        (di) => di.id === a.duty_instance_id
      );
      const da = ia ? appData.duties.find((d) => d.id === ia.duty_id) : null;
      const ib = appData.duty_instances.find(
        (di) => di.id === b.duty_instance_id
      );
      const db = ib ? appData.duties.find((d) => d.id === ib.duty_id) : null;
      return (da ? da.start_time : "00:00").localeCompare(
        db ? db.start_time : "00:00"
      );
    });

    sorted.forEach((r) => {
      const inst = appData.duty_instances.find(
        (di) => di.id === r.duty_instance_id
      );
      const duty = inst
        ? appData.duties.find((d) => d.id === inst.duty_id)
        : null;
      const status = r.attended || r.forgiven ? "Present" : "Absent";
      const statusColor = status === "Present" ? "#22c55e" : "#ef4444";

      html += `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; margin-bottom:4px; background:${
          rowColors[idx % 2]
        }; border-radius:4px;">
          <div>
         <div>
  <span style="font-weight:600; font-size:14px;">${duty ? duty.name : "Unknown Duty"}</span>
  ${duty ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(${duty.sector_id ? getSectorPath(duty.sector_id) : "Standalone"})</span>` : ''}
  <span style="font-size:13px; color:var(--text-secondary); margin-left:8px;">${duty ? formatTime(duty.start_time) + " - " + formatTime(duty.end_time) : ""}</span>
  ${r.forgiven ? '<span style="font-size:12px; color:#b45309; background:#fef3c7; padding:0 6px; border-radius:8px; margin-left:4px;">Forgiven</span>' : ''}
  ${r.punishment_issued ? '<span style="font-size:12px; color:#b91c1c; background:#fee2e2; padding:0 6px; border-radius:8px; margin-left:4px;">Punished</span>' : ''}
</div>
            <span style="font-size:13px; color:var(--text-secondary); margin-left:8px;">${
              duty
                ? formatTime(duty.start_time) +
                  " - " +
                  formatTime(duty.end_time)
                : ""
            }</span>
            ${
              r.forgiven
                ? '<span style="font-size:12px; color:#b45309; background:#fef3c7; padding:0 6px; border-radius:8px; margin-left:4px;">Forgiven</span>'
                : ""
            }
            ${
              r.punishment_issued
                ? '<span style="font-size:12px; color:#b91c1c; background:#fee2e2; padding:0 6px; border-radius:8px; margin-left:4px;">Punished</span>'
                : ""
            }
          </div>
          <button class="status-btn" onclick="toggleAttendanceStatus('${
            r.id
          }')" style="padding:4px 14px; border:none; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer; background:${statusColor}; color:white;">${status}</button>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  document.getElementById("attendanceHistoryContent").innerHTML =
    html ||
    "<p class='text-muted' style='padding:20px; text-align:center;'>No attendance records found.</p>";
  openModal("attendanceHistoryModal");
}

async function fullSyncDutyInstancesForSector(secId) {
  const duties = appData.duties.filter(d => d.sector_id === secId);
  const today = getToday();
  const sectorPeople = getSectorPeople(secId).map(p => p.id);

  for (const duty of duties) {
    const futureInstances = appData.duty_instances.filter(
      di => di.duty_id === duty.id && di.date >= today
    );

    for (const inst of futureInstances) {
      // Get current attendance for this instance
      const currentLibIds = appData.attendance
        .filter(a => a.duty_instance_id === inst.id)
        .map(a => a.librarian_id);

      // Remove attendance for librarians no longer in the sector
      const toRemove = currentLibIds.filter(id => !sectorPeople.includes(id));
      for (const libId of toRemove) {
        const attRecord = appData.attendance.find(
          a => a.duty_instance_id === inst.id && a.librarian_id === libId
        );
        if (attRecord) {
          await deleteEntity("attendance", attRecord.id);
          appData.attendance = appData.attendance.filter(a => a.id !== attRecord.id);
          recalcAttendancePct(libId);
        }
      }

      // Add missing librarians
      const toAdd = sectorPeople.filter(id => !currentLibIds.includes(id));
      for (const libId of toAdd) {
        if (!appData.attendance.some(a => a.duty_instance_id === inst.id && a.librarian_id === libId)) {
          const att = {
            duty_instance_id: inst.id,
            librarian_id: libId,
            attended: false,
            confirmed_by: "system",
            confirmed_at: new Date().toISOString(),
            forgiven: false,
            punishment_issued: false,
          };
          const savedAtt = await saveEntity("attendance", att);
          appData.attendance.push(savedAtt);
          recalcAttendancePct(libId);
        }
      }
    }
  }
}

async function toggleAttendanceStatus(recId) {
  const rec = appData.attendance.find((a) => a.id === recId);
  if (!rec) return;

  // Optimistic toggle – update local data immediately
  rec.attended = !rec.attended;
  rec.forgiven = false;
  rec.confirmed_at = new Date().toISOString();
  rec.confirmed_by = appData.current_user;

  // Recalculate the percentage instantly (dashboard will see it next time it renders)
  recalcAttendancePct(rec.librarian_id);

  // Refresh the attendance history modal **right now** so the change is visible
  viewAttendanceHistory(rec.librarian_id);

  // Save to server in the background
  try {
    await saveEntity("attendance", rec, rec.id);
    await generateMissedNotifications();
    syncLocalNotifications();
    updateDutyBadge();
    // If the modal is still open, refresh it again to reflect final server state
    const modal = document.getElementById("attendanceHistoryModal");
    if (modal && modal.classList.contains("active")) {
      viewAttendanceHistory(rec.librarian_id);
    }
  } catch (err) {
    console.error("Failed to save attendance status", err);
    toast("⚠️ Failed to save change – reverted.");
    // Revert the optimistic change
    rec.attended = !rec.attended;
    rec.forgiven = false;
    recalcAttendancePct(rec.librarian_id);
    // Refresh the modal only if it’s still open
    const modal = document.getElementById("attendanceHistoryModal");
    if (modal && modal.classList.contains("active")) {
      viewAttendanceHistory(rec.librarian_id);
    }
  }
}

// ============================================
// NOTIFICATIONS (fully async)
// ============================================
async function addNotification(
  msg,
  type,
  libId,
  dutyInstanceId = null,
  tagId = null
) {
  const newNotif = {
    message: msg,
    type,
    librarian_id: libId,
    duty_instance_id: dutyInstanceId,
    tag_id: tagId,
    date: getToday(),
    is_read: false,
    is_forgotten: false,
    is_dismissed: false,
    created_at: new Date().toISOString(),
  };
  try {
    const saved = await saveEntity("notifications", newNotif);
    appData.notifications.push(saved); // push the saved object (has .id)
  } catch (e) {
    console.error("Failed to save notification", e);
  }
}

async function generateMissedNotifications() {
  if (generatingMissedNotifications) return;
  generatingMissedNotifications = true;

  try {
    const missedRecords = appData.attendance.filter((a) => {
      if (a.attended || a.forgiven || a.punishment_issued) return false;
      const instance = appData.duty_instances.find(
        (di) => di.id === a.duty_instance_id
      );
      return instance !== undefined;
    });

    // Delete old cumulative notifications from the server (silent)
    // We only delete those that have real server IDs (not our local_ IDs)
    const serverCumulative = appData.notifications.filter(
      (n) => n.type === "cumulative_all" && !n.id.startsWith("local_")
    );
    for (const n of serverCumulative) {
      await deleteEntity("notifications", n.id, true);
    }

    // If no missed records, we're done (the local list was already cleared by syncLocalNotifications)
    if (missedRecords.length === 0) {
      saveData();
      return;
    }

    // Create fresh cumulative notifications on the server (they will be stored but never displayed)
    const grouped = {};
    missedRecords.forEach((att) => {
      const libId = att.librarian_id;
      if (!grouped[libId]) grouped[libId] = [];
      grouped[libId].push(att);
    });

    for (const [libId, records] of Object.entries(grouped)) {
      const lib = getLib(libId);
      if (!lib) continue;

      const totalMissed = records.length;
      const daysSet = new Set();
      records.forEach((att) => {
        const instance = appData.duty_instances.find(
          (di) => di.id === att.duty_instance_id
        );
        if (instance) daysSet.add(instance.date);
      });
      const distinctDays = daysSet.size;

      const newNotif = {
        message: `⚠️ ${lib.name} missed ${totalMissed} duties across ${distinctDays} day(s)`,
        type: "cumulative_all",
        librarian_id: libId,
        duty_instance_id: null,
        tag_id: null,
        date: getToday(),
        is_read: false,
        is_forgotten: false,
        is_dismissed: false,
        forgotten_at: null,
        dismiss_until: null,
        created_at: new Date().toISOString(),
      };

      await saveEntity("notifications", newNotif, null, true);
    }

    saveData();
  } finally {
    generatingMissedNotifications = false;
  }
}
function syncLocalNotifications() {
  // Build the entire local notification list from the current attendance state
  const missedRecords = appData.attendance.filter((a) => {
    if (a.attended || a.forgiven || a.punishment_issued) return false;
    const instance = appData.duty_instances.find(
      (di) => di.id === a.duty_instance_id
    );
    return instance !== undefined;
  });

  // Keep any non‑cumulative notifications (dismissed ones, old types, etc.)
  const otherNotifs = appData.notifications.filter(
    (n) => n.type !== "cumulative_all"
  );

  const newCumulative = [];

  if (missedRecords.length > 0) {
    const grouped = {};
    missedRecords.forEach((att) => {
      const libId = att.librarian_id;
      if (!grouped[libId]) grouped[libId] = [];
      grouped[libId].push(att);
    });

    for (const [libId, records] of Object.entries(grouped)) {
      const lib = getLib(libId);
      if (!lib) continue;

      const totalMissed = records.length;
      const daysSet = new Set();
      records.forEach((att) => {
        const instance = appData.duty_instances.find(
          (di) => di.id === att.duty_instance_id
        );
        if (instance) daysSet.add(instance.date);
      });
      const distinctDays = daysSet.size;

      // Use a stable local ID (no server dependency)
      newCumulative.push({
        id: "local_" + libId,
        message: `⚠️ ${lib.name} missed ${totalMissed} duties across ${distinctDays} day(s)`,
        type: "cumulative_all",
        librarian_id: libId,
        date: getToday(),
        is_read: false,
        is_forgotten: false,
        is_dismissed: false,
      });
    }
  }

  // Replace the entire notifications array with local data
  appData.notifications = [...otherNotifs, ...newCumulative];
}

async function renderNotifications() {
  // The list is already up-to-date because syncLocalNotifications was called.
  // We just filter and display what's in appData.notifications.

  let notifs = appData.notifications;
  if (showDismissed) {
    notifs = notifs.filter((n) => n.is_dismissed);
  } else {
    notifs = notifs.filter((n) => !n.is_dismissed && !n.is_forgotten);
  }

  const grouped = {};
  notifs.forEach((n) => {
    const key = n.date;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(n);
  });
  const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const container = document.getElementById("notificationContainer");
  if (!container) return;

  if (!keys.length) {
    container.innerHTML = '<p class="text-muted">No notifications.</p>';
    return;
  }

  let html = "";
  if (showDismissed) {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="font-weight:600; color:var(--text-secondary);">📁 Dismissed notifications</div>
        <button class="btn btn-danger btn-sm" onclick="clearAllDismissed()">🗑 Clear All Dismissed</button>
      </div>`;
  }

  keys.forEach((key) => {
    html += `<div class="notification-group"><div class="group-header">${getDateGroupLabel(
      key
    )}</div>`;
    grouped[key].forEach((n) => {
      const extraClass =
        n.type === "cumulative_miss" || n.type === "cumulative_all"
          ? "missed"
          : "";
      const actionButton = showDismissed
        ? `<button class="dismiss-btn" onclick="deleteNotificationPermanently('${n.id}')" title="Delete permanently">✕</button>`
        : `<button class="dismiss-btn" onclick="dismissNotification('${n.id}')">Dismiss</button>`;

      html += `<div class="notification-item ${extraClass}">
        <div class="msg">${n.message}</div>
        <div class="actions">
          <button class="action-btn" onclick="showNotificationActionPopup('${n.id}')">⚙️</button>
          ${actionButton}
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  container.innerHTML = html;

  document.getElementById("notificationBadge").textContent =
    appData.notifications.filter(
      (n) => !n.is_read && !n.is_forgotten && !n.is_dismissed
    ).length;
}

function toggleDismissed() {
  showDismissed = !showDismissed;
  const btn = document.getElementById("dismissedToggleBtn");
  if (btn) btn.innerHTML = showDismissed ? "✅ Back to Active" : "📁 Dismissed";
  renderNotifications();
}

async function dismissNotification(id) {
  const n = appData.notifications.find((n) => n.id === id);
  if (!n) return;
  n.is_dismissed = true;
  n.dismiss_until = new Date(Date.now() + 2 * 86400000).toISOString();
  await saveEntity("notifications", n, id);
  renderNotifications();
  toast("Dismissed.");
}

async function deleteNotificationPermanently(id) {
  await deleteEntity("notifications", id);
  appData.notifications = appData.notifications.filter((n) => n.id !== id);
  renderNotifications();
  toast("Notification deleted permanently.");
}

async function clearAllDismissed() {
  showConfirm(
    "Clear All Dismissed",
    `<p>Are you sure you want to permanently delete <strong>all dismissed notifications</strong>? This cannot be undone.</p>`,
    async () => {
      // Delete both server and local dismissed notifications
      const dismissed = appData.notifications.filter(n => n.is_dismissed);
      for (const n of dismissed) {
        if (!n.id.startsWith("local_")) {
          await deleteEntity("notifications", n.id);
        }
      }
      appData.notifications = appData.notifications.filter(n => !n.is_dismissed);
      renderNotifications();
      toast("All dismissed notifications cleared.");
    }
  );
}

function showNotificationActionPopup(notifId) {
  const notif = appData.notifications.find((n) => n.id === notifId);
  if (!notif) return;
  const lib = getLib(notif.librarian_id);

  let contentHtml = `
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 4px 0;">${notif.message}</h4>
      ${
        lib
          ? `<p style="margin:0; font-size:13px; color:var(--text-secondary);">Librarian: ${lib.name}</p>`
          : ""
      }
    </div>
  `;

  if (notif.type === "cumulative_all") {
    const missedRecords = appData.attendance.filter((a) => {
      if (a.librarian_id !== notif.librarian_id) return false;
      if (a.attended || a.forgiven || a.punishment_issued) return false;
      const instance = appData.duty_instances.find(
        (di) => di.id === a.duty_instance_id
      );
      return instance !== undefined;
    });

    if (missedRecords.length > 0) {
      const grouped = {};
      missedRecords.forEach((rec) => {
        const instance = appData.duty_instances.find(
          (di) => di.id === rec.duty_instance_id
        );
        if (!instance) return;
        const date = instance.date;
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push({ rec, instance });
      });

      const sortedDates = Object.keys(grouped).sort((a, b) =>
        b.localeCompare(a)
      );

      // ★ Removed the max-height/overflow wrapper – table only with a border
      contentHtml += `
        <div style="border:1px solid var(--border); border-radius:8px;">
          <table class="notif-detail-table">
            <thead>
              <tr><th>Date</th><th>Duty</th><th>Time</th><th style="text-align:center;">Action</th></tr>
            </thead>
            <tbody>
      `;

      sortedDates.forEach((date) => {
        const records = grouped[date];
        records.forEach(({ rec, instance }, idx) => {
          const duty = appData.duties.find((d) => d.id === instance.duty_id);
          if (!duty) return;
          contentHtml += `
            <tr>
              <td>${idx === 0 ? formatDateFull(date) : ""}</td>
              <td><strong>${duty.name}</strong></td>
              <td>${formatTime(duty.start_time)} – ${formatTime(
            duty.end_time
          )}</td>
              <td style="text-align:center;">
                <button class="btn btn-success btn-sm" onclick="markAttendedFromNotification('${
                  rec.id
                }', this)">✅ Mark Attended</button>
              </td>
            </tr>
          `;
        });
      });

      contentHtml += `
            </tbody>
          </table>
        </div>
      `;
    } else {
      contentHtml += `<div style="text-align:center; padding:20px; color:var(--text-secondary);">✅ All duties have been marked as attended.</div>`;
    }
  } else {
    // Non‑cumulative notifications – you likely don’t use these, but keep them.
    // (They already have no inner scroll.)
    const missedRecords = appData.attendance.filter((a) => {
      if (a.librarian_id !== notif.librarian_id) return false;
      if (a.attended || a.forgiven || a.punishment_issued) return false;
      const instance = appData.duty_instances.find(
        (di) => di.id === a.duty_instance_id
      );
      return instance && instance.date === notif.date;
    });

    if (missedRecords.length > 0) {
      contentHtml += `
        <div style="margin-bottom:12px;">
          <table style="width:100%; font-size:13px;">
            <thead><tr><th>Duty</th><th>Time</th><th></th></tr></thead>
            <tbody>
      `;
      missedRecords.forEach((rec) => {
        const instance = appData.duty_instances.find(
          (di) => di.id === rec.duty_instance_id
        );
        const duty = instance
          ? appData.duties.find((d) => d.id === instance.duty_id)
          : null;
        if (!duty) return;
        contentHtml += `
          <tr>
            <td>${duty.name}</td>
            <td>${formatTime(duty.start_time)}-${formatTime(duty.end_time)}</td>
            <td><button class="btn btn-success btn-sm" onclick="markAttendedFromNotification('${
              rec.id
            }', this)">✅ Mark Attended</button></td>
          </tr>
        `;
      });
      contentHtml += `</tbody></table></div>`;
    }
  }

  document.getElementById("notificationActionContent").innerHTML = contentHtml;
  openModal("notificationActionModal");
}

function undoLastAttendance(instanceId) {
  const action = lastAttendanceAction[instanceId];
  if (!action) return;

  if (action.type === 'single') {
    const rec = appData.attendance.find(a => a.id === action.recordId);
    if (!rec) {
      delete lastAttendanceAction[instanceId];
      return;
    }
    // Toggle the record back
    rec.attended = !rec.attended;
    rec.forgiven = false;
    rec.confirmed_at = new Date().toISOString();
    rec.confirmed_by = appData.current_user;
    recalcAttendancePct(rec.librarian_id);
    pendingAttendanceSaves.set(rec.id, rec);

    // Update UI: re-render table and tab badge
    if (currentPage === "attendance") {
      const activeTab = document.querySelector("#attendanceContainer .sector-tab.active");
      if (activeTab && activeTab.dataset.instance === instanceId) {
        const wrapper = document.getElementById("attendanceTableWrapper");
        if (wrapper) wrapper.innerHTML = renderAttendanceTable(instanceId);
      }
      updateAttendanceTabBadge(instanceId);
    }
    updateDutyBadge();
    syncLocalNotifications();
    toast("↩️ Last toggle undone");

  } else if (action.type === 'bulk') {
    // Reverse the bulk action: mark all as the opposite
    const newAttended = !action.attended;
    const records = appData.attendance.filter(a => a.duty_instance_id === instanceId);
    records.forEach(r => {
      r.attended = newAttended;
      r.forgiven = false;
      r.confirmed_at = new Date().toISOString();
      r.confirmed_by = appData.current_user;
      recalcAttendancePct(r.librarian_id);
      pendingAttendanceSaves.set(r.id, r);
    });

    // Update UI
    if (currentPage === "attendance") {
      const activeTab = document.querySelector("#attendanceContainer .sector-tab.active");
      if (activeTab && activeTab.dataset.instance === instanceId) {
        const wrapper = document.getElementById("attendanceTableWrapper");
        if (wrapper) wrapper.innerHTML = renderAttendanceTable(instanceId);
      }
      updateAttendanceTabBadge(instanceId);
    }
    updateDutyBadge();
    syncLocalNotifications();
    toast(`↩️ Bulk action undone – all marked ${newAttended ? "present" : "absent"}`);
  }

  // Save to localStorage immediately
  saveData();

  // Clear the action so Undo can't be repeated
  delete lastAttendanceAction[instanceId];

  // Trigger batch save
  if (attendanceBatchTimer) clearTimeout(attendanceBatchTimer);
  attendanceBatchTimer = setTimeout(flushAttendanceSaves, 300);
  showLoading();
}

async function forgiveAttendanceRecord(recordId) {
  const rec = appData.attendance.find((a) => a.id === recordId);
  if (!rec) return;
  rec.attended = false;
  rec.forgiven = true;
  rec.confirmed_at = new Date().toISOString();
  rec.confirmed_by = appData.current_user;
  await saveEntity("attendance", rec, rec.id);
  recalcAttendancePct(rec.librarian_id);   // ← added
}

function issuePunishmentFromNotification(notifId) {
  const notif = appData.notifications.find((n) => n.id === notifId);
  if (!notif) return;
  const lib = getLib(notif.librarian_id);
  if (!lib) return;
  openTagModalForLibrarian(notif.librarian_id);
  document.getElementById("tagTypeSelect").value = "punishment";
  document.getElementById("tagNameInput").value = "Punishment - Missed Duty";
  notif.punishment_issued = true;
  notif.is_dismissed = false;
  notif.type = "punishment";
  notif.message = `Punishment issued for ${lib.name}`;
  const recs = appData.attendance.filter(
    (a) => a.librarian_id === notif.librarian_id && !a.attended && !a.forgiven
  );
  recs.forEach((r) => (r.punishment_issued = true));
  saveData();
  renderNotifications();
  toast("Opening punishment form.");
}

// ============================================
// AUTO-ASSIGN & REVERT (async)
// ============================================
async function runAutoAssign() {
  showLoading();
  try {
    const type = document.getElementById("autoAssignType").value;
    const assignExtra = document.getElementById("autoAssignExtra").checked;
    const allowMulti = document.getElementById("autoAssignMulti").checked;

    const leafSectors = appData.sectors.filter((s) => s.is_leaf);
    if (!leafSectors.length) {
      toast("No leaf sectors found.");
      closeModal("autoAssignModal");
      return;
    }

    let pool;
    if (type === "all") {
      pool = appData.librarians.filter((l) => !l.is_deleted);
      appData.sector_assignments = [];
      const headers = {};
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${API_BASE}/sectors/assignments/all`, {
        method: "DELETE",
        headers,
      });
    } else {
      const assignedIds = new Set(
        appData.sector_assignments.map((a) => a.librarian_id)
      );
      pool = appData.librarians.filter(
        (l) => !l.is_deleted && !assignedIds.has(l.id)
      );
    }

    const snapshot = {};
    leafSectors.forEach(
      (s) => (snapshot[s.id] = getSectorPeople(s.id).map((p) => p.id))
    );
    appData.sector_assignment_history.push({
      assignment_snapshot: snapshot,
      timestamp: new Date().toISOString(),
      created_by: appData.current_user,
      is_reverted: false,
    });
    if (appData.sector_assignment_history.length > 5)
      appData.sector_assignment_history =
        appData.sector_assignment_history.slice(-5);

    let multiLibIds = [];
    if (allowMulti) {
      document
        .querySelectorAll(".multi-select-lib:checked")
        .forEach((cb) => multiLibIds.push(cb.value));
    }

    leafSectors.sort((a, b) => (b.min_people || 1) - (a.min_people || 1));
    const usedLibs = new Set();

    // Phase 1: at least 1 per sector
    for (const s of leafSectors) {
      if (getSectorPeople(s.id).length === 0 && pool.length > 0) {
        const lib = pool.shift();
        const assignment = {
          sector_id: s.id,
          librarian_id: lib.id,
          assigned_at: new Date().toISOString(),
        };
        const saved = await saveEntity("sectors/assignments", assignment);
        appData.sector_assignments.push(saved);
        usedLibs.add(lib.id);
      }
    }

    // Phase 2: fill minimums
    for (const s of leafSectors) {
      const current = getSectorPeople(s.id).length;
      const needed = (s.min_people || 1) - current;
      for (let i = 0; i < needed; i++) {
        let lib = pool.find((l) => !usedLibs.has(l.id));
        if (!lib && allowMulti) {
          const available =
            multiLibIds.length > 0
              ? pool.filter((l) => multiLibIds.includes(l.id))
              : pool;
          lib = available.find(
            (l) => !getSectorPeople(s.id).some((p) => p.id === l.id)
          );
        }
        if (!lib) break;
        const assignment = {
          sector_id: s.id,
          librarian_id: lib.id,
          assigned_at: new Date().toISOString(),
        };
        const saved = await saveEntity("sectors/assignments", assignment);
        appData.sector_assignments.push(saved);
        usedLibs.add(lib.id);
      }
    }

    // Phase 3: extra
    if (assignExtra) {
      const remaining = pool.filter((l) => !usedLibs.has(l.id));
      for (const lib of remaining) {
        const randomSector =
          leafSectors[Math.floor(Math.random() * leafSectors.length)];
        const assignment = {
          sector_id: randomSector.id,
          librarian_id: lib.id,
          assigned_at: new Date().toISOString(),
        };
        const saved = await saveEntity("sectors/assignments", assignment);
        appData.sector_assignments.push(saved);
      }
    }

    // ★ FULL SYNC: ensure today's instance exists and then sync all future instances
    const today = getToday();
    for (const s of leafSectors) {
      const duties = appData.duties.filter(d => d.sector_id === s.id);
      for (const duty of duties) {
        if (dutyOccursOnDate(duty, today)) {
          const exists = appData.duty_instances.some(
            di => di.duty_id === duty.id && di.date === today
          );
          if (!exists) {
            const newInst = {
              duty_id: duty.id,
              date: today,
              is_active: true,
              created_at: new Date().toISOString(),
            };
            const savedInst = await saveEntity("duties/instances", newInst);
            appData.duty_instances.push(savedInst);
          }
        }
      }
      // Full sync (add missing, remove extras) for all future instances
      await fullSyncDutyInstancesForSector(s.id);
    }

    saveData();
    closeModal("autoAssignModal");
    renderSectors();
    toast("Auto‑assign completed.");
  } catch (err) {
    console.error(err);
    toast("Auto‑assign failed.");
  } finally {
    hideLoading();
  }
}

function populateRevertList() {
  const container = document.getElementById("revertList");
  const history = appData.sector_assignment_history;
  if (!history.length) {
    container.innerHTML = '<p class="text-muted">No snapshots.</p>';
    return;
  }
  container.innerHTML = history
    .map(
      (h) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);margin:6px 0;">
      <span>${formatDate(h.timestamp)} (by ${h.created_by}) ${
        h.is_reverted ? "(reverted)" : ""
      }</span>
      <button class="btn btn-primary btn-sm" onclick="revertAssignment('${
        h.id
      }')">↩️ Revert</button>
    </div>`
    )
    .join("");
}

async function revertAssignment(historyId) {
  const history = appData.sector_assignment_history.find(
    (h) => h.id === historyId
  );
  if (!history) return;
  showConfirm(
    "Revert Assignment",
    `<p>Restore assignment from ${formatDate(history.timestamp)}?</p>`,
    async () => {
      showLoading();
      try {
        const headers = {};
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        await fetch(`${API_BASE}/sectors/assignments/all`, {
          method: "DELETE",
          headers,
        });
        appData.sector_assignments = [];
        for (const [secId, libIds] of Object.entries(
          history.assignment_snapshot
        )) {
          for (const libId of libIds) {
            if (getLib(libId)) {
              const assignment = {
                sector_id: secId,
                librarian_id: libId,
                assigned_at: new Date().toISOString(),
              };
              const saved = await saveEntity("sectors/assignments", assignment);
              appData.sector_assignments.push(saved);
            }
          }
        }
        history.is_reverted = true;
        closeModal("revertModal");
        renderSectors();
        toast("Reverted.");
      } catch (err) {
        console.error(err);
        toast("Revert failed.");
      } finally {
        hideLoading();
      }
    }
  );
}

// ============================================
// ARCHIVE
// ============================================
function renderArchive() {
  const archived = appData.librarians.filter((l) => l.is_deleted);
  const container = document.getElementById("archiveContainer");
  if (!archived.length) {
    container.innerHTML = '<p class="text-muted">No archived librarians.</p>';
    return;
  }
  container.innerHTML = `<div class="table-container"><div class="table-header"><span>${
    archived.length
  } archived</span><button class="btn btn-danger btn-sm" onclick="deleteAllArchive()">Delete All</button></div><table><thead><tr><th>Name</th><th>Grade</th><th>Adm No.</th><th>House</th><th>Joined</th><th>Actions</th></tr></thead><tbody>${archived
    .map(
      (l) =>
        `<tr><td>${l.name}</td><td>${l.grade}</td><td>${l.adm_no}</td><td>${
          l.house || "—"
        }</td><td>${formatDate(
          l.date_joined
        )}</td><td><button class="btn btn-success btn-sm" onclick="restoreLibrarian('${
          l.id
        }')">↩️ Restore</button> <button class="btn btn-danger btn-sm" onclick="permanentlyDeleteLibrarian('${
          l.id
        }')">🗑️ Delete</button></td></tr>`
    )
    .join("")}</tbody></table></div>`;
}

async function restoreLibrarian(id) {
  const lib = getLib(id);
  if (!lib) return;
  lib.is_deleted = false;
  await saveEntity("librarians", lib, id);
  recalcAttendancePct(lib.id);   // ★ added – so percentage shows immediately
  renderCurrentPage();
  toast("Restored.");
}

async function permanentlyDeleteLibrarian(id) {
  const lib = getLib(id);
  if (!lib) return;
  showConfirm(
    "Permanently Delete",
    `<p>Delete <strong>${lib.name}</strong> permanently?</p><p class="text-danger">Cannot be undone!</p>`,
    async () => {
      showLoading();
      try {
        const headers = {};
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        // Hard delete via new permanent endpoint
        await fetch(`${API_BASE}/librarians/${id}/permanent`, { method: "DELETE", headers });
        appData.librarians = appData.librarians.filter((l) => l.id !== id);
        // ... (the rest of the cleanup as before) ...
        const assignmentsToDelete = appData.sector_assignments.filter(
          (a) => a.librarian_id === id
        );
        for (const a of assignmentsToDelete) {
          await fetch(
            `${API_BASE}/sectors/assignments/${a.sector_id}/${a.librarian_id}`,
            { method: "DELETE", headers }
          );
        }
        appData.sector_assignments = appData.sector_assignments.filter(
          (a) => a.librarian_id !== id
        );
        appData.attendance = appData.attendance.filter(
          (a) => a.librarian_id !== id
        );
        appData.tags = appData.tags.filter((t) => t.librarian_id !== id);
        appData.tag_history = appData.tag_history.filter(
          (t) => t.librarian_id !== id
        );
        appData.notifications = appData.notifications.filter(
          (n) => n.librarian_id !== id
        );
        renderCurrentPage();
        toast("Permanently deleted.");
      } catch (err) {
        console.error(err);
        toast("Delete failed.");
      } finally {
        hideLoading();
      }
    }
  );
}

async function deleteAllArchive() {
  const archived = appData.librarians.filter((l) => l.is_deleted);
  if (!archived.length) return;
  showConfirm(
    "Delete All Archived",
    `Delete all ${archived.length} permanently?`,
    async () => {
      showLoading();
      try {
        const headers = {};
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

        for (const l of archived) {
          // 1. Remove all sector assignments
          const assignments = appData.sector_assignments.filter(
            (a) => a.librarian_id === l.id
          );
          for (const a of assignments) {
            await fetch(
              `${API_BASE}/sectors/assignments/${a.sector_id}/${a.librarian_id}`,
              { method: "DELETE", headers }
            );
          }
          // 2. Permanent delete of the librarian
          await fetch(`${API_BASE}/librarians/${l.id}/permanent`, {
            method: "DELETE",
            headers,
          });
        }

        // Remove from local arrays
        appData.librarians = appData.librarians.filter(
          (l) => !archived.some((a) => a.id === l.id)
        );
        appData.sector_assignments = appData.sector_assignments.filter(
          (a) => !archived.some((l) => l.id === a.librarian_id)
        );
        appData.attendance = appData.attendance.filter(
          (a) => !archived.some((l) => l.id === a.librarian_id)
        );
        appData.tags = appData.tags.filter(
          (t) => !archived.some((l) => l.id === t.librarian_id)
        );
        appData.tag_history = appData.tag_history.filter(
          (t) => !archived.some((l) => l.id === t.librarian_id)
        );
        appData.notifications = appData.notifications.filter(
          (n) => !archived.some((l) => l.id === n.librarian_id)
        );

        renderCurrentPage();
        toast("All archived permanently deleted.");
      } catch (err) {
        console.error(err);
        toast("Deletion failed.");
      } finally {
        hideLoading();
      }
    }
  );
}
// ============================================
// COMMITTEE
// ============================================
async function addCommitteeYear() {
  const year = parseInt(document.getElementById("committeeYearInput").value);
  if (!year) {
    Swal.fire("Error", "Please enter a year.", "error");
    return;
  }

  const rows = document.querySelectorAll("#committeeMemberInputs tr");
  const members = [];
  rows.forEach((row) => {
    const name = row.querySelector(".cm-name").value.trim();
    const adm = row.querySelector(".cm-adm").value.trim();
    const cls = row.querySelector(".cm-class").value.trim();
    const house = row.querySelector(".cm-house").value.trim();
    const position = row.querySelector(".cm-position").value.trim();
    const photo = row.querySelector(".cm-photo").value.trim() || null;
    if (name && position)
      members.push({
        name,
        adm_no: adm,
        class: cls,
        house,
        position,
        photo_url: photo,
      });
  });
  if (!members.length) {
    Swal.fire(
      "Error",
      "Add at least one member with a name and position.",
      "error"
    );
    return;
  }

  // ---- Add new committee optimistically ----
  const tempId = "temp_" + Date.now();
  const tempCommittee = {
    id: tempId,
    year,
    members,
    created_at: new Date().toISOString(),
    _temp: true,
  };

  appData.hall_of_fame_committees.push(tempCommittee);
  closeModal("committeeModal");
  // Also update the committee page if it's open
  renderHallOfFame();
  renderCommittee();
  toast("Adding committee…");

  try {
    const newCommittee = {
      year,
      members,
      created_at: new Date().toISOString(),
    };
    const saved = await saveEntity("halloffame/committees", newCommittee);

    // Replace temporary committee with the real one
    const idx = appData.hall_of_fame_committees.findIndex(
      (c) => c.id === tempId
    );
    if (idx !== -1) {
      appData.hall_of_fame_committees[idx] = { ...saved, id: saved._id };
    } else {
      appData.hall_of_fame_committees.push({ ...saved, id: saved._id });
    }

    renderHallOfFame();
    renderCommittee();
    toast("Committee added.");
  } catch (err) {
    appData.hall_of_fame_committees = appData.hall_of_fame_committees.filter(
      (c) => c.id !== tempId
    );
    renderHallOfFame();
    renderCommittee();
    toast("Error adding committee – rolled back.");
    console.error(err);
  }
}

async function editCommittee(committeeId) {
  const committee = appData.hall_of_fame_committees.find(
    (c) => c.id === committeeId
  );
  if (!committee) return;

  document.getElementById("editCommitteeYear").value = committee.year;
  const tbody = document.getElementById("editCommitteeMemberInputs");
  tbody.innerHTML = "";
  committee.members.forEach((m) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="text" class="cm-name-edit" value="${m.name}"></td>
      <td><input type="text" class="cm-adm-edit" value="${m.adm_no || ""}"></td>
      <td><input type="text" class="cm-class-edit" value="${
        m.class || ""
      }"></td>
      <td><input type="text" class="cm-house-edit" value="${
        m.house || ""
      }"></td>
      <td><input type="text" class="cm-position-edit" value="${
        m.position
      }"></td>
        <td style="display:flex; gap:4px; align-items:center;">
        <input type="text" class="cm-photo-edit" value="${
          m.photo_url || ""
        }" style="flex:1;" />
        <label class="btn btn-secondary btn-sm" style="cursor:pointer; margin:0; white-space:nowrap;">📁
          <input type="file" accept="image/*" style="display:none;"
                 onchange="var parent=this.closest('td'); var input=parent.querySelector('.cm-photo-edit'); if(this.files[0]){ var reader=new FileReader(); reader.onload=function(e){ input.value=e.target.result; }; reader.readAsDataURL(this.files[0]); }" />
        </label>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>
    `;
    tbody.appendChild(row);
  });
  selectedCommitteeId = committeeId;
  openModal("editCommitteeModal");
}

async function saveEditCommittee() {
  const year = parseInt(document.getElementById("editCommitteeYear").value);
  if (!year) {
    Swal.fire("Error", "Enter a year.", "error");
    return;
  }

  const rows = document.querySelectorAll("#editCommitteeMemberInputs tr");
  const members = [];
  rows.forEach((row) => {
    const name = row.querySelector(".cm-name-edit").value.trim();
    const adm = row.querySelector(".cm-adm-edit").value.trim();
    const cls = row.querySelector(".cm-class-edit").value.trim();
    const house = row.querySelector(".cm-house-edit").value.trim();
    const position = row.querySelector(".cm-position-edit").value.trim();
    const photo = row.querySelector(".cm-photo-edit").value.trim() || null;
    if (name && position) {
      members.push({
        name,
        adm_no: adm,
        class: cls,
        house,
        position,
        photo_url: photo,
      });
    }
  });
  if (!members.length) {
    Swal.fire("Error", "Add at least one member.", "error");
    return;
  }

  const committee = appData.hall_of_fame_committees.find(
    (c) => c.id === selectedCommitteeId
  );
  if (committee) {
    committee.year = year;
    committee.members = members;
    await saveEntity("halloffame/committees", committee, committee.id);
  }
  closeModal("editCommitteeModal");
  renderHallOfFame();
  renderCommittee();
  toast("Committee updated.");
}

async function deleteCommittee(id) {
  showConfirm(
    "Delete Committee",
    "Remove this committee from Hall of Fame?",
    async () => {
      await deleteEntity("halloffame/committees", id);
      appData.hall_of_fame_committees = appData.hall_of_fame_committees.filter(
        (c) => c.id !== id
      );
      renderHallOfFame();
      renderCommittee();
      toast("Committee removed.");
    }
  );
}

function renderCommittee() {
  const committees = appData.hall_of_fame_committees || [];
  const container = document.getElementById("committeeContainer");
  if (!committees.length) {
    container.innerHTML = '<p class="text-muted">No committees added yet.</p>';
    return;
  }
  container.innerHTML = committees
    .sort((a, b) => b.year - a.year)
    .map(
      (c) => `
    <div class="committee-card">
      <div class="year">${c.year} Library Committee</div>
      <div class="members">
        ${c.members
          .map(
            (m) => `
          <span class="member">
            <span class="member-avatar">${
              m.photo_url ? `<img src="${m.photo_url}">` : getInitials(m.name)
            }</span>
            ${m.name} <span class="pos">(${m.position})</span>
            ${m.house ? ` – ${m.house}` : ""} ${
              m.adm_no ? ` – Adm: ${m.adm_no}` : ""
            } ${m.class ? ` – Class: ${m.class}` : ""}
          </span>
        `
          )
          .join("")}
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" onclick="editCommittee('${
          c.id
        }')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCommittee('${
          c.id
        }')">🗑️</button>
      </div>
    </div>
  `
    )
    .join("");
}

async function syncDutyInstancesForSector(secId) {
  const duties = appData.duties.filter((d) => d.sector_id === secId);
  const today = getToday();

  for (const duty of duties) {
    const instances = appData.duty_instances.filter(
      (di) => di.duty_id === duty.id && di.date >= today
    );

    const sectorPeople = getSectorPeople(secId).map((p) => p.id);

    for (const inst of instances) {
      const existingLibIds = appData.attendance
        .filter((a) => a.duty_instance_id === inst.id)
        .map((a) => a.librarian_id);

      const missing = sectorPeople.filter((id) => !existingLibIds.includes(id));

      for (const libId of missing) {
        // ★★★ Guard against duplicate local pushes ★★★
        if (!appData.attendance.some(a => a.duty_instance_id === inst.id && a.librarian_id === libId)) {
          const att = {
            duty_instance_id: inst.id,
            librarian_id: libId,
            attended: false,
            confirmed_by: "system",
            confirmed_at: new Date().toISOString(),
            forgiven: false,
            punishment_issued: false,
          };
          const savedAtt = await saveEntity("attendance", att);
          appData.attendance.push(savedAtt);
          recalcAttendancePct(libId); 
        }
      }
    }
  }
}
function addCommitteeRow() {
  const tbody = document.getElementById("committeeMemberInputs");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="cm-name" placeholder="Full name"></td>
    <td><input type="text" class="cm-adm" placeholder="Adm No."></td>
    <td><input type="text" class="cm-class" placeholder="e.g., 10A"></td>
    <td><input type="text" class="cm-house" placeholder="House"></td>
    <td><input type="text" class="cm-position" placeholder="Position"></td>
    <td style="display:flex; gap:4px; align-items:center;">
      <input type="text" class="cm-photo" placeholder="URL (optional)" style="flex:1;" />
      <label class="btn btn-secondary btn-sm" style="cursor:pointer; margin:0; white-space:nowrap;">📁
        <input type="file" accept="image/*" style="display:none;"
               onchange="var parent=this.closest('td'); var input=parent.querySelector('.cm-photo'); if(this.files[0]){ var reader=new FileReader(); reader.onload=function(e){ input.value=e.target.result; }; reader.readAsDataURL(this.files[0]); }" />
      </label>
    </td>
    <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(row);
}

function addEditCommitteeRow() {
  const tbody = document.getElementById("editCommitteeMemberInputs");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="cm-name-edit" placeholder="Full name"></td>
    <td><input type="text" class="cm-adm-edit" placeholder="Adm No."></td>
    <td><input type="text" class="cm-class-edit" placeholder="e.g., 10A"></td>
    <td><input type="text" class="cm-house-edit" placeholder="House"></td>
    <td><input type="text" class="cm-position-edit" placeholder="Position"></td>
    <td style="display:flex; gap:4px; align-items:center;">
      <input type="text" class="cm-photo-edit" placeholder="URL (optional)" style="flex:1;" />
      <label class="btn btn-secondary btn-sm" style="cursor:pointer; margin:0; white-space:nowrap;">📁
        <input type="file" accept="image/*" style="display:none;"
               onchange="var parent=this.closest('td'); var input=parent.querySelector('.cm-photo-edit'); if(this.files[0]){ var reader=new FileReader(); reader.onload=function(e){ input.value=e.target.result; }; reader.readAsDataURL(this.files[0]); }" />
      </label>
    </td>
    <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(row);
}

// ============================================
// RENDER CURRENT PAGE
// ============================================
function renderCurrentPage() {
  switch (currentPage) {
    case "dashboard":
      renderDashboard();
      break;
    case "sectors":
      renderSectors();
      break;
    case "duties":
      renderDuties();
      break;
    case "attendance":
      renderAttendance();
      break;
    case "notifications":
      renderNotifications();
      break;
    case "halloffame":
      renderHallOfFame();
      break;
    case "committee":
      renderCommittee();
      break;
    case "archive":
      renderArchive();
      break;
    case "profile":
      renderProfile();
      break;
  }
}

// ============================================
// TOAST (unchanged)
// ============================================
function toast(msg) {
  const existing = document.querySelector(".toast-container");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast-container";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ============================================
// INITIALIZATION
// ============================================
async function initApp() {
  // 1. Instantly load cached data into appData (synchronous)
  loadData();

  // 2. Set the current date IMMEDIATELY so the UI has a date
  currentViewDate = getToday();
  document.getElementById("viewDate").value = currentViewDate;

  // 3. Render the dashboard instantly with whatever we have (cached or empty)
  renderDashboard();

  // 4. Show loading bar during the initial background sync
  showLoading();

  // 5. Set up the date navigator (dev mode) – no blocking
  if (!devMode) {
    document.getElementById("viewDate").max = getToday();
  }

  const dateNav = document.querySelector(".date-navigator");
  if (dateNav) {
    dateNav.style.display = devMode ? "flex" : "none";
  }

  // 6. Restore sector modal originals
  const sectorBody = document.querySelector("#sectorModal .modal-body");
  const sectorFooter = document.querySelector("#sectorModal .modal-footer");
  if (sectorBody) sectorModalOriginalBody = sectorBody.innerHTML;
  if (sectorFooter) sectorModalOriginalFooter = sectorFooter.innerHTML;

  // 7. Start all slow work in the background (don’t block the UI)
  startBackgroundSync(); // will hide loading bar when done
  setViewDate(getToday()); // fire & forget

  // 8. Periodic intervals (unchanged)
  setInterval(async () => {
    try {
      if (currentPage === "notifications") renderNotifications();
      await generateDutyInstancesForDate(getToday());
      await cleanExpiredTags();
      updateDutyBadge();
    } catch (e) {
      console.error(e);
    }
  }, 60000);

  setInterval(updateNotificationBadge, 15000);
}
async function renderAttendanceModal() {
  const date =
    document.getElementById("attendanceModalDate").value || getToday();
  await generateDutyInstancesForDate(date);
  const container = document.getElementById("attendanceModalContainer");
  const instances = appData.duty_instances.filter(
    (di) => di.date === date && di.is_active
  );
  if (!instances.length) {
    container.innerHTML = `<p class="text-muted">No duties on ${formatDate(
      date
    )}.</p>`;
    return;
  }
  let html = `<div class="sector-tabs" style="margin-bottom:16px;">`;
  instances.forEach((di, idx) => {
    const duty = appData.duties.find((d) => d.id === di.duty_id);
    if (!duty) return;
    const records = appData.attendance.filter(
      (a) => a.duty_instance_id === di.id
    );
    const attended = records.filter((r) => r.attended || r.forgiven).length;
    html += `<div class="sector-tab ${
      idx === 0 ? "active" : ""
    }" onclick="switchAttendanceTab('${di.id}')" data-instance="${di.id}">${
      duty.name
    } <span class="count-badge">${attended}/${records.length}</span></div>`;
  });
  html += `</div>${renderAttendanceTabContent(instances[0].id)}`;
  container.innerHTML = html;
}

function switchAttendanceTab(instanceId) {
  document
    .querySelectorAll("#attendanceModalContainer .sector-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelector(
      `#attendanceModalContainer .sector-tab[data-instance="${instanceId}"]`
    )
    .classList.add("active");
  const container = document.getElementById("attendanceModalContainer");
  container.innerHTML =
    container.querySelector(".sector-tabs").outerHTML +
    renderAttendanceTabContent(instanceId);
}

function renderAttendanceTabContent(instanceId) {
  const records = appData.attendance.filter(
    (a) => a.duty_instance_id === instanceId
  );
  const instance = appData.duty_instances.find((di) => di.id === instanceId);
  const duty = instance
    ? appData.duties.find((d) => d.id === instance.duty_id)
    : null;
  if (!duty || !records.length) return '<p class="text-muted">No records.</p>';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
      <div><strong>${
        duty.name
      }</strong> <span style="font-size:13px;color:var(--text-secondary);">${formatTime(
    duty.start_time
  )}-${formatTime(duty.end_time)}</span></div>
      <div><button class="btn btn-secondary btn-sm" onclick="selectAllAttendanceTab('${instanceId}',true)">Select All</button> <button class="btn btn-secondary btn-sm" onclick="selectAllAttendanceTab('${instanceId}',false)">Unselect All</button> <button class="btn btn-primary btn-sm" onclick="saveAttendanceTab('${instanceId}')">💾 Save</button></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">${records
      .map((r) => {
        const lib = getLib(r.librarian_id);
        if (!lib) return "";
        const checked = r.attended || r.forgiven;
        return `<label style="display:flex;align-items:center;gap:4px;padding:4px 12px;border-radius:var(--radius-sm);cursor:pointer;font-size:14px;${
          checked
            ? "background:#dcfce7;border:1px solid #86efac"
            : "background:var(--bg);border:1px solid var(--border)"
        }">
          <input type="checkbox" class="attendance-tab-check" data-record="${
            r.id
          }" ${checked ? "checked" : ""} onchange="toggleAttendanceTabCheckbox(this, '${instanceId}')">
          ${lib.name} ${r.forgiven ? "(forgiven)" : ""}
        </label>`;
      })
      .join("")}</div>
    <div style="margin-top:8px;font-size:13px;color:var(--text-secondary);" id="attendanceCount_${instanceId}">
      ${records.filter((r) => r.attended || r.forgiven).length}/${records.length} attended
    </div>`;
}

function toggleAttendanceTabCheckbox(checkbox, instanceId) {
  const newChecked = checkbox.checked;
  const label = checkbox.closest("label");
  if (label) {
    label.style.background = newChecked ? "#dcfce7" : "var(--bg)";
    label.style.border = newChecked ? "1px solid #86efac" : "1px solid var(--border)";
  }

  // Update the attended count text (visual only, using checkbox states)
  const container = document.getElementById("attendanceModalContainer");
  const allCheckboxes = container.querySelectorAll(".attendance-tab-check[data-record]");
  let attended = 0, total = 0;
  allCheckboxes.forEach(cb => {
    const rec = appData.attendance.find(a => a.id === cb.dataset.record);
    if (rec && rec.duty_instance_id === instanceId) {
      total++;
      if (cb.checked) attended++;
    }
  });
  const countEl = document.getElementById("attendanceCount_" + instanceId);
  if (countEl) countEl.textContent = `${attended}/${total} attended`;
}

async function selectAllAttendanceTab(instanceId, sel) {
  const records = appData.attendance.filter(
    (a) => a.duty_instance_id === instanceId
  );

  records.forEach((r) => {
    r.attended = sel;
    if (sel) r.forgiven = false;
    r.confirmed_at = new Date().toISOString();
    r.confirmed_by = appData.current_user;
    pendingAttendanceSaves.set(r.id, r);
    recalcAttendancePct(r.librarian_id);   // ★
  });

  renderAttendanceModal();
  updateDutyBadge();
  syncLocalNotifications();
  if (currentPage === "notifications") {
    renderNotifications();
  }
  toast(`All ${sel ? "present" : "absent"}.`);

  await flushAttendanceSaves();
}
async function saveAttendanceTab(instanceId) {
  const records = appData.attendance.filter(
    (a) => a.duty_instance_id === instanceId
  );

  document.querySelectorAll(".attendance-tab-check").forEach((cb) => {
    const rec = records.find((r) => r.id === cb.dataset.record);
    if (rec && rec.attended !== cb.checked) {
      rec.attended = cb.checked;
      if (cb.checked) rec.forgiven = false;
      rec.confirmed_at = new Date().toISOString();
      rec.confirmed_by = appData.current_user;
      pendingAttendanceSaves.set(rec.id, rec);
      recalcAttendancePct(rec.librarian_id);   // ★
    }
  });

  renderAttendanceModal();
  updateDutyBadge();
  syncLocalNotifications();
  if (currentPage === "notifications") {
    renderNotifications();
  }

  toast("Saved.");
  await flushAttendanceSaves();
}

function editLeafSector(secId) {
  const sector = getSector(secId);
  if (!sector || !sector.is_leaf) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = modalZIndex + 10;
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px; z-index:${modalZIndex + 11};">
      <div class="modal-header">
        <h3>✏️ Edit Leaf Sector</h3>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="editLeafName" value="${sector.name}">
        </div>
        <div class="form-group">
          <label>Minimum Junior Librarians</label>
          <input type="number" id="editLeafMin" value="${
            sector.min_people
          }" min="1">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="editLeafDesc">${sector.description || ""}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveLeafEdit('${secId}')">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveLeafEdit(secId) {
  const sector = getSector(secId);
  if (!sector) return;

  const name = document.getElementById("editLeafName").value.trim();
  const min = parseInt(document.getElementById("editLeafMin").value);
  const desc = document.getElementById("editLeafDesc").value.trim();

  if (!name) {
    Swal.fire("Error", "Name is required.", "error");
    return;
  }
  if (!min || min < 1) {
    Swal.fire("Error", "Minimum must be at least 1.", "error");
    return;
  }

  sector.name = name;
  sector.min_people = min;
  sector.description = desc || null;

  await saveEntity("sectors", sector, sector.id);
  document.querySelectorAll(".modal-overlay.active").forEach((m) => m.remove());
  renderSectors();
  toast("Leaf sector updated.");
}

function getSectorPath(sectorId) {
  const sector = getSector(sectorId);
  if (!sector) return "";
  if (!sector.parent_id) return sector.name;
  const parent = getSector(sector.parent_id);
  return parent ? `${parent.name} › ${sector.name}` : sector.name;
}

function updateNotificationBadge() {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;
  const count = appData.notifications.filter(
    (n) => !n.is_read && !n.is_forgotten && !n.is_dismissed
  ).length;
  badge.textContent = count;
}

function updateDutyBadge() {
  const badge = document.getElementById("dutyBadge");
  if (!badge) return;
  const todayDuties = appData.duty_instances.filter((di) => {
    if (di.date !== getToday() || !di.is_active) return false;
    const duty = appData.duties.find((d) => d.id === di.duty_id);
    return duty && (!duty.end_date || duty.end_date >= getToday());
  });
  badge.textContent = todayDuties.length;
}

function viewTagDetails(tagId) {
  const tag = appData.tags.find((t) => t.id === tagId);
  if (!tag) return;
  const lib = getLib(tag.librarian_id);
  selectedTagId = tagId;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = modalZIndex + 10;
  overlay.innerHTML = `
    <div class="modal" style="max-width:450px; z-index:${modalZIndex + 11};">
      <div class="modal-header"><h3>🏷️ Tag Details</h3><button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;align-items:center;gap:10px;">
        <span class="tag-badge ${tagColor(
          tag.type
        )}" style="font-size:16px;padding:4px 16px;">${tag.name}</span>
        <div style="width:100%; background:#f8fafc; padding:12px; border-radius:8px;">
          <div><strong>Type:</strong> ${tag.type}</div>
          <div><strong>Librarian:</strong> ${lib ? lib.name : "Unknown"}</div>
          <div><strong>Status:</strong> ${
            tag.is_active
              ? tag.end_date && tag.end_date < getToday()
                ? "⚠️ Expired"
                : "✅ Active"
              : "❌ Inactive"
          }</div>
        </div>
        <div style="width:100%; background:#f8fafc; padding:12px; border-radius:8px;"><strong>Description:</strong> ${
          tag.description
        }</div>
        <div style="width:100%; background:#f8fafc; padding:12px; border-radius:8px;">
          <div><strong>Start:</strong> ${formatDate(tag.start_date)}</div>
          <div><strong>End:</strong> ${
            tag.end_date ? formatDate(tag.end_date) : "Forever"
          }</div>
        </div>
        <button class="btn btn-warning btn-sm" onclick="editTag('${tagId}'); this.closest('.modal-overlay').remove();">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTagFromModal(); this.closest('.modal-overlay').remove();">🗑️ Delete</button>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
}

function editTag(tagId) {
  const tag = appData.tags.find((t) => t.id === tagId);
  if (!tag) return;
  selectedTagId = tagId;
  document.getElementById("tagNameInput").value = tag.name;
  document.getElementById("tagDescInput").value = tag.description;
  document.getElementById("tagEndDate").value = tag.end_date || "";
  document.getElementById("tagTypeSelect").value = tag.type;
  document.getElementById("tagModalSaveBtn").textContent = "Save Tag";
  openModal("tagModal");
}

function showAllTagsPopup(libId) {
  const tags = getLibTags(libId);
  const lib = getLib(libId);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = modalZIndex + 10;
  const tagRows = tags
    .map(
      (t) => `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#f8fafc; border-radius:8px; margin-bottom:6px;">
      <span class="tag-badge ${tagColor(
        t.type
      )}" style="cursor:pointer;" onclick="viewTagDetails('${
        t.id
      }'); this.closest('.modal-overlay').remove();">${t.name}</span>
      <button class="btn btn-danger btn-sm" onclick="quickDeleteTag('${
        t.id
      }'); this.closest('.modal-overlay').remove();">✕</button>
    </div>`
    )
    .join("");
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px; z-index:${modalZIndex + 11};">
      <div class="modal-header"><h3>🏷️ All Tags for ${
        lib ? lib.name : "Librarian"
      }</h3><button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button></div>
      <div class="modal-body">${
        tags.length === 0
          ? '<p class="text-muted">No active tags.</p>'
          : tagRows
      }</div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
}

async function quickDeleteTag(tagId) {
  const tag = appData.tags.find((t) => t.id === tagId);
  if (!tag) return;
  tag.is_active = false;
  tag.removed_at = new Date().toISOString();
  try {
    await saveEntity("tags", tag, tag.id);
  } catch (e) {
    console.error("Failed to delete tag", e);
    toast("Error removing tag");
    return;
  }
  appData.tag_history.push({
    tag_id: tag.id,
    librarian_id: tag.librarian_id,
    tag_name: tag.name,
    description: tag.description,
    type: tag.type,
    start_date: tag.start_date,
    end_date: tag.end_date,
    removed_at: tag.removed_at,
    removal_reason: "manual_delete",
  });
  saveData();   // ★ persist the history
  renderCurrentPage();
  toast("Tag removed.");
}

function viewTagHistoryHtml(libId) {
  const history = appData.tag_history.filter((h) => h.librarian_id === libId);
  if (!history.length) return "No previous tags.";

  return history
    .map(
      (h) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:#f8fafc; border-radius:6px; margin-bottom:4px;">
      <div>
        <span><strong>${h.tag_name}</strong> (${h.type})</span>
        <span class="text-muted" style="font-size:12px; margin-left:8px;">${formatDate(
          h.start_date
        )} – ${h.end_date ? formatDate(h.end_date) : "Forever"}</span>
        <span style="font-size:12px; color:var(--text-secondary); margin-left:8px;">Removed: ${h.removal_reason}</span>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-secondary btn-sm" onclick="viewTagHistoryDetails('${h.id}')">🔍 View</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTagHistoryEntry('${h.id}')">🗑</button>
      </div>
    </div>`
    )
    .join("");
}

function viewTagHistoryDetails(historyId) {
  const h = appData.tag_history.find((t) => t.id === historyId);
  if (!h) return;
  const lib = getLib(h.librarian_id);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.id = "tagHistoryDetailModal";
  overlay.style.zIndex = modalZIndex + 10;
  overlay.innerHTML = `
    <div class="modal" style="max-width:450px; z-index:${modalZIndex + 11};">
      <div class="modal-header">
        <h3>🏷️ Tag History Details</h3>
        <button class="close-btn" onclick="closeModal('tagHistoryDetailModal')">×</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:#f8fafc; padding:12px; border-radius:8px;">
          <div><strong>Tag Name:</strong> ${h.tag_name}</div>
          <div><strong>Type:</strong> ${h.type}</div>
          <div><strong>Librarian:</strong> ${lib ? lib.name : "Unknown"}</div>
          <div><strong>Description:</strong> ${h.description || "—"}</div>
        </div>
        <div style="background:#f8fafc; padding:12px; border-radius:8px;">
          <div><strong>Start Date:</strong> ${formatDate(h.start_date)}</div>
          <div><strong>End Date:</strong> ${h.end_date ? formatDate(h.end_date) : "Forever"}</div>
        </div>
        <div style="background:#f8fafc; padding:12px; border-radius:8px;">
          <div><strong>Removed:</strong> ${formatDate(h.removed_at)}</div>
          <div><strong>Reason:</strong> ${h.removal_reason || "Unknown"}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('tagHistoryDetailModal')">Close</button>
        <button class="btn btn-danger" onclick="closeModal('tagHistoryDetailModal'); deleteTagHistoryEntry('${h.id}');">🗑 Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function deleteTagHistoryEntry(historyId) {
  showConfirm(
    "Delete Tag History",
    "Permanently delete this history entry?",
    async () => {
      try {
        await deleteEntity("tags/history", historyId);
        appData.tag_history = appData.tag_history.filter((t) => t.id !== historyId);
        saveData();

        // Close the detail modal safely (no DOM removal)
        closeModal("tagHistoryDetailModal");

        // Refresh the action popup if it's open
        if (window._lastTagHistoryLibId) {
          viewTagHistoryForLibrarian(window._lastTagHistoryLibId);
        }

        renderCurrentPage();
        toast("History entry deleted.");
      } catch (err) {
        console.error(err);
        toast("Failed to delete history.");
      }
    }
  );
}
function viewTagHistoryForLibrarian(libId) {
  window._lastTagHistoryLibId = libId;
  document.getElementById("actionPopupTitle").textContent = "📜 Tag History";
  document.getElementById("actionPopupContent").innerHTML =
    viewTagHistoryHtml(libId);
  openModal("actionPopup");
}

function toggleMultiSelect() {
  const checked = document.getElementById("autoAssignMulti").checked;
  const container = document.getElementById("multiSelectContainer");
  container.style.display = checked ? "block" : "none";
  if (checked) {
    populateMultiSelect();   // always populate when shown
  }
}

function populateMultiSelect() {
  const librarians = appData.librarians.filter((l) => !l.is_deleted);
  const container = document.getElementById("multiSelectList");
  let html = "";
  librarians.forEach((l) => {
    html += `<tr>
      <td><input type="checkbox" class="multi-select-lib" value="${l.id}"></td>
      <td>${l.name}</td>
      <td>${l.adm_no}</td>
      <td>${l.house || "—"}</td>
    </tr>`;
  });
  container.innerHTML = html;
}

async function addSector() {
  const name = document.getElementById("sectorName").value.trim();
  const desc = document.getElementById("sectorDesc").value.trim();
  if (!name) {
    Swal.fire("Error", "Enter a name.", "error");
    return;
  }
  // Categories only – isLeaf is forced false in the modal
  const newCategory = {
    name,
    parent_id: null,
    is_leaf: false,
    description: desc || null,
    min_people: 0,
    created_at: new Date().toISOString(),
  };
  const saved = await saveEntity("sectors", newCategory);
  appData.sectors.push(saved);
  closeModal("sectorModal");
  renderSectors();
  toast("Category added.");
}

async function deleteSector(id, options = {}) {
  const sec = getSector(id);
  if (!sec) return;

  // -------------------------------------------------------------
  // Silent deletion (used when a category calls us – no popup)
  // -------------------------------------------------------------
  if (options.skipConfirm) {
    showLoading();
    try {
      const clearHistory = options.clearHistory || false;
      const headers = {};
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${API_BASE}/sectors/assignments/by-sector/${id}`, {
        method: "DELETE",
        headers,
      });
      appData.sector_assignments = appData.sector_assignments.filter(
        (a) => a.sector_id !== id
      );

      const duties = appData.duties.filter((d) => d.sector_id === id);
      const today = getToday();

      for (const duty of duties) {
        if (clearHistory) {
          // Completely remove the duty and all instances/attendance
          const allInstances = appData.duty_instances.filter(
            (di) => di.duty_id === duty.id
          );
          for (const inst of allInstances) {
            await deleteEntity("attendance/by-instance", inst.id);
            appData.attendance = appData.attendance.filter(
              (a) => a.duty_instance_id !== inst.id
            );
          }
          for (const inst of allInstances) {
            await deleteEntity("duties/instances", inst.id);
          }
          appData.duty_instances = appData.duty_instances.filter(
            (di) => di.duty_id !== duty.id
          );
          await deleteEntity("duties", duty.id);
          appData.duties = appData.duties.filter((d) => d.id !== duty.id);
        } else {
          // Stop future occurrences (like deleteDuty without clearHistory)
          const d = new Date(today);
          d.setDate(d.getDate() - 1);
          const yesterday = d.toISOString().split("T")[0];
          duty.end_date = yesterday;
          await saveEntity("duties", duty, duty.id);

          // Delete only future instances and their attendance
          const futureInsts = appData.duty_instances.filter(
            (di) => di.duty_id === duty.id && di.date >= today
          );
          for (const inst of futureInsts) {
            await deleteEntity("attendance/by-instance", inst.id);
            appData.attendance = appData.attendance.filter(
              (a) => a.duty_instance_id !== inst.id
            );
            await deleteEntity("duties/instances", inst.id);
          }
          appData.duty_instances = appData.duty_instances.filter(
            (di) => !(di.duty_id === duty.id && di.date >= today)
          );
          // Keep the duty in appData.duties (with updated end_date)
        }
      }

      // Recalculate percentages for all affected librarians
      const affectedPeople = getSectorPeople(id);
      affectedPeople.forEach(p => recalcAttendancePct(p.id));

      await deleteEntity("sectors", id);
      appData.sectors = appData.sectors.filter((s) => s.id !== id);
      selectedLeafId = null;
      renderSectors();
      updateDutyBadge();
    } catch (err) {
      console.error(err);
      toast("Deletion failed.");
    } finally {
      hideLoading();
    }
    return;
  }

  // -------------------------------------------------------------
  // Normal leaf deletion (user clicked Delete on a leaf sector)
  // -------------------------------------------------------------
  if (sec.is_leaf) {
    showConfirm(
      "Delete Leaf Sector",
      `<p>Delete <strong>${sec.name}</strong>?</p>
       <label><input type="checkbox" id="deleteLeafHistory"> Also delete attendance history</label>`,
      async () => {
        showLoading();
        try {
          const clearHistory =
            document.getElementById("deleteLeafHistory")?.checked || false;
          const headers = {};
          if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
          await fetch(`${API_BASE}/sectors/assignments/by-sector/${id}`, {
            method: "DELETE",
            headers,
          });
          appData.sector_assignments = appData.sector_assignments.filter(
            (a) => a.sector_id !== id
          );

          const duties = appData.duties.filter((d) => d.sector_id === id);
          const today = getToday();

          for (const duty of duties) {
            if (clearHistory) {
              const allInstances = appData.duty_instances.filter(
                (di) => di.duty_id === duty.id
              );
              for (const inst of allInstances) {
                await deleteEntity("attendance/by-instance", inst.id);
                appData.attendance = appData.attendance.filter(
                  (a) => a.duty_instance_id !== inst.id
                );
              }
              for (const inst of allInstances) {
                await deleteEntity("duties/instances", inst.id);
              }
              appData.duty_instances = appData.duty_instances.filter(
                (di) => di.duty_id !== duty.id
              );
              await deleteEntity("duties", duty.id);
              appData.duties = appData.duties.filter((d) => d.id !== duty.id);
            } else {
              const d = new Date(today);
              d.setDate(d.getDate() - 1);
              const yesterday = d.toISOString().split("T")[0];
              duty.end_date = yesterday;
              await saveEntity("duties", duty, duty.id);

              const futureInsts = appData.duty_instances.filter(
                (di) => di.duty_id === duty.id && di.date >= today
              );
              for (const inst of futureInsts) {
                await deleteEntity("attendance/by-instance", inst.id);
                appData.attendance = appData.attendance.filter(
                  (a) => a.duty_instance_id !== inst.id
                );
                await deleteEntity("duties/instances", inst.id);
              }
              appData.duty_instances = appData.duty_instances.filter(
                (di) => !(di.duty_id === duty.id && di.date >= today)
              );
            }
          }

          const affectedPeople = getSectorPeople(id);
          affectedPeople.forEach(p => recalcAttendancePct(p.id));

          await deleteEntity("sectors", id);
          appData.sectors = appData.sectors.filter((s) => s.id !== id);
          selectedLeafId = null;
          renderSectors();
          updateDutyBadge();
          toast("Leaf sector deleted.");
        } catch (err) {
          console.error(err);
          toast("Deletion failed.");
        } finally {
          hideLoading();
        }
      }
    );

  // -------------------------------------------------------------
  // Category deletion – one popup for all children
  // -------------------------------------------------------------
  } else {
    showConfirm(
      "Delete Category",
      `<p>Delete <strong>${sec.name}</strong> and all its leaf sectors?</p>
       <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:14px;">
         <input type="checkbox" id="deleteCatHistory" />
         Also permanently delete past attendance records for all leaf sectors inside this category
       </label>`,
      async () => {
        showLoading();
        try {
          const clearHistory =
            document.getElementById("deleteCatHistory")?.checked || false;
          const children = appData.sectors.filter((s) => s.parent_id === id);
          for (const child of children) {
            // Silently delete each leaf, passing the user’s history choice
            await deleteSector(child.id, { skipConfirm: true, clearHistory });
          }
          await deleteEntity("sectors", id);
          appData.sectors = appData.sectors.filter((s) => s.id !== id);
          currentSectorPath = [];
          selectedLeafId = null;
          renderSectors();
          toast("Category deleted.");
        } catch (err) {
          console.error(err);
          toast("Deletion failed.");
        } finally {
          hideLoading();
        }
      }
    );
  }
}
async function removeFromSector(sectorId, libId) {
  if (removingInProgress) return;
  removingInProgress = true;
  showLoading();

  const lib = getLib(libId);
  const sec = getSector(sectorId);
  if (!lib || !sec) {
    removingInProgress = false;
    hideLoading();
    return;
  }

  Swal.fire({
    title: "Remove from Sector",
    html: `
      <p>Remove <strong>${lib.name}</strong> from <strong>${sec.name}</strong>?</p>
      <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:14px;">
        <input type="checkbox" id="removeHistoryCheck" />
        Also permanently delete their past attendance records for this sector
      </label>
    `,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Remove",
    cancelButtonText: "Cancel",
    reverseButtons: true,
    preConfirm: () => {
      // Get the checkbox from the Swal popup itself (always works)
      const checkbox = Swal.getPopup().querySelector("#removeHistoryCheck");
      return {
        clearHistory: checkbox ? checkbox.checked : false,
      };
    },
  }).then(async (result) => {
    if (!result.isConfirmed) {
      removingInProgress = false;
      hideLoading();
      return;
    }

    const { clearHistory } = result.value;

    try {
      // 1. Remove assignment
      const headers = {};
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${API_BASE}/sectors/assignments/${sectorId}/${libId}`, {
        method: "DELETE",
        headers,
      });
      appData.sector_assignments = appData.sector_assignments.filter(
        (a) => !(a.sector_id === sectorId && a.librarian_id === libId)
      );

      // 2. Handle attendance for this librarian in this sector's duties
      const duties = appData.duties.filter((d) => d.sector_id === sectorId);
      for (const duty of duties) {
        const instances = appData.duty_instances.filter(
          (di) => di.duty_id === duty.id
        );

        const attToDelete = appData.attendance.filter(
          (a) =>
            a.librarian_id === libId &&
            instances.some((inst) => inst.id === a.duty_instance_id)
        );

        if (!clearHistory) {
          // Only delete future attendance (today + future)
          const futureAtt = attToDelete.filter((att) => {
            const inst = instances.find((i) => i.id === att.duty_instance_id);
            return inst && inst.date >= getToday();
          });
          for (const att of futureAtt) {
            await deleteEntity("attendance", att.id);
          }
          appData.attendance = appData.attendance.filter(
            (a) => !futureAtt.some((fa) => fa.id === a.id)
          );
          recalcAttendancePct(libId);
        } else {
          // Delete ALL attendance for this librarian in this sector
          for (const att of attToDelete) {
            await deleteEntity("attendance", att.id);
          }
          appData.attendance = appData.attendance.filter(
            (a) => !attToDelete.some((fa) => fa.id === a.id)
          );
          recalcAttendancePct(libId);
        }
      }

      // 3. Sync remaining (adds missing people, no removal)
      await syncDutyInstancesForSector(sectorId);

      // 4. Refresh UI
      renderCurrentPage();

      const mgmtModal = document.getElementById("sectorManagementModal");
      if (mgmtModal && mgmtModal.classList.contains("active")) {
        if (currentManagementLibId) {
          viewSectorManagement(currentManagementLibId);
        }
      }

      toast("Removed.");
    } catch (err) {
      console.error(err);
      toast("Removal failed.");
    } finally {
      removingInProgress = false;
      hideLoading();
    }
  });
}

async function removeAllFromSector(secId) {
  if (removingInProgress) return;
  removingInProgress = true;

  const people = getSectorPeople(secId);
  if (!people.length) {
    removingInProgress = false;
    toast("No people to remove.");
    return;
  }

  const sec = getSector(secId);
  if (!sec) {
    removingInProgress = false;
    return;
  }

  Swal.fire({
    title: "Remove All",
    html: `
      <p>Remove all <strong>${people.length}</strong> junior librarians from <strong>${sec.name}</strong>?</p>
      <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:14px;">
        <input type="checkbox" id="removeAllHistoryCheck" />
        Also permanently delete their past attendance records for this sector
      </label>
    `,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Remove All",
    cancelButtonText: "Cancel",
    reverseButtons: true,
    preConfirm: () => {
      return {
        clearHistory: document.getElementById("removeAllHistoryCheck").checked,
      };
    },
  }).then(async (result) => {
    if (!result.isConfirmed) {
      removingInProgress = false;
      return;
    }

    showLoading();
    const { clearHistory } = result.value;

    try {
      // Delete all assignments for this sector
      const headers = {};
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${API_BASE}/sectors/assignments/by-sector/${secId}`, {
        method: "DELETE",
        headers,
      });
      appData.sector_assignments = appData.sector_assignments.filter(
        (a) => a.sector_id !== secId
      );

      // Clean up attendance for all removed people
      const duties = appData.duties.filter((d) => d.sector_id === secId);
      for (const duty of duties) {
        const instances = appData.duty_instances.filter(
          (di) => di.duty_id === duty.id
        );

        const libIds = people.map((p) => p.id);
        const attToDelete = appData.attendance.filter(
          (a) =>
            libIds.includes(a.librarian_id) &&
            instances.some((inst) => inst.id === a.duty_instance_id)
        );

        if (!clearHistory) {
          const futureAtt = attToDelete.filter((att) => {
            const inst = instances.find((i) => i.id === att.duty_instance_id);
            return inst && inst.date >= getToday();
          });
          for (const att of futureAtt) {
            await deleteEntity("attendance", att.id);
          }
          appData.attendance = appData.attendance.filter(
            (a) => !futureAtt.some((fa) => fa.id === a.id)
          );
        } else {
          for (const att of attToDelete) {
            await deleteEntity("attendance", att.id);
          }
          appData.attendance = appData.attendance.filter(
            (a) => !attToDelete.some((fa) => fa.id === a.id)
          );
        }
      }

      await syncDutyInstancesForSector(secId);
      people.forEach(p => recalcAttendancePct(p.id));   // ★ added

      renderCurrentPage();
      toast("All removed.");
    } catch (err) {
      console.error(err);
      toast("Removal failed.");
    } finally {
      removingInProgress = false;
      hideLoading();
    }
  });
}
function openAddPeopleModal(secId) {
  const sector = getSector(secId);
  if (!sector) return;
  const allLibs = appData.librarians.filter((l) => !l.is_deleted);
  const assignedIds = appData.sector_assignments
    .filter((a) => a.sector_id === secId)
    .map((a) => a.librarian_id);

  let html = `<h4>Add People to ${sector.name}</h4><div style="max-height:300px;overflow-y:auto;">`;
  allLibs.forEach((l) => {
    const checked = assignedIds.includes(l.id);
    html += `<label style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:${
      checked ? "#dcfce7" : "#f8fafc"
    }"><input type="checkbox" class="add-people-check" value="${l.id}" ${
      checked ? "checked" : ""
    }> ${l.name} (${l.adm_no})</label>`;
  });
  html += `</div><button class="btn btn-primary btn-sm" onclick="saveAddPeople('${secId}')">Save</button>`;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.id = "addPeopleModal";
  overlay.style.zIndex = modalZIndex + 10;
  overlay.innerHTML = `
    <div class="modal" style="z-index:${modalZIndex + 11};">
      <div class="modal-header">
        <h3>Add People</h3>
        <button class="close-btn" onclick="closeModal('addPeopleModal')">×</button>
      </div>
      <div class="modal-body">${html}</div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveAddPeople(secId) {
  showLoading();
  try {
    const checks = document.querySelectorAll(".add-people-check");
    const toAdd = [];
    const toRemove = [];
    checks.forEach((cb) => {
      if (
        cb.checked &&
        !appData.sector_assignments.some(
          (a) => a.sector_id === secId && a.librarian_id === cb.value
        )
      ) {
        toAdd.push(cb.value);
      } else if (!cb.checked) {
        toRemove.push(cb.value);
      }
    });
    for (const libId of toAdd) {
      const saved = await saveEntity("sectors/assignments", {
        sector_id: secId,
        librarian_id: libId,
        assigned_at: new Date().toISOString(),
      });
      appData.sector_assignments.push(saved);
    }
    for (const libId of toRemove) {
      const headers = {};
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${API_BASE}/sectors/assignments/${secId}/${libId}`, {
        method: "DELETE",
        headers,
      });
      appData.sector_assignments = appData.sector_assignments.filter(
        (a) => !(a.sector_id === secId && a.librarian_id === libId)
      );
    }

    // ★ Force today’s instance and manually add each new librarian
    await generateDutyInstancesForDate(getToday());
    const today = getToday();
    const duties = appData.duties.filter(d => d.sector_id === secId);
    for (const libId of toAdd) {
      for (const duty of duties) {
        if (dutyOccursOnDate(duty, today)) {
          let inst = appData.duty_instances.find(
            di => di.duty_id === duty.id && di.date === today
          );
          if (!inst) {
            const newInst = {
              duty_id: duty.id,
              date: today,
              is_active: true,
              created_at: new Date().toISOString(),
            };
            const savedInst = await saveEntity("duties/instances", newInst);
            appData.duty_instances.push(savedInst);
            inst = savedInst;
          }
          if (!appData.attendance.some(a => a.duty_instance_id === inst.id && a.librarian_id === libId)) {
            const att = {
              duty_instance_id: inst.id,
              librarian_id: libId,
              attended: false,
              confirmed_by: "system",
              confirmed_at: new Date().toISOString(),
              forgiven: false,
              punishment_issued: false,
            };
            const savedAtt = await saveEntity("attendance", att);
            appData.attendance.push(savedAtt);
            recalcAttendancePct(libId);
          }
        }
      }
    }

    await syncDutyInstancesForSector(secId);

    closeModal("addPeopleModal");
    renderSectors();
    if (currentPage === "attendance") {
      renderAttendance();
    }
    toast("People updated.");
  } catch (err) {
    console.error(err);
    toast("Update failed.");
  } finally {
    hideLoading();
  }
}

function renderDuties() {
  const filter = document.getElementById("dutyFilter").value;
  const hasLibrarians = document.getElementById("dutyHasLibrarians").checked;
  let duties = [...appData.duties];
  const today = getToday();
  const weekDates = getWeekDates(); // from your helpers

  if (filter === "today") {
    duties = duties.filter((d) =>
      appData.duty_instances.some(
        (di) => di.duty_id === d.id && di.date === today
      )
    );
  } else if (filter === "week") {
    duties = duties.filter((d) =>
      appData.duty_instances.some(
        (di) => di.duty_id === d.id && weekDates.includes(di.date)
      )
    );
  } else if (filter === "punishment") {
    duties = duties.filter((d) => d.is_punishment);
  }

  if (hasLibrarians) {
    duties = duties.filter((d) => {
      const hasAttendance = appData.duty_instances
        .filter((di) => di.duty_id === d.id)
        .some((di) =>
          appData.attendance.some((a) => a.duty_instance_id === di.id)
        );
      if (hasAttendance) return true;
      if (d.sector_id) {
        const sector = getSector(d.sector_id);
        return sector && getSectorPeople(sector.id).length > 0;
      }
      return false;
    });
  }

  const container = document.getElementById("dutyContainer");
  if (!duties.length) {
    container.innerHTML = '<p class="text-muted">No duties found.</p>';
    return;
  }

if (isCalendarView) {
  // Get the month and year from the global date navigator (or currentViewDate)
  const [year, month] = currentViewDate.split("-").slice(0, 2).map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();

  // Build the filtered set of duty IDs that match the current dropdown selection
  // Re‑compute the duties that should appear (respect the filter)
  let visibleDuties = [];
  const today = getToday();
  const weekDates = getWeekDates();
  if (filter === "today") {
    visibleDuties = appData.duties.filter(d =>
      appData.duty_instances.some(di => di.duty_id === d.id && di.date === today)
    );
  } else if (filter === "week") {
    visibleDuties = appData.duties.filter(d =>
      appData.duty_instances.some(di => di.duty_id === d.id && weekDates.includes(di.date))
    );
  } else if (filter === "punishment") {
    visibleDuties = appData.duties.filter(d => d.is_punishment);
  } else {
    visibleDuties = [...appData.duties]; // "all" or "all active"
  }

  // If "Has Librarians" is checked, further filter
  if (hasLibrarians) {
    visibleDuties = visibleDuties.filter(d => {
      const hasAttendance = appData.duty_instances
        .filter(di => di.duty_id === d.id)
        .some(di => appData.attendance.some(a => a.duty_instance_id === di.id));
      if (hasAttendance) return true;
      if (d.sector_id) {
        const sector = getSector(d.sector_id);
        return sector && getSectorPeople(sector.id).length > 0;
      }
      return false;
    });
  }

  const visibleDutyIds = new Set(visibleDuties.map(d => d.id));

  // Gather duty instances only for the visible duties and this month
  const dutiesForMonth = appData.duty_instances.filter(
    di => di.date.startsWith(`${year}-${String(month).padStart(2,"0")}`) && di.is_active && visibleDutyIds.has(di.duty_id)
  );
  const dutiesByDate = {};
  dutiesForMonth.forEach(di => {
    const date = di.date;
    if (!dutiesByDate[date]) dutiesByDate[date] = [];
    const duty = appData.duties.find(d => d.id === di.duty_id);
    if (duty) dutiesByDate[date].push(duty);
  });

  // Month navigation buttons
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  let calHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <button class="btn btn-secondary btn-sm" onclick="navigateCalendarMonth(${prevYear}, ${prevMonth})">◀ ${prevMonth}/${prevYear}</button>
      <strong>${new Date(year, month-1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
      <button class="btn btn-secondary btn-sm" onclick="navigateCalendarMonth(${nextYear}, ${nextMonth})">${nextMonth}/${nextYear} ▶</button>
    </div>
    <div class="calendar-grid">
  `;
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(h => calHtml += `<div class="day-header">${h}</div>`);
  for (let i = 0; i < firstDay; i++) calHtml += `<div class="day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const isToday = dateStr === today;
    const isPast = dateStr < today;
    calHtml += `<div class="day ${isToday ? "today" : ""} ${isPast ? "past" : ""}">`;
    calHtml += `<div class="date-num">${d}</div>`;
    if (dutiesByDate[dateStr]) {
      dutiesByDate[dateStr].forEach(duty => {
        calHtml += `<div class="duty-item ${duty.is_punishment ? "punishment" : "regular"} ${isPast ? "past" : ""}" onclick="showDutyActions('${duty.id}')">${duty.name}</div>`;
      });
    }
    calHtml += `</div>`;
  }
  calHtml += `</div>`;
  container.innerHTML = calHtml;
  return;
}

  // Card view
  container.innerHTML = duties
    .map((d) => {
      const instances = appData.duty_instances.filter(
        (di) => di.duty_id === d.id
      );
      const total = instances.reduce(
        (s, di) =>
          s +
          appData.attendance.filter((a) => a.duty_instance_id === di.id).length,
        0
      );
      const attended = instances.reduce(
        (s, di) =>
          s +
          appData.attendance.filter(
            (a) => a.duty_instance_id === di.id && (a.attended || a.forgiven)
          ).length,
        0
      );

      // ---- minimal sector path addition ----
      let sectorLine = '';
      if (d.sector_id) {
        const path = getSectorPath(d.sector_id);
        if (path) {
          sectorLine = `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📂 ${path}</div>`;
        }
      } else {
        sectorLine = `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📌 Standalone</div>`;
      }
      // ------------------------------------

      return `<div class="duty-card ${d.is_punishment ? "punishment" : ""}">
      <div class="duty-header">
        <div>
     <span class="duty-title">
  ${d.name}
  ${d.end_date && d.end_date < getToday() ? '<span class="tag-badge punishment" style="margin-left:6px;">Ended</span>' : ''}
</span>
<span class="duty-meta">${formatTime(d.start_time)}-${formatTime(d.end_time)} · ${d.days.map(getDayName).join(", ")}</span>
${sectorLine}
        </div>
        <div class="duty-actions">
          <span>${attended}/${total} attended</span>
          <button class="action-btn" onclick="showDutyActions('${
            d.id
          }')">⚙️</button>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function syncLocalNotifications() {
  // Build the entire local notification list from the current attendance state
  const missedRecords = appData.attendance.filter((a) => {
    if (a.attended || a.forgiven || a.punishment_issued) return false;
    const instance = appData.duty_instances.find(
      (di) => di.id === a.duty_instance_id
    );
    return instance !== undefined;
  });

  const otherNotifs = appData.notifications.filter(
    (n) => n.type !== "cumulative_all"
  );

  const newCumulative = [];

  if (missedRecords.length > 0) {
    const grouped = {};
    missedRecords.forEach((att) => {
      const libId = att.librarian_id;
      if (!grouped[libId]) grouped[libId] = [];
      grouped[libId].push(att);
    });

    for (const [libId, records] of Object.entries(grouped)) {
      const lib = getLib(libId);
      // ★★★ Skip deleted librarians ★★★
      if (!lib || lib.is_deleted) continue;

      const totalMissed = records.length;
      const daysSet = new Set();
      records.forEach((att) => {
        const instance = appData.duty_instances.find(
          (di) => di.id === att.duty_instance_id
        );
        if (instance) daysSet.add(instance.date);
      });
      const distinctDays = daysSet.size;

      newCumulative.push({
        id: "local_" + libId,
        message: `⚠️ ${lib.name} missed ${totalMissed} duties across ${distinctDays} day(s)`,
        type: "cumulative_all",
        librarian_id: libId,
        date: getToday(),
        is_read: false,
        is_forgotten: false,
        is_dismissed: false,
      });
    }
  }

  appData.notifications = [...otherNotifs, ...newCumulative];
}
function showDutyActions(dutyId) {
  const duty = appData.duties.find((d) => d.id === dutyId);
  if (!duty) return;
  document.getElementById("actionPopupTitle").textContent = `⚙️ ${duty.name}`;
  document.getElementById("actionPopupContent").innerHTML = `
    <button class="btn btn-primary" style="width:100%;" onclick="editDuty('${dutyId}');closeModal('actionPopup');">✏️ Edit</button>
    <button class="btn btn-danger" style="width:100%;" onclick="deleteDuty('${dutyId}');closeModal('actionPopup');">🗑️ Delete</button>`;
  openModal("actionPopup");
}

let createDutySectorId = null;

function openCreateDuty(leafSectorId = null) {
  createDutySectorId = leafSectorId;
  document.getElementById("dutyName").value = "";
  document.getElementById("dutyStart").value = "";
  document.getElementById("dutyEnd").value = "";
  document.querySelectorAll(".duty-day").forEach((cb) => (cb.checked = false));
  document.getElementById("dutyEndDate").value = "";
  document.getElementById("dutyRecurrence").value = "weekly";
  document.getElementById("dutyIsPunishment").value = "false";
  specificDatesList = [];
  document.getElementById("specificDatesList").innerHTML = "";
  document.getElementById("specificDatesContainer").style.display = "none";
  document.getElementById("recurrenceExtra").style.display = "none";

  const checkboxContainer = document.getElementById("dutyLibrarianCheckboxes");
  if (leafSectorId) {
    checkboxContainer.innerHTML =
      '<p class="text-muted">📌 Librarians are automatically taken from the leaf sector.</p>';
  } else {
    populateDutyLibrarians();
  }
  openModal("dutyModal");
}

function openCreateDutyForSector(secId) {
  openCreateDuty(secId);
}

function populateDutyLibrarians() {
  const container = document.getElementById("dutyLibrarianCheckboxes");
  const librarians = appData.librarians.filter((l) => !l.is_deleted);
  let html = `<table><thead><tr><th>Select</th><th>Name</th><th>Grade</th><th>Adm No.</th></tr></thead><tbody>`;
  librarians.forEach((l) => {
    html += `<tr><td><input type="checkbox" class="duty-lib-check" value="${l.id}" checked></td><td>${l.name}</td><td>${l.grade}</td><td>${l.adm_no}</td></tr>`;
  });
  html += `</tbody></table>`;
  html += `<div><button class="btn btn-secondary btn-sm" onclick="selectAllDutyLibrarians(true)">Select All</button> <button class="btn btn-secondary btn-sm" onclick="selectAllDutyLibrarians(false)">Clear All</button></div>`;
  container.innerHTML = html;
}

function selectAllDutyLibrarians(sel) {
  document
    .querySelectorAll(".duty-lib-check")
    .forEach((cb) => (cb.checked = sel));
}

async function createDuty() {
  const name = document.getElementById("dutyName").value.trim();
  const start = document.getElementById("dutyStart").value;
  const end = document.getElementById("dutyEnd").value;
  const recurrence = document.getElementById("dutyRecurrence").value;
  const isPunishment =
    document.getElementById("dutyIsPunishment").value === "true";
  const endDate = document.getElementById("dutyEndDate").value || null;
  const interval =
    recurrence === "biweekly"
      ? parseInt(document.getElementById("recurrenceInterval").value) || 1
      : null;
  const days = [];
  document
    .querySelectorAll(".duty-day:checked")
    .forEach((cb) => days.push(cb.value));
  const specificDates =
    recurrence === "specific" ? [...specificDatesList] : null;

  if (!name || !start || !end || days.length === 0) {
    Swal.fire("Error", "Fill all fields and select days.", "error");
    return;
  }
  if (start >= end) {
    Swal.fire("Error", "End must be after start.", "error");
    return;
  }

  let libs = [];
  if (createDutySectorId) {
    libs = getSectorPeople(createDutySectorId).map((p) => p.id);
    if (libs.length === 0) {
      Swal.fire(
        "Error",
        "The leaf sector has no librarians assigned.",
        "error"
      );
      return;
    }
  } else {
    document
      .querySelectorAll(".duty-lib-check:checked")
      .forEach((cb) => libs.push(cb.value));
    if (libs.length === 0) {
      Swal.fire("Error", "Select at least one librarian.", "error");
      return;
    }
  }

  // ---- temporary duty for instant UI ----
  const tempDuty = {
    id: "temp_" + Date.now(),
    name,
    start_time: start,
    end_time: end,
    days,
    recurrence_type: recurrence,
    specific_dates: specificDates,
    recurrence_interval: interval,
    end_date: endDate,
    is_punishment: isPunishment,
    sector_id: createDutySectorId || null,
    created_by: appData.current_user,
    created_at: new Date().toISOString(),
    _temp: true,
  };

  appData.duties.push(tempDuty);
  closeModal("dutyModal");
  renderCurrentPage();
  updateDutyBadge();
  toast("Creating duty…");

  try {
    const newDuty = { ...tempDuty };
    delete newDuty.id;
    delete newDuty._temp;

    const savedDuty = await saveEntity("duties", newDuty);

    // Replace temp with real duty
    const idx = appData.duties.findIndex((d) => d.id === tempDuty.id);
    if (idx !== -1) {
      appData.duties[idx] = { ...savedDuty, id: savedDuty._id };
    } else {
      appData.duties.push({ ...savedDuty, id: savedDuty._id });
    }

    // If sector-linked, update sector's duty_settings_list
    if (createDutySectorId) {
      const sector = getSector(createDutySectorId);
      if (sector) {
        if (!sector.duty_settings_list) sector.duty_settings_list = [];
        sector.duty_settings_list.push({
          name,
          start_time: start,
          end_time: end,
          days,
          recurrence,
          recurrence_interval: interval,
          specific_dates: specificDates,
          is_punishment: isPunishment,
          end_date: endDate,
        });
        await saveEntity("sectors", sector, sector.id);
      }
    }

    // Generate today's instance if it occurs
    const today = getToday();
    if (dutyOccursOnDate(savedDuty, today)) {
      const newInst = {
        duty_id: savedDuty.id,
        date: today,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      const savedInst = await saveEntity("duties/instances", newInst);
      appData.duty_instances.push(savedInst);
      for (const libId of libs) {
        const att = {
          duty_instance_id: savedInst.id,
          librarian_id: libId,
          attended: false,
          confirmed_by: "system",
          confirmed_at: new Date().toISOString(),
          forgiven: false,
          punishment_issued: false,
        };
        const savedAtt = await saveEntity("attendance", att);
        appData.attendance.push(savedAtt);
        recalcAttendancePct(libId); 
      }
    }

    renderCurrentPage();
    updateDutyBadge();
    toast(`Duty "${name}" created.`);
  } catch (err) {
    appData.duties = appData.duties.filter((d) => d.id !== tempDuty.id);
    renderCurrentPage();
    toast("Error creating duty – rolled back.");
    console.error(err);
  }
}

async function markAttendedFromNotification(recordId, btn) {
  if (btn && btn.disabled) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⏳";
  }

  const attendanceRecord = appData.attendance.find((a) => a.id === recordId);
  const libId = attendanceRecord ? attendanceRecord.librarian_id : null;

  // Optimistic: remove the row in the popup immediately
  if (libId) {
    buildNotificationPopupExcluding(libId, recordId);
  }

  // Update the main list and badge instantly using local sync
  syncLocalNotifications();
  if (currentPage === "notifications") {
    renderNotifications();
  } else {
    updateNotificationBadge();
  }

  // Fire-and-forget server task (does not change the UI optimistically)
  (async () => {
    try {
      await forgiveAttendanceRecord(recordId);
      await generateMissedNotifications(); // updates server only
      // After server confirms, sync local again just to be safe
      syncLocalNotifications();
      if (currentPage === "notifications") renderNotifications();
      else updateNotificationBadge();
    } catch (err) {
      console.error(err);
      toast("Failed to mark as attended – reverted.");
      // Revert to previous state
      syncLocalNotifications();
      renderNotifications();
    }
  })();
}

// Helper: check if a duty occurs on a given date (reuse logic from generateDutyInstancesForDate)
function dutyOccursOnDate(duty, date) {
  const dutyCreatedDate = duty.created_at.split("T")[0];
  if (date < dutyCreatedDate) return false;
  const dayName = new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
  });
  if (duty.recurrence_type === "specific") {
    return (duty.specific_dates || []).includes(date);
  } else if (duty.recurrence_type === "biweekly") {
    if (!duty.days.includes(dayName)) return false;
    const creationDate = new Date(duty.created_at);
    creationDate.setHours(0, 0, 0, 0);
    const currentDate = new Date(date);
    currentDate.setHours(0, 0, 0, 0);

    const firstOccurrence = new Date(creationDate);
    while (
      firstOccurrence.toLocaleDateString("en-US", { weekday: "long" }) !==
      dayName
    ) {
      firstOccurrence.setDate(firstOccurrence.getDate() + 1);
    }

    const diffDays = Math.floor(
      (currentDate.getTime() - firstOccurrence.getTime()) / 86400000
    );
    const intervalWeeks = duty.recurrence_interval || 1;
    return diffDays >= 0 && diffDays % ((intervalWeeks + 1) * 7) === 0;
  } else {
    if (!duty.days.includes(dayName)) return false;
    if (duty.end_date && date > duty.end_date) return false;
    return true;
  }
}

async function generateDutyInstancesForDate(date) {
  if (date < getToday()) return;

  for (const duty of appData.duties) {
    const dutyCreatedDate = duty.created_at.split("T")[0];
    if (date < dutyCreatedDate) continue;
    const dayName = new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
    });
    let occurs = false;
    if (duty.recurrence_type === "specific") {
      occurs = (duty.specific_dates || []).includes(date);
    } else if (duty.recurrence_type === "biweekly") {
      if (duty.days.includes(dayName)) {
        const creationDate = new Date(duty.created_at);
        creationDate.setHours(0, 0, 0, 0);
        const currentDate = new Date(date);
        currentDate.setHours(0, 0, 0, 0);
        const firstOccurrence = new Date(creationDate);
        while (
          firstOccurrence.toLocaleDateString("en-US", { weekday: "long" }) !==
          dayName
        ) {
          firstOccurrence.setDate(firstOccurrence.getDate() + 1);
        }
        const diffDays = Math.floor(
          (currentDate.getTime() - firstOccurrence.getTime()) / 86400000
        );
        const intervalWeeks = duty.recurrence_interval || 1;
        if (diffDays >= 0 && diffDays % ((intervalWeeks + 1) * 7) === 0)
          occurs = true;
      }
    } else {
      if (duty.days.includes(dayName)) occurs = true;
    }
    if (occurs && duty.end_date && date > duty.end_date) occurs = false;
    if (
      occurs &&
      !appData.duty_instances.some(
        (di) => di.duty_id === duty.id && di.date === date
      )
    ) {
      const newInst = {
        duty_id: duty.id,
        date,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      // ★ silent save – no loading bar
      const savedInst = await saveEntity(
        "duties/instances",
        newInst,
        null,
        true
      );
      appData.duty_instances.push(savedInst);

      let libIds = [];
      
      if (duty.sector_id) {
        // Sector‑linked duties always use the current sector members
        libIds = getSectorPeople(duty.sector_id).map((p) => p.id);
      } else {
        // Standalone duties: use the most recent instance as a template
        const allOtherInstances = appData.duty_instances.filter(
          (di) => di.duty_id === duty.id && di.id !== savedInst.id
        );
        let templateInst = null;
        if (allOtherInstances.length > 0) {
          templateInst = allOtherInstances.reduce((latest, inst) => {
            return inst.date > latest.date ? inst : latest;
          }, allOtherInstances[0]);
        }

        if (templateInst) {
          const templateRecords = appData.attendance.filter(
            (a) => a.duty_instance_id === templateInst.id
          );
          libIds = templateRecords.map((r) => r.librarian_id);
        }
      }
      
      for (const libId of libIds) {
        const att = {
          duty_instance_id: savedInst.id,
          librarian_id: libId,
          attended: false,
          confirmed_by: "system",
          confirmed_at: new Date().toISOString(),
          forgiven: false,
          punishment_issued: false,
        };
        // ★ silent save – no loading bar
        const savedAtt = await saveEntity("attendance", att, null, true);
        appData.attendance.push(savedAtt);
        recalcAttendancePct(libId);
      }
    }
  }
}

function toggleWizardRecurrence() {
  const rec = document.getElementById("wizardDutyRecurrence").value;
  document.getElementById("wizardRecurrenceExtra").style.display =
    rec === "biweekly" ? "block" : "none";
  document.getElementById("wizardSpecificDatesContainer").style.display =
    rec === "specific" ? "block" : "none";
}

function addWizardSpecificDate() {
  const input = document.getElementById("wizardSpecificDateInput");
  const date = input.value;
  if (!date) return;
  if (wizardSpecificDatesList.includes(date)) {
    Swal.fire("Error", "Date already added.", "error");
    return;
  }
  wizardSpecificDatesList.push(date);
  renderWizardSpecificDates();
  input.value = "";
}

function removeWizardSpecificDate(date) {
  wizardSpecificDatesList = wizardSpecificDatesList.filter((d) => d !== date);
  renderWizardSpecificDates();
}

function renderWizardSpecificDates() {
  const container = document.getElementById("wizardSpecificDatesList");
  if (!container) return;
  container.innerHTML = wizardSpecificDatesList
    .map(
      (d) =>
        `<span style="display:inline-flex;gap:4px;padding:2px 10px;background:#f8fafc;border-radius:12px;">${formatDate(
          d
        )} <span onclick="removeWizardSpecificDate('${d}')" style="cursor:pointer;color:#e53e3e;">×</span></span>`
    )
    .join("");
}

function toggleSectorIsLeaf() {
  const isLeaf = document.getElementById("sectorIsLeaf").checked;
  document.getElementById("sectorDutySettings").style.display = isLeaf
    ? "block"
    : "none";
}

function renderLeafContent(secId) {
  const sector = getSector(secId);
  if (!sector) return "";
  const minPeople = sector.min_people || 1;
  const people = getSectorPeople(secId);
  const duties = appData.duties.filter((d) => d.sector_id === secId);
  const isFull = people.length >= minPeople;

  return `
    <div class="sector-leaf-content">
      <div class="leaf-content-header">
        <h3>📄 ${sector.name}</h3>
        <span class="staffing-badge ${isFull ? "staffed" : "understaffed"}">
          ${isFull ? "✅" : "⚠️"} ${
    people.length
  }/${minPeople} junior librarians
        </span>
      </div>
      ${
        sector.description
          ? `<div class="description-text">${sector.description}</div>`
          : ""
      }
      
      <div style="font-weight:600; font-size:15px; margin-bottom:10px;">📋 Duties</div>
      ${
        duties.length
          ? duties
              .map(
                (d) => `
          <div class="duty-card-compact">
            <div class="duty-info">
              <div class="duty-name">${d.name}</div>
              <div class="duty-meta">${d.days
                .map(getDayName)
                .join(", ")} · ${formatTime(d.start_time)}-${formatTime(
                  d.end_time
                )}</div>
            </div>
            <div class="duty-actions">
              <button onclick="event.stopPropagation(); editDuty('${
                d.id
              }')" title="Edit">✏️</button>
              <button class="delete-btn" onclick="event.stopPropagation(); deleteDuty('${
                d.id
              }')" title="Delete">🗑️</button>
            </div>
          </div>`
              )
              .join("")
          : '<div style="color:#f59e0b; font-size:14px;">⚠️ No duties set</div>'
      }
      <button class="btn btn-primary btn-sm" onclick="openCreateDutyForSector('${secId}')" style="margin-top:12px;">+ Add Duty</button>

      <div class="people-section">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>👤 Junior Librarians (${people.length})</h4>
          <div>
            <button class="btn btn-primary btn-sm" onclick="openAddPeopleModal('${secId}')">+ Add</button>
            <button class="btn btn-danger btn-sm" onclick="removeAllFromSector('${secId}')">✕ Remove All</button>
          </div>
        </div>
        <table class="people-table">
          <thead><tr><th>Name</th><th>Grade</th><th>Adm No.</th><th>House</th><th>Tags</th><th>Att</th><th></th></tr></thead>
          <tbody>
            ${people
              .map((p) => {
                const tags = getLibTags(p.id);
                const pct = getAttendancePct(p.id);
                return `<tr>
                <td>${p.name}</td>
                <td>${p.grade}</td>
                <td>${p.adm_no}</td>
                <td>${p.house || "—"}</td>
                <td>
                  ${
                    tags.length === 1
                      ? `<span class="tag-badge ${tagColor(
                          tags[0].type
                        )}" onclick="event.stopPropagation();viewTagDetails('${
                          tags[0].id
                        }')">${tags[0].name}</span>`
                      : tags.length > 1
                      ? `<span class="tag-badge tags-btn" onclick="event.stopPropagation();showAllTagsPopup('${p.id}')">Tags (${tags.length})</span>`
                      : "—"
                  }
                </td>
                <td><span class="${
                  pct === "N/A"
                    ? "text-muted"
                    : pct <= 30
                    ? "text-danger"
                    : pct <= 60
                    ? "text-warning"
                    : "text-success"
                }">${pct === "N/A" ? "N/A" : pct + "%"}</span></td>
                <td><button class="btn btn-danger btn-sm" onclick="removeFromSector('${secId}','${
                  p.id
                }')">✕</button></td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Toggle login/register/forgot forms
document.getElementById("showRegister").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "block";
  document.getElementById("forgotForm").style.display = "none";
  document.getElementById("showRegister").style.display = "none";
  document.getElementById("showForgot").style.display = "none";
  document.getElementById("showLogin").style.display = "inline";
});
document.getElementById("showForgot").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("forgotForm").style.display = "block";
  document.getElementById("showRegister").style.display = "none";
  document.getElementById("showForgot").style.display = "none";
  document.getElementById("showLogin").style.display = "inline";
});
document.getElementById("showLogin").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("loginForm").style.display = "block";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("forgotForm").style.display = "none";
  document.getElementById("showRegister").style.display = "inline";
  document.getElementById("showForgot").style.display = "inline";
  document.getElementById("showLogin").style.display = "none";
});

function handleImageUpload(file, previewImgId, urlInputId) {
  if (!file || !file.type.startsWith("image/")) {
    Swal.fire("Error", "Please select an image file.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      // Resize to max 300x300 while keeping aspect ratio
      const maxW = 300;
      const maxH = 300;
      let w = img.width;
      let h = img.height;

      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      // Draw resized image on a canvas
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      // Convert to base64 JPEG (80% quality → small size)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

      // Set the hidden URL input value
      document.getElementById(urlInputId).value = dataUrl;

      // Show a small preview
      const preview = document.getElementById(previewImgId);
      if (preview) {
        preview.src = dataUrl;
        preview.style.display = "inline-block";
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function buildNotificationPopupExcluding(libId, excludeRecordId) {
  const lib = getLib(libId);
  if (!lib) {
    closeModal("notificationActionModal");
    return;
  }

  const missedRecords = appData.attendance.filter((a) => {
    if (a.librarian_id !== libId) return false;
    if (a.attended || a.forgiven || a.punishment_issued) return false;
    if (a.id === excludeRecordId) return false;
    const instance = appData.duty_instances.find(
      (di) => di.id === a.duty_instance_id
    );
    return instance !== undefined;
  });

  const content = document.getElementById("notificationActionContent");
  if (!content) return;

  // If no more missed records, close the modal immediately
  if (missedRecords.length === 0) {
    closeModal("notificationActionModal");
    return;
  }

  const grouped = {};
  missedRecords.forEach((rec) => {
    const instance = appData.duty_instances.find(
      (di) => di.id === rec.duty_instance_id
    );
    if (!instance) return;
    const date = instance.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push({ rec, instance });
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  let html = `
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 4px 0;">⚠️ ${lib.name} has missed duties</h4>
      <p style="margin:0; font-size:13px; color:var(--text-secondary);">Librarian: ${lib.name}</p>
    </div>
    <div style="border:1px solid var(--border); border-radius:8px;">
      <table class="notif-detail-table">
        <thead>
          <tr><th>Date</th><th>Duty</th><th>Time</th><th style="text-align:center;">Action</th></tr>
        </thead>
        <tbody>`;

  sortedDates.forEach((date) => {
    const records = grouped[date];
    records.forEach(({ rec, instance }, idx) => {
      const duty = appData.duties.find((d) => d.id === instance.duty_id);
      if (!duty) return;
      html += `
        <tr>
          <td>${idx === 0 ? formatDateFull(date) : ""}</td>
          <td><strong>${duty.name}</strong></td>
          <td>${formatTime(duty.start_time)} – ${formatTime(duty.end_time)}</td>
          <td style="text-align:center;">
            <button class="btn btn-success btn-sm" onclick="markAttendedFromNotification('${
              rec.id
            }', this)">✅ Mark Attended</button>
          </td>
        </tr>`;
    });
  });

  html += `</tbody></table></div>`;
  content.innerHTML = html;
}
function rebuildNotificationPopup(libId) {
  const lib = getLib(libId);
  if (!lib) {
    closeModal("notificationActionModal");
    return;
  }

  const missedRecords = appData.attendance.filter((a) => {
    if (a.librarian_id !== libId) return false;
    if (a.attended || a.forgiven || a.punishment_issued) return false;
    const instance = appData.duty_instances.find(
      (di) => di.id === a.duty_instance_id
    );
    return instance !== undefined;
  });

  const content = document.getElementById("notificationActionContent");
  if (!content) return;

  if (missedRecords.length === 0) {
    closeModal("notificationActionModal");
    return;
  }

  const grouped = {};
  missedRecords.forEach((rec) => {
    const instance = appData.duty_instances.find(
      (di) => di.id === rec.duty_instance_id
    );
    if (!instance) return;
    const date = instance.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push({ rec, instance });
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  let html = `
    <div style="margin-bottom:20px;">
      <h4 style="margin:0 0 4px 0;">⚠️ ${lib.name} has missed duties</h4>
      <p style="margin:0; font-size:13px; color:var(--text-secondary);">Librarian: ${lib.name}</p>
    </div>
    <div style="border:1px solid var(--border); border-radius:8px;">
      <table class="notif-detail-table">
        <thead>
          <tr><th>Date</th><th>Duty</th><th>Time</th><th style="text-align:center;">Action</th></tr>
        </thead>
        <tbody>`;

  sortedDates.forEach((date) => {
    const records = grouped[date];
    records.forEach(({ rec, instance }, idx) => {
      const duty = appData.duties.find((d) => d.id === instance.duty_id);
      if (!duty) return;
      html += `
        <tr>
          <td>${idx === 0 ? formatDateFull(date) : ""}</td>
          <td><strong>${duty.name}</strong></td>
          <td>${formatTime(duty.start_time)} – ${formatTime(duty.end_time)}</td>
          <td style="text-align:center;">
            <button class="btn btn-success btn-sm" onclick="markAttendedFromNotification('${
              rec.id
            }', this)">✅ Mark Attended</button>
          </td>
        </tr>`;
    });
  });

  html += `</tbody></table></div>`;
  content.innerHTML = html;
}

function navigateCalendarMonth(year, month) {
  // Update the global date to the first day of that month (but not affect the actual date)
  // We'll use a temporary variable and re‑render the calendar.
  currentViewDate = `${year}-${String(month).padStart(2, "0")}-01`;
  document.getElementById("viewDate").value = currentViewDate;
  // Re‑render duties (calendar view)
  renderDuties();
}

window.addEventListener('beforeunload', (event) => {
  if (pendingAttendanceSaves.size > 0) {
    event.preventDefault();
    event.returnValue = ''; // required for modern browsers
  }
});

// ============================================
// SERVICE WORKER REGISTRATION (instant offline)
// ============================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("Service Worker registered!", reg.scope))
      .catch((err) => console.log("Service Worker registration failed:", err));
  });
}

// ----- Initial load -----
// Check for dev mode
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("dev") === "true") {
  devMode = true;
}

if (localStorage.getItem("authToken")) {
  authToken = localStorage.getItem("authToken");
  currentUser = JSON.parse(localStorage.getItem("currentUser"));
  if (currentUser) {
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("appContainer").classList.add("active");
    document.getElementById("currentUser").textContent = currentUser.username;
    document.getElementById("userAvatar").textContent = currentUser.username
      .charAt(0)
      .toUpperCase();
    appData.current_user = currentUser.username;
    initApp();
  }
} else {
  if (window.location.search.includes("token=")) {
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("resetPasswordPage").style.display = "flex";
  } else {
    document.getElementById("loginPage").style.display = "flex";
    document.getElementById("resetPasswordPage").style.display = "none";
  }
}
