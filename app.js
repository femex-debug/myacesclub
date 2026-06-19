// ── Main App Entry ──
import { initAdmin, onAdminChange } from "./admin.js";
import { initPlayers, setOnPlayersChange, renderSkillAssignment, onPlayerSkillSet } from "./players.js";
import { initLeaderboard, renderLeaderboard } from "./leaderboard.js";
import { initMatches } from "./matches.js";
import { initSchedule } from "./schedule.js";
import { initTournament } from "./tournament.js";
import { initRoundRobin, renderRRPage, addPlayerToRoundRobin, setRRAdminMode } from "./roundrobin.js";
import { initPending, updatePublicDropdowns, onPlayerApproved, refreshPendingUI } from "./pending.js";

// Main tabs
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.classList.add("active");
    if (btn.dataset.tab === "admin-panel") renderSkillAssignment();
    if (btn.dataset.tab === "roundrobin") renderRRPage();
  });
});

// Skill-level filter tabs on leaderboard
document.querySelectorAll(".skill-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".skill-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    // renderLeaderboard reads the active skill-tab to filter
    renderLeaderboard();
  });
});

// Init all modules
initAdmin();
initPlayers();
initLeaderboard();
initMatches();
initSchedule();
initTournament();
initRoundRobin();
initPending();

// Wire admin login/logout to round robin admin mode
onAdminChange((isAdmin) => {
  setRRAdminMode(isAdmin);
  refreshPendingUI();
});

// Wire player additions to round robin auto-enrollment
onPlayerSkillSet((name, division) => addPlayerToRoundRobin(name, division));
onPlayerApproved((name, division) => addPlayerToRoundRobin(name, division));

// Re-render when roster changes
setOnPlayersChange(() => {
  renderLeaderboard();
  renderSkillAssignment();
  updatePublicDropdowns();
  renderRRPage();
});
