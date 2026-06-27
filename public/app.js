// ============================================
// ALLIANCE LMS – public/app.js (ONLINE EDITION)
// ============================================

const API_BASE = "/api"; // assumes frontend & backend on same domain

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

let simulatedDate = null;
let currentPage = "dashboard";
let selectedLibrarianId = null;
let selectedTagId = null;
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

// ============================================
// ONLINE DATA LAYER (replaces localStorage)
// ============================================

async function loadData() {
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
      fetch(`${API_BASE}/librarians`).then((r) => r.json()),
      fetch(`${API_BASE}/sectors`).then((r) => r.json()),
      fetch(`${API_BASE}/duties`).then((r) => r.json()),
      fetch(`${API_BASE}/duties/instances`).then((r) => r.json()),
      fetch(`${API_BASE}/attendance`).then((r) => r.json()),
      fetch(`${API_BASE}/tags`).then((r) => r.json()),
      fetch(`${API_BASE}/notifications`).then((r) => r.json()),
      fetch(`${API_BASE}/halloffame/captains`).then((r) => r.json()),
      fetch(`${API_BASE}/halloffame/committees`).then((r) => r.json()),
      fetch(`${API_BASE}/sectors/assignments`).then((r) => r.json()),
    ]);
    appData.librarians = librarians;
    appData.sectors = sectors;
    appData.duties = duties;
    appData.duty_instances = dutyInstances;
    appData.attendance = attendance;
    appData.tags = tags;
    appData.notifications = notifications;
    appData.hall_of_fame_captains = captains;
    appData.hall_of_fame_committees = committees;
    appData.sector_assignments = assignments;
    const storedSettings = localStorage.getItem("settings");
    if (storedSettings) appData.settings = JSON.parse(storedSettings);
  } catch (err) {
    console.error("Failed to load data from API", err);
  }
}

async function bulkAddLibrarians() {
  const rows = document.querySelectorAll("#bulkBody tr");
  let added = 0,
    skipped = 0,
    duplicates = [];
  const promises = [];
  for (const row of rows) {
    const name = row.querySelector(".bulk-name").value.trim();
    const grade = row.querySelector(".bulk-grade").value.trim();
    const adm = row.querySelector(".bulk-adm").value.trim();
    const joined = row.querySelector(".bulk-joined").value;
    const house = row.querySelector(".bulk-house")
      ? row.querySelector(".bulk-house").value.trim()
      : "";
    if (!name || !grade || !adm || !joined) continue;
    if (appData.librarians.some((l) => l.adm_no === adm && !l.is_deleted)) {
      skipped++;
      duplicates.push(adm);
      continue;
    }
    const newLib = {
      id: genId(),
      name,
      grade,
      adm_no: adm,
      date_joined: joined,
      house,
      is_deleted: false,
      created_at: new Date().toISOString(),
    };
    promises.push(
      saveEntity("librarians", newLib).then((saved) =>
        appData.librarians.push(saved)
      )
    );
    added++;
  }
  await Promise.all(promises);
  closeModal("bulkModal");
  toast(
    `Added ${added}${
      skipped ? `, skipped ${skipped} (${duplicates.join(", ")})` : ""
    }`
  );
  renderCurrentPage();
}

async function saveEntity(type, data, id = null) {
  const url = id ? `${API_BASE}/${type}/${id}` : `${API_BASE}/${type}`;
  const method = id ? "PUT" : "POST";
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return res.json();
}

async function deleteEntity(type, id) {
  await fetch(`${API_BASE}/${type}/${id}`, { method: "DELETE" });
}

function saveData() {
  localStorage.setItem("settings", JSON.stringify(appData.settings));
  updateNotificationBadge();
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
    await deleteEntity("tags", t.id);
    await saveEntity("tags/history", {
      tag_id: t.id,
      librarian_id: t.librarian_id,
      tag_name: t.name,
      description: t.description,
      type: t.type,
      start_date: t.start_date,
      end_date: t.end_date,
      removed_at: new Date().toISOString(),
      removal_reason: "auto_expired",
    });
  }
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
  const recs = getLibAttendance(libId);
  if (!recs.length) return "N/A";
  const attended = recs.filter((r) => r.attended || r.forgiven).length;
  return Math.round((attended / recs.length) * 100);
}

// ============================================
// DUTY INSTANCE GENERATION
// ============================================
function generateDutyInstancesForDate(date) {
  // 🔒 Prevent any generation for past dates
  if (date < getToday()) return;

  appData.duties.forEach((duty) => {
    const dutyCreatedDate = duty.created_at.split("T")[0];
    if (date < dutyCreatedDate) return;
    const dayName = new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
    });
    let occurs = false;
    if (duty.recurrence_type === "specific") {
      occurs = (duty.specific_dates || []).includes(date);
    } else if (duty.recurrence_type === "biweekly") {
      if (duty.days.includes(dayName)) {
        const creationDate = new Date(duty.created_at);
        const currentDate = new Date(date);
        const firstOccurrence = new Date(creationDate);
        while (
          firstOccurrence.toLocaleDateString("en-US", { weekday: "long" }) !==
          dayName
        ) {
          firstOccurrence.setDate(firstOccurrence.getDate() + 1);
        }
        const diffDays = Math.floor((currentDate - firstOccurrence) / 86400000);
        if (
          diffDays >= 0 &&
          diffDays % ((duty.recurrence_interval + 1) * 7) === 0
        ) {
          occurs = true;
        }
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
      const instId = genId();
      appData.duty_instances.push({
        id: instId,
        duty_id: duty.id,
        date,
        is_active: true,
        created_at: new Date().toISOString(),
      });

      const template = appData.duty_instances.find(
        (di) => di.duty_id === duty.id && di.id !== instId
      );
      if (template) {
        const templateRecords = appData.attendance.filter(
          (a) => a.duty_instance_id === template.id
        );
        templateRecords.forEach((tr) => {
          const newAtt = {
            id: genId(),
            duty_instance_id: instId,
            librarian_id: tr.librarian_id,
            attended: false,
            confirmed_by: "system",
            confirmed_at: new Date().toISOString(),
            forgiven: false,
            punishment_issued: false,
            notes: null,
          };
          appData.attendance.push(newAtt);
          // Sync to server
          saveEntity("attendance", newAtt).catch((err) => console.error(err));
        });
      } else {
        if (duty.sector_id) {
          const sectorPeople = getSectorPeople(duty.sector_id);
          sectorPeople.forEach((p) => {
            const newAtt = {
              id: genId(),
              duty_instance_id: instId,
              librarian_id: p.id,
              attended: false,
              confirmed_by: "system",
              confirmed_at: new Date().toISOString(),
              forgiven: false,
              punishment_issued: false,
              notes: null,
            };
            appData.attendance.push(newAtt);
            // Sync to server
            saveEntity("attendance", newAtt).catch((err) => console.error(err));
          });
        }
      }

      // Sync the new duty instance to the server
      saveEntity("duties/instances", {
        id: instId,
        duty_id: duty.id,
        date,
        is_active: true,
      }).catch((err) => console.error(err));
    }
  });
}

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
function handleLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (username && password) {
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("appContainer").classList.add("active");
    document.getElementById("currentUser").textContent = username;
    document.getElementById("userAvatar").textContent = username
      .charAt(0)
      .toUpperCase();
    appData.current_user = username;
    saveData();
    initApp();
  } else {
    const err = document.getElementById("loginError");
    err.style.display = "block";
    setTimeout(() => (err.style.display = "none"), 3000);
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
    appData.current_user = "";
    saveData();
    location.reload();
  }
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
  }
  document.getElementById("sidebar").classList.remove("open");
}
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ============================================
// MODALS & STACKING
// ============================================
function openModal(id) {
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
    document.getElementById("sectorMin").value = "1";
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
    renderAttendanceModal();
  }
  if (id === "librarianModal")
    document.getElementById("libJoined").value = getToday();
  if (id === "bulkModal") {
    document
      .querySelectorAll("#bulkBody .bulk-joined")
      .forEach((inp) => (inp.value = getToday()));
  }
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("active");
  if (id === "sectorModal") {
    const body = document.querySelector("#sectorModal .modal-body");
    const footer = document.querySelector("#sectorModal .modal-footer");
    if (body && sectorModalOriginalBody)
      body.innerHTML = sectorModalOriginalBody;
    if (footer && sectorModalOriginalFooter)
      footer.innerHTML = sectorModalOriginalFooter;
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
function confirmAction() {} // noop

// ============================================
// GLOBAL DATE NAVIGATOR
// ============================================
function setViewDate(date) {
  const realToday = new Date().toISOString().split("T")[0];
  simulatedDate = date > realToday ? date : null;
  currentViewDate = date;
  document.getElementById("viewDate").value = date;
  document.getElementById("dateDisplay").textContent = formatDate(date);
  generateDutyInstancesForDate(date);
  renderCurrentPage();
  if (document.getElementById("attendanceDate")) {
    document.getElementById("attendanceDate").max = getToday();
  }
}
function changeDate(delta) {
  const d = new Date(currentViewDate);
  d.setDate(d.getDate() + delta);
  setViewDate(d.toISOString().split("T")[0]);
}
function onDateChange() {
  setViewDate(document.getElementById("viewDate").value);
}
function setToday() {
  simulatedDate = null;
  setViewDate(new Date().toISOString().split("T")[0]);
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
    viewSectorManagement(libId);
    renderSectors();
    toast("Added.");
  }
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
  renderDashboardTable();
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
    html += `<tr>
      <td class="${isRep ? "rep-name" : ""}">${l.name}</td>
      <td>${l.grade}</td>
      <td>${l.adm_no}</td>
      <td>${l.house || "—"}</td>
      <td style="font-size:13px;">${sectorDisplay}</td>
      <td><div class="tag-container">${tagDisplay}</div></td>
      <td><span class="${pctClass}" style="font-weight:600;">${pctDisp}</span></td>
      <td><button class="action-btn" onclick="showActionPopup('${
        l.id
      }')">⚙️</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;
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
  const newLib = {
    id: genId(),
    name,
    grade,
    adm_no: adm,
    date_joined: joined,
    house,
    is_deleted: false,
    created_at: new Date().toISOString(),
  };
  const saved = await saveEntity("librarians", newLib);
  appData.librarians.push(saved);
  closeModal("librarianModal");
  ["libName", "libGrade", "libAdm", "libJoined", "libHouse"].forEach(
    (id) => (document.getElementById(id).value = "")
  );
  renderCurrentPage();
  toast("Librarian added.");
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
    const newCaptain = {
      id: genId(),
      name,
      adm_no: adm,
      year,
      house,
      photo_url: photo,
      created_at: new Date().toISOString(),
    };
    const saved = await saveEntity("halloffame/captains", newCaptain);
    appData.hall_of_fame_captains.push(saved);
  }
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
  if (selectedTagId) {
    const tag = appData.tags.find((t) => t.id === selectedTagId);
    if (tag) {
      tag.name = name;
      tag.description = desc || "No description";
      tag.type = type;
      tag.end_date = endDate;
      tag.updated_at = new Date().toISOString();
      await saveEntity("tags", tag, tag.id);
    }
    selectedTagId = null;
  } else {
    const newTag = {
      id: genId(),
      name,
      description: desc || "No description",
      type,
      librarian_id: selectedLibrarianId,
      start_date: getToday(),
      end_date: endDate,
      is_active: true,
      duty_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      removed_at: null,
    };
    const saved = await saveEntity("tags", newTag);
    appData.tags.push(saved);
    if (type === "punishment") {
      addNotification(
        `⚠️ Punishment tag "${name}" issued for ${
          getLib(selectedLibrarianId)?.name
        }`,
        "punishment",
        selectedLibrarianId,
        null,
        saved.id
      );
    }
  }
  closeModal("tagModal");
  renderCurrentPage();
  toast(selectedTagId ? "Tag updated." : "Tag added.");
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
        id: genId(),
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
  html += `<button class="btn btn-success btn-sm ml-8" onclick="openAddLeafModal('${category.id}')">+ Add Leaf Sector</button>`;
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
  document
    .querySelectorAll(".wizard-duty-day:checked")
    .forEach((cb) => days.push(cb.value));

  if (!dutyName || !start || !end) {
    Swal.fire(
      "Error",
      "Please fill in duty name, start, and end time.",
      "error"
    );
    return;
  }
  if (start >= end) {
    Swal.fire("Error", "End time must be after start time.", "error");
    return;
  }
  if (days.length === 0) {
    Swal.fire("Error", "Please select at least one day.", "error");
    return;
  }

  const recurrence = document.getElementById("wizardDutyRecurrence").value;
  const isPunishment =
    document.getElementById("wizardDutyIsPunishment").value === "true";
  const endDate = document.getElementById("wizardDutyEndDate").value || null;
  const interval =
    recurrence === "biweekly"
      ? parseInt(document.getElementById("wizardRecurrenceInterval").value) || 1
      : null;
  const specificDates =
    recurrence === "specific" ? [...wizardSpecificDatesList] : null;

  const newSector = {
    id: genId(),
    name: window._wizardName,
    parent_id: window._wizardCategoryId,
    leader_ids: [],
    min_people: window._wizardMin,
    is_leaf: true,
    description: window._wizardDesc || null,
    duty_settings_list: [
      {
        name: dutyName,
        start_time: start,
        end_time: end,
        days: days,
        recurrence: recurrence,
        recurrence_interval: interval,
        specific_dates: specificDates,
        is_punishment: isPunishment,
        end_date: endDate,
      },
    ],
    created_at: new Date().toISOString(),
  };

  const newDuty = {
    id: genId(),
    name: dutyName,
    start_time: start,
    end_time: end,
    days: days,
    recurrence_type: recurrence,
    specific_dates: specificDates,
    recurrence_interval: interval,
    end_date: endDate || null,
    is_punishment: isPunishment,
    sector_id: newSector.id,
    created_by: appData.current_user,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save sector and duty to server
  const savedSector = await saveEntity("sectors", newSector);
  const savedDuty = await saveEntity("duties", newDuty);
  appData.sectors.push(savedSector);
  appData.duties.push(savedDuty);

  currentSectorPath = [window._wizardCategoryId];
  selectedLeafId = newSector.id;

  wizardSpecificDatesList = [];
  window._wizardName = null;
  window._wizardMin = 1;
  window._wizardDesc = "";
  window._wizardCategoryId = null;

  closeModal("sectorModal");
  renderCurrentPage();
  toast(`Leaf sector "${newSector.name}" added.`);
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
    document.getElementById("editDutyLibrarianCheckboxes").innerHTML =
      '<p class="text-muted" style="padding:10px;">📌 Librarians are automatically synced from the leaf sector.</p>';
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
  const isPunishment =
    document.getElementById("editDutyIsPunishment").value === "true";
  const endDate = document.getElementById("editDutyEndDate").value || null;
  const interval =
    recurrence === "biweekly"
      ? parseInt(document.getElementById("editRecurrenceInterval").value) || 1
      : null;
  const days = [];
  document
    .querySelectorAll(".edit-duty-day:checked")
    .forEach((cb) => days.push(cb.value));

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
    if (!libs.length) {
      Swal.fire(
        "Error",
        "This leaf sector has no junior librarians assigned yet.",
        "error"
      );
      return;
    }
  } else {
    document
      .querySelectorAll(".edit-duty-lib-check:checked")
      .forEach((cb) => libs.push(cb.value));
    if (!libs.length) {
      Swal.fire("Error", "Select at least one librarian.", "error");
      return;
    }
  }

  showConfirm(
    "⚠️ Confirm Changes",
    `<p>Editing <strong>${duty.name}</strong> will affect <strong>ALL FUTURE instances</strong>. Past instances remain unchanged.</p>`,
    async () => {
      duty.name = name;
      duty.start_time = start;
      duty.end_time = end;
      duty.days = days;
      duty.recurrence_type = recurrence;
      duty.recurrence_interval = interval;
      duty.specific_dates =
        recurrence === "specific" ? [...editSpecificDatesList] : null;
      duty.end_date = endDate;
      duty.is_punishment = isPunishment;
      duty.updated_at = new Date().toISOString();

      // Delete all future instances (today and later)
      const futureInsts = appData.duty_instances.filter(
        (di) => di.duty_id === duty.id && di.date >= getToday()
      );
      for (const inst of futureInsts) {
        await deleteEntity("duties/instances", inst.id);
        // attendance records for these instances will be removed on the server (cascade)
      }
      appData.duty_instances = appData.duty_instances.filter(
        (di) => !(di.duty_id === duty.id && di.date >= getToday())
      );
      appData.attendance = appData.attendance.filter((a) => {
        const inst = appData.duty_instances.find(
          (di) => di.id === a.duty_instance_id
        );
        return inst !== undefined;
      });

      // Save duty changes
      await saveEntity("duties", duty, duty.id);

      closeModal("editDutyModal");
      renderDuties();
      toast(
        "Duty updated – future instances will be created when those days arrive."
      );
    }
  );
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
    "Delete Duty",
    `<div>
      <p>Are you sure you want to delete <strong>${duty.name}</strong>?</p>
      <div class="confirm-warning">
        <strong>⚠️ This will affect all librarians assigned to this duty:</strong>
        <ul>
          <li>All future instances of this duty will be removed.</li>
          <li>Attendance records for this duty can optionally be deleted.</li>
          ${
            duty.is_punishment
              ? "<li>Associated punishment tags will be removed.</li>"
              : ""
          }
        </ul>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:14px;">
        <input type="checkbox" id="clearDutyHistory" />
        Also delete all attendance history for this duty
      </label>
    </div>`,
    async () => {
      const clearHistory =
        document.getElementById("clearDutyHistory")?.checked || false;
      const instances = appData.duty_instances.filter(
        (di) => di.duty_id === dutyId
      );

      if (clearHistory) {
        for (const inst of instances) {
          await deleteEntity("attendance/by-instance", inst.id);
        }
        appData.attendance = appData.attendance.filter(
          (a) => !instances.some((inst) => inst.id === a.duty_instance_id)
        );
      }

      for (const inst of instances) {
        await deleteEntity("duties/instances", inst.id);
      }
      appData.duty_instances = appData.duty_instances.filter(
        (di) => di.duty_id !== dutyId
      );

      await deleteEntity("duties", dutyId);
      appData.duties = appData.duties.filter((d) => d.id !== dutyId);

      if (duty.is_punishment) {
        appData.tags = appData.tags.filter((t) => t.duty_id !== dutyId);
        // optionally delete from server
      }

      saveData();
      renderDuties();
      toast(
        `Duty "${duty.name}" deleted.${
          clearHistory ? " Attendance history cleared." : ""
        }`
      );
    }
  );
}

// ============================================
// ATTENDANCE (past & today only)
// ============================================
function changeAttendanceDate(delta) {
  const input = document.getElementById("attendanceDate");
  const current = new Date(input.value);
  const today = new Date(getToday());

  const newDate = new Date(current);
  newDate.setDate(newDate.getDate() + delta);

  if (newDate > today) {
    if (current.getTime() === today.getTime()) {
      toast("You can't view future attendance.");
    } else {
      input.value = getToday();
      renderAttendance();
      toast("You can't view future dates. Showing today.");
    }
    return;
  }

  input.value = newDate.toISOString().split("T")[0];
  renderAttendance();
}

function renderAttendance() {
  const dateInput = document.getElementById("attendanceDate");
  let date = dateInput.value || getToday();
  dateInput.value = date;
  dateInput.max = getToday();
  if (date > getToday()) {
    document.getElementById("attendanceContainer").innerHTML =
      '<p class="text-muted">Cannot view future dates.</p>';
    return;
  }
  generateDutyInstancesForDate(date);
  const instances = appData.duty_instances.filter(
    (di) => di.date === date && di.is_active
  );
  const container = document.getElementById("attendanceContainer");
  if (!instances.length) {
    container.innerHTML = '<p class="text-muted">No duties on this date.</p>';
    return;
  }
  container.innerHTML = instances
    .map((di) => {
      const duty = appData.duties.find((d) => d.id === di.duty_id);
      if (!duty) return "";
      const records = appData.attendance.filter(
        (a) => a.duty_instance_id === di.id
      );
      return `<div class="attendance-sheet ${
        duty.is_punishment ? "punishment" : ""
      }">
        <div class="sheet-header"><div><span class="sheet-title">${
          duty.name
        }</span> <span class="sheet-meta">${formatTime(
        duty.start_time
      )}-${formatTime(duty.end_time)}</span></div>
        <div><button class="btn btn-secondary btn-sm" onclick="selectAllAttendance('${
          di.id
        }',true)">All Present</button> <button class="btn btn-secondary btn-sm" onclick="selectAllAttendance('${
        di.id
      }',false)">All Absent</button></div></div>
        <div class="sheet-people">${records
          .map((r) => {
            const lib = getLib(r.librarian_id);
            if (!lib) return "";
            const checked = r.attended || r.forgiven;
            return `<label class="person-check ${
              checked ? "present" : "absent"
            }"><input type="checkbox" class="attendance-check" data-record="${
              r.id
            }" ${checked ? "checked" : ""} onchange="toggleSingleAttendance('${
              r.id
            }', this)"> ${lib.name} ${r.forgiven ? "(forgiven)" : ""}</label>`;
          })
          .join("")}</div>
      </div>`;
    })
    .join("");
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
    generateMissedNotifications();
    saveData();
    renderAttendance();
    renderNotifications();
    toast(`Saved ${saved} records.`);
  } else toast("No changes.");
}

async function selectAllAttendance(instId, attended) {
  const records = appData.attendance.filter(
    (a) => a.duty_instance_id === instId
  );
  const promises = [];
  records.forEach((r) => {
    r.attended = attended;
    r.forgiven = false;
    r.confirmed_at = new Date().toISOString();
    r.confirmed_by = appData.current_user;
    promises.push(saveEntity("attendance", r, r.id));
  });
  await Promise.all(promises);
  renderAttendance();
  toast(`All marked ${attended ? "present" : "absent"}.`);
}

async function toggleSingleAttendance(recordId, checkbox) {
  const rec = appData.attendance.find((a) => a.id === recordId);
  if (!rec) return;
  const checked = checkbox.checked;
  rec.attended = checked;
  rec.forgiven = false;
  rec.confirmed_at = new Date().toISOString();
  rec.confirmed_by = appData.current_user;
  await saveEntity("attendance", rec, rec.id);
  const label = checkbox.closest("label");
  if (label) label.className = `person-check ${checked ? "present" : "absent"}`;
  generateMissedNotifications();
  updateNotificationBadge();
  toast(checked ? "✅ Present" : "❌ Absent");
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
            <span style="font-weight:600; font-size:14px;">${
              duty ? duty.name : "Unknown Duty"
            }</span>
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

async function toggleAttendanceStatus(recId) {
  const rec = appData.attendance.find((a) => a.id === recId);
  if (!rec) return;
  rec.attended = !rec.attended;
  rec.forgiven = false;
  rec.confirmed_at = new Date().toISOString();
  rec.confirmed_by = appData.current_user;
  await saveEntity("attendance", rec, rec.id);
  viewAttendanceHistory(rec.librarian_id);
  renderCurrentPage();
}

// ============================================
// NOTIFICATIONS (fully async)
// ============================================
function addNotification(msg, type, libId) {
  const newNotif = {
    id: genId(),
    message: msg,
    type,
    librarian_id: libId,
    date: getToday(),
    is_read: false,
    is_forgotten: false,
    is_dismissed: false,
    created_at: new Date().toISOString(),
  };
  appData.notifications.push(newNotif);
  saveEntity("notifications", newNotif).catch((err) => console.error(err));
}

function generateMissedNotifications() {
  // Remove old undismissed missed-duty notifications
  appData.notifications = appData.notifications.filter(
    (n) =>
      !(
        (n.type === "missed_duty" ||
          n.type === "cumulative_miss" ||
          n.type === "cumulative_all") &&
        !n.is_dismissed
      )
  );

  const missedRecords = appData.attendance.filter((a) => {
    if (a.attended || a.forgiven || a.punishment_issued) return false;
    const instance = appData.duty_instances.find(
      (di) => di.id === a.duty_instance_id
    );
    return instance !== undefined;
  });

  if (missedRecords.length === 0) return;

  const grouped = {};
  missedRecords.forEach((att) => {
    const libId = att.librarian_id;
    if (!grouped[libId]) grouped[libId] = [];
    grouped[libId].push(att);
  });

  Object.entries(grouped).forEach(([libId, records]) => {
    const lib = getLib(libId);
    if (!lib) return;

    const alreadyDismissed = appData.notifications.some(
      (n) =>
        n.type === "cumulative_all" &&
        n.librarian_id === libId &&
        n.is_dismissed
    );

    if (alreadyDismissed) return;

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
      id: genId(),
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
    appData.notifications.push(newNotif);
    saveEntity("notifications", newNotif).catch((err) => console.error(err));
  });

  saveData();
}

function renderNotifications() {
  generateMissedNotifications();

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
      const ids = appData.notifications
        .filter((n) => n.is_dismissed)
        .map((n) => n.id);
      for (const id of ids) await deleteEntity("notifications", id);
      appData.notifications = appData.notifications.filter(
        (n) => !n.is_dismissed
      );
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

      contentHtml += `
        <div style="max-height:350px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
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
                <button class="btn btn-success btn-sm" onclick="forgiveAttendanceRecord('${
                  rec.id
                }','${notifId}'); showNotificationActionPopup('${notifId}');">✅ Mark Attended</button>
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
        <div style="max-height:250px; overflow-y:auto; margin-bottom:12px;">
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
            <td><button class="btn btn-success btn-sm" onclick="forgiveAttendanceRecord('${
              rec.id
            }','${notifId}'); showNotificationActionPopup('${notifId}');">✅ Mark Attended</button></td>
          </tr>
        `;
      });
      contentHtml += `</tbody></table></div>`;
    }
  }

  contentHtml += `
    <div class="action-column">
      <button class="btn btn-danger" style="width:100%;" onclick="issuePunishmentFromNotification('${notifId}'); closeModal('notificationActionModal');">⚠️ Issue Punishment</button>
    </div>
  `;

  document.getElementById("notificationActionContent").innerHTML = contentHtml;
  openModal("notificationActionModal");
}

async function forgiveAttendanceRecord(recordId, notifId) {
  const rec = appData.attendance.find((a) => a.id === recordId);
  if (!rec) return;
  rec.attended = true;
  rec.forgiven = false;
  rec.confirmed_at = new Date().toISOString();
  rec.confirmed_by = appData.current_user;
  await saveEntity("attendance", rec, rec.id);
  renderCurrentPage();
  renderNotifications();
  toast("Marked as Attended.");
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
    appData.sector_assignments = []; // clear all (we will delete all assignments on server too)
    await deleteEntity("sectors/assignments/all", null); // custom route
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
    id: genId(),
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

  saveData();
  closeModal("autoAssignModal");
  renderSectors();
  toast("Auto‑assign completed.");
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
      // Delete all current assignments on server
      await deleteEntity("sectors/assignments/all", null);
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
      await deleteEntity("librarians", id);
      appData.librarians = appData.librarians.filter((l) => l.id !== id);
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
      for (const l of archived) {
        await deleteEntity("librarians", l.id);
      }
      appData.librarians = appData.librarians.filter((l) => !l.is_deleted);
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

  const newCommittee = {
    id: genId(),
    year,
    members,
    created_at: new Date().toISOString(),
  };
  const saved = await saveEntity("halloffame/committees", newCommittee);
  appData.hall_of_fame_committees.push(saved);
  closeModal("committeeModal");
  renderHallOfFame();
  renderCommittee();
  toast("Committee added.");
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
      <td><input type="text" class="cm-photo-edit" value="${
        m.photo_url || ""
      }"></td>
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

function addCommitteeRow() {
  const tbody = document.getElementById("committeeMemberInputs");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="cm-name" placeholder="Full name"></td>
    <td><input type="text" class="cm-adm" placeholder="Adm No."></td>
    <td><input type="text" class="cm-class" placeholder="e.g., 10A"></td>
    <td><input type="text" class="cm-house" placeholder="House"></td>
    <td><input type="text" class="cm-position" placeholder="Position"></td>
    <td><input type="text" class="cm-photo" placeholder="URL (optional)"></td>
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
    <td><input type="text" class="cm-photo-edit" placeholder="URL (optional)"></td>
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
  await loadData();
  setViewDate(getToday());

  const sectorBody = document.querySelector("#sectorModal .modal-body");
  const sectorFooter = document.querySelector("#sectorModal .modal-footer");
  if (sectorBody) sectorModalOriginalBody = sectorBody.innerHTML;
  if (sectorFooter) sectorModalOriginalFooter = sectorFooter.innerHTML;

  document.getElementById("viewDate").max = getToday();
  renderDashboard();
  setInterval(() => {
    if (currentPage === "notifications") renderNotifications();
    generateDutyInstancesForDate(getToday());
    cleanExpiredTags();
  }, 60000);
  setInterval(updateNotificationBadge, 15000);
}

function renderAttendanceModal() {
  const date =
    document.getElementById("attendanceModalDate").value || getToday();
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
        }"><input type="checkbox" class="attendance-tab-check" data-record="${
          r.id
        }" ${checked ? "checked" : ""}> ${lib.name} ${
          r.forgiven ? "(forgiven)" : ""
        }</label>`;
      })
      .join("")}</div>
    <div style="margin-top:8px;font-size:13px;color:var(--text-secondary);">${
      records.filter((r) => r.attended || r.forgiven).length
    }/${records.length} attended</div>`;
}

async function selectAllAttendanceTab(instanceId, sel) {
  const records = appData.attendance.filter(
    (a) => a.duty_instance_id === instanceId
  );
  for (const r of records) {
    r.attended = sel;
    if (sel) r.forgiven = false;
    r.confirmed_at = new Date().toISOString();
    r.confirmed_by = appData.current_user;
    await saveEntity("attendance", r, r.id);
  }
  renderAttendanceModal();
  toast(`All ${sel ? "present" : "absent"}.`);
}

async function saveAttendanceTab(instanceId) {
  let saved = 0;
  const promises = [];
  document.querySelectorAll(".attendance-tab-check").forEach((cb) => {
    const rec = appData.attendance.find((a) => a.id === cb.dataset.record);
    if (rec && rec.attended !== cb.checked) {
      rec.attended = cb.checked;
      if (cb.checked) rec.forgiven = false;
      rec.confirmed_at = new Date().toISOString();
      rec.confirmed_by = appData.current_user;
      promises.push(saveEntity("attendance", rec, rec.id));
      saved++;
    }
  });
  await Promise.all(promises);
  if (saved) {
    generateMissedNotifications();
    saveData();
    renderAttendanceModal();
    renderNotifications();
    toast(`Saved ${saved} records.`);
  } else toast("No changes.");
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

function quickDeleteTag(tagId) {
  const tag = appData.tags.find((t) => t.id === tagId);
  if (!tag) return;
  tag.is_active = false;
  tag.removed_at = new Date().toISOString();
  saveEntity("tags", tag, tag.id);
  appData.tag_history.push({
    id: genId(),
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
  renderCurrentPage();
  toast("Tag removed.");
}

function viewTagHistoryHtml(libId) {
  const history = appData.tag_history.filter((h) => h.librarian_id === libId);
  if (!history.length) return "No previous tags.";
  return history
    .map(
      (h) => `
    <div style="display:flex; justify-content:space-between; padding:6px 10px; background:#f8fafc; border-radius:6px; margin-bottom:4px;">
      <span><strong>${h.tag_name}</strong> (${h.type})</span>
      <span class="text-muted" style="font-size:12px;">${formatDate(
        h.start_date
      )} – ${h.end_date ? formatDate(h.end_date) : "Forever"}</span>
    </div>`
    )
    .join("");
}

function viewTagHistoryForLibrarian(libId) {
  document.getElementById("actionPopupTitle").textContent = "📜 Tag History";
  document.getElementById("actionPopupContent").innerHTML =
    viewTagHistoryHtml(libId);
  openModal("actionPopup");
}

function toggleMultiSelect() {
  const checked = document.getElementById("autoAssignMulti").checked;
  document.getElementById("multiSelectContainer").style.display = checked
    ? "block"
    : "none";
  if (checked) populateMultiSelect();
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
// Auto-login check removed – always show login page
// This mimics the localStorage version's behaviour where a stored current_user would skip login,
// but since we now have a real backend, you may implement session later.
// For now, the login page is always shown on first load.

console.log("📚 Alliance LMS Online Edition loaded.");
