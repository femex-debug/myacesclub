// ── Schedule Module ──
import { db, collection, addDoc, deleteDoc, doc, setDoc, onSnapshot } from "./firebase.js";
import { getIsAdmin } from "./admin.js";
import { renderRRSchedule } from "./roundrobin.js";

let scheduled = [];
let schedDivFilter = "experienced";

export function initSchedule() {
  const ref = collection(db, "scheduled");
  onSnapshot(ref, snap => {
    scheduled = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    scheduled.sort((a, b) => {
      const da = a.dateTime || "9999";
      const db2 = b.dateTime || "9999";
      return da.localeCompare(db2);
    });
    renderScheduleList();
    renderPendingInScoreTab();
  }, err => {
    console.error("Schedule listener error:", err);
  });

  // Division toggle tabs
  document.querySelectorAll(".sched-div-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sched-div-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      schedDivFilter = btn.dataset.sdiv;
      renderScheduleList();
    });
  });
  // Default active
  const defaultTab = document.querySelector('.sched-div-tab[data-sdiv="experienced"]');
  if (defaultTab) defaultTab.classList.add("active");

  document.getElementById("schedule-form").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("sched-msg");
    const type = document.getElementById("sched-type").value;
    const division = document.getElementById("sched-div").value;
    const date = document.getElementById("sched-date").value;
    const time = document.getElementById("sched-time").value;
    const court = document.getElementById("sched-court").value.trim();

    let data = { matchType: type, division, dateTime: `${date}T${time}`, court, status: "upcoming" };

    if (type === "singles") {
      data.player1 = document.getElementById("sched-p1").value.trim();
      data.player2 = document.getElementById("sched-p2").value.trim();
      if (!data.player1 || !data.player2) { msg.textContent = "Enter both players."; msg.className = "msg-err"; return; }
    } else {
      data.team1a = document.getElementById("sched-d1a").value.trim();
      data.team1b = document.getElementById("sched-d1b").value.trim();
      data.team2a = document.getElementById("sched-d2a").value.trim();
      data.team2b = document.getElementById("sched-d2b").value.trim();
      if (!data.team1a || !data.team1b || !data.team2a || !data.team2b) {
        msg.textContent = "Enter all four players."; msg.className = "msg-err"; return;
      }
    }

    await addDoc(collection(db, "scheduled"), data);
    msg.textContent = "Match scheduled!"; msg.className = "msg-ok";
    e.target.reset();
  });
}

function renderScheduleList() {
  const list = document.getElementById("schedule-list");
  const upcoming = scheduled.filter(s =>
    s.status === "upcoming" && (s.division || "").toLowerCase() === schedDivFilter
  );

  if (!upcoming.length) {
    list.innerHTML = `<li style="color:var(--muted);text-align:center">No upcoming ${schedDivFilter} matches</li>`;
  } else {
    list.innerHTML = upcoming.map(renderMatchItem).join("");
  }

  // RR matchups filtered by active toggle
  const rrEl = document.getElementById("rr-schedule-section");
  if (rrEl) rrEl.innerHTML = renderRRSchedule(schedDivFilter);
}

function renderMatchItem(s) {
  const dt = new Date(s.dateTime);
  const dateStr = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timeStr = dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const players = s.matchType === "doubles"
    ? `${s.team1a} & ${s.team1b} vs ${s.team2a} & ${s.team2b}`
    : `${s.player1} vs ${s.player2}`;
  const tag = s.matchType === "doubles" ? " Doubles" : "";
  const court = s.court ? ` • ${s.court}` : "";
  const tournamentBadge = s.source === "tournament"
    ? `<span style="background:#0F2D18;color:#C9A84C;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:6px">${s.tournamentName || "Tournament"} • ${s.round || "Round 1"}</span>`
    : "";
  const cancelBtn = getIsAdmin() ? `<button class="btn-sm" onclick="window._cancelMatch('${s.id}')">Cancel</button>` : "";
  const submitScoreBtn = !getIsAdmin() && s.source !== "tournament"
    ? `<button class="btn-secondary btn-xs" onclick="window._submitScheduledScore('${s.id}','${(s.player1||"").replace(/'/g,"\\'")}','${(s.player2||"").replace(/'/g,"\\'")}')">Submit Score</button>`
    : "";
  return `<li>
    <div><b>${players}</b>${tag}${tournamentBadge}</div>
    <div class="match-meta">${dateStr} at ${timeStr}${court}</div>
    <div style="display:flex;gap:6px">${cancelBtn}${submitScoreBtn}</div>
  </li>`;
}

window._cancelMatch = async (id) => {
  if (confirm("Cancel this scheduled match?")) await deleteDoc(doc(db, "scheduled", id));
};

// Player submits score for a scheduled match — goes to pending for admin approval
window._submitScheduledScore = async (schedId, p1, p2) => {
  const score = prompt(`Enter score for ${p1} vs ${p2}\nFormat: 6-3, 6-4`);
  if (!score || !score.trim()) return;
  try {
    await addDoc(collection(db, "pending_matches"), {
      player1: p1,
      player2: p2,
      score: score.trim(),
      scheduledMatchId: schedId,
      submittedAt: new Date().toISOString(),
      status: "pending"
    });
    alert("Score submitted! Awaiting admin approval.");
  } catch (err) {
    alert("Error submitting score: " + err.message);
  }
};

function renderPendingInScoreTab() {
  const el = document.getElementById("pending-matches");
  const upcoming = scheduled.filter(s => s.status === "upcoming");
  if (!upcoming.length) { el.innerHTML = "<p>No scheduled matches awaiting scores.</p>"; return; }

  // Exclude tournament matches from the score entry tab — those are entered via the bracket
  const nonTournament = upcoming.filter(s => s.source !== "tournament");
  if (!nonTournament.length) { el.innerHTML = "<p>No scheduled matches awaiting scores.</p>"; return; }

  el.innerHTML = "<h3>Scheduled Matches — Enter Score</h3>" + nonTournament.map(s => {
    const players = s.matchType === "doubles"
      ? `${s.team1a} & ${s.team1b} vs ${s.team2a} & ${s.team2b}`
      : `${s.player1} vs ${s.player2}`;
    const dt = s.dateTime ? new Date(s.dateTime).toLocaleDateString() : "";
    return `<div class="pending-card">
      <div><b>${players}</b><br><small>${dt}</small></div>
      <button class="btn-sm" onclick="window._enterScoreFor('${s.id}')">Enter Score</button>
    </div>`;
  }).join("");
}

// Pre-fill the match form from a scheduled match
window._enterScoreFor = (id) => {
  const s = scheduled.find(x => x.id === id);
  if (!s) return;
  document.getElementById("match-type").value = s.matchType;
  if (s.matchType === "singles") {
    document.getElementById("match-singles-fields").classList.remove("hidden");
    document.getElementById("match-doubles-fields").classList.add("hidden");
    document.getElementById("p1").value = s.player1;
    document.getElementById("p2").value = s.player2;
  } else {
    document.getElementById("match-singles-fields").classList.add("hidden");
    document.getElementById("match-doubles-fields").classList.remove("hidden");
    document.getElementById("md1a").value = s.team1a;
    document.getElementById("md1b").value = s.team1b;
    document.getElementById("md2a").value = s.team2a;
    document.getElementById("md2b").value = s.team2b;
  }
  // Mark scheduled match as completed after score is submitted
  window._pendingScheduleId = id;
  // Switch to enter-score tab
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('[data-tab="enter-score"]').classList.add("active");
  document.getElementById("enter-score").classList.add("active");
};

// After match form submit, mark scheduled match as done
document.getElementById("match-form").addEventListener("submit", () => {
  if (window._pendingScheduleId) {
    setDoc(doc(db, "scheduled", window._pendingScheduleId), { status: "completed" }, { merge: true });
    window._pendingScheduleId = null;
  }
});
