// ── Admin Module ──
let onAdminChangeCallback = null;
export function onAdminChange(cb) { onAdminChangeCallback = cb; }
import { db, doc, getDoc, setDoc } from "./firebase.js";

let isAdmin = false;

export function getIsAdmin() { return isAdmin; }

function showAdminUI(show) {
  isAdmin = show;
  document.getElementById("admin-bar").classList.toggle("hidden", !show);
  // Show admin-only tabs and elements
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", !show));
  document.getElementById("admin-toggle").textContent = show ? "Unlock" : "Admin";
}

export function initAdmin() {
  document.getElementById("admin-toggle").addEventListener("click", () => {
    if (isAdmin) { showAdminUI(false); return; }
    document.getElementById("pin-modal").classList.remove("hidden");
  });

  document.getElementById("pin-cancel").addEventListener("click", () => {
    document.getElementById("pin-modal").classList.add("hidden");
    document.getElementById("pin-input").value = "";
  });

  document.getElementById("pin-submit").addEventListener("click", async () => {
    const pin = document.getElementById("pin-input").value;
    const msg = document.getElementById("pin-msg");
    const snap = await getDoc(doc(db, "config", "admin"));
    if (!snap.exists()) { msg.textContent = "No PIN set yet. Use the form below."; msg.className = "msg-err"; return; }
    if (snap.data().pin === pin) {
      showAdminUI(true);
      if (onAdminChangeCallback) onAdminChangeCallback(true);
      document.getElementById("pin-modal").classList.add("hidden");
      document.getElementById("pin-input").value = "";
      msg.textContent = "";
    } else { msg.textContent = "Wrong PIN."; msg.className = "msg-err"; }
  });

  document.getElementById("pin-set-btn").addEventListener("click", async () => {
    const pin = document.getElementById("pin-set").value;
    if (!pin || pin.length < 4) { document.getElementById("pin-msg").textContent = "PIN must be at least 4 characters."; return; }
    const snap = await getDoc(doc(db, "config", "admin"));
    if (snap.exists()) { document.getElementById("pin-msg").textContent = "PIN already set. Login first to change it."; return; }
    await setDoc(doc(db, "config", "admin"), { pin });
    showAdminUI(true);
    if (onAdminChangeCallback) onAdminChangeCallback(true);
    document.getElementById("pin-modal").classList.add("hidden");
  });

  document.getElementById("admin-logout").addEventListener("click", () => { showAdminUI(false); if (onAdminChangeCallback) onAdminChangeCallback(false); });

  // Season management
  initSeasonManagement();
}

async function initSeasonManagement() {
  // Load and display current season
  try {
    const snap = await getDoc(doc(db, "config", "season"));
    const seasonNum = snap.exists() ? (snap.data().number || 1) : 1;
    const label = document.getElementById("current-season-label");
    if (label) label.textContent = `Season ${seasonNum}`;
  } catch(e) {}

  const btn = document.getElementById("new-season-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const msg = document.getElementById("season-msg");
    if (!confirm("Start a new season? The leaderboard will reset and show only new scores going forward. All previous data is safely preserved.")) return;

    try {
      // Get current season number
      const snap = await getDoc(doc(db, "config", "season"));
      const currentNum = snap.exists() ? (snap.data().number || 1) : 1;
      const newNum = currentNum + 1;
      const newSeasonId = `season_${newNum}`;

      await setDoc(doc(db, "config", "season"), {
        current: newSeasonId,
        number: newNum,
        startedAt: new Date().toISOString()
      });

      const label = document.getElementById("current-season-label");
      if (label) label.textContent = `Season ${newNum}`;

      msg.textContent = `Season ${newNum} started. Leaderboard is now fresh.`;
      msg.className = "msg-ok";
    } catch(err) {
      msg.textContent = "Error: " + err.message;
      msg.className = "msg-err";
    }
  });
}
