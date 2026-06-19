// ── Pending Submissions Module ──
// Handles: player score submissions, new player registrations (public)
// Admin approval queue for both

import { getCurrentSeason } from "./matches.js";
import { db, collection, doc, addDoc, deleteDoc, setDoc, onSnapshot, getDocs, query, orderBy } from "./firebase.js";
import { getIsAdmin } from "./admin.js";
import { getPlayers } from "./players.js";

let pendingMatches = [];
let pendingPlayers = [];
let onPlayerApprovedCallback = null;
export function onPlayerApproved(cb) { onPlayerApprovedCallback = cb; }

export function initPending() {
  // Listen to pending collections
  onSnapshot(collection(db, "pending_matches"), snap => {
    pendingMatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendingQueue();
    updatePendingBadge();
  });

  onSnapshot(collection(db, "pending_players"), snap => {
    pendingPlayers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendingQueue();
    updatePendingBadge();
  });

  initPublicMatchForm();
  initPublicPlayerForm();
}

// Re-render when admin state changes
export function refreshPendingUI() {
  renderPendingQueue();
  updatePendingBadge();
}

function updatePendingBadge() {
  const el = document.getElementById("pending-count");
  if (el) el.textContent = pendingMatches.length + pendingPlayers.length;
}

// ── PUBLIC SCORE SUBMISSION FORM ──
function initPublicMatchForm() {
  const form = document.getElementById("public-match-form");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("public-match-msg");
    const players = getPlayers();

    const p1 = document.getElementById("pub-p1").value;
    const p2 = document.getElementById("pub-p2").value;
    const score = document.getElementById("pub-score").value.trim();

    if (!p1 || !p2 || p1 === p2) {
      msg.textContent = "Select two different players.";
      msg.className = "msg-err"; return;
    }
    if (!score) {
      msg.textContent = "Enter the score.";
      msg.className = "msg-err"; return;
    }

    try {
      await addDoc(collection(db, "pending_matches"), {
        player1: p1,
        player2: p2,
        score,
        submittedAt: new Date().toISOString(),
        status: "pending"
      });
      msg.textContent = "Score submitted! Awaiting admin approval.";
      msg.className = "msg-ok";
      form.reset();
    } catch (err) {
      msg.textContent = "Error submitting. Try again.";
      msg.className = "msg-err";
    }
  });
}

// ── PUBLIC PLAYER REGISTRATION FORM ──
function initPublicPlayerForm() {
  const form = document.getElementById("public-player-form");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("public-player-msg");
    const nickname = document.getElementById("pub-nickname").value.trim();
    const skillLevel = document.getElementById("pub-skill").value;

    if (!nickname) {
      msg.textContent = "Enter your nickname.";
      msg.className = "msg-err"; return;
    }

    const existing = getPlayers();
    if (existing.find(p => p.name.toLowerCase() === nickname.toLowerCase())) {
      msg.textContent = "That name is already taken.";
      msg.className = "msg-err"; return;
    }

    try {
      await addDoc(collection(db, "pending_players"), {
        name: nickname,
        division: skillLevel,
        submittedAt: new Date().toISOString(),
        status: "pending"
      });
      msg.textContent = "Registration submitted! Admin will approve shortly.";
      msg.className = "msg-ok";
      form.reset();
    } catch (err) {
      msg.textContent = "Error submitting. Try again.";
      msg.className = "msg-err";
    }
  });
}

// ── ADMIN APPROVAL QUEUE ──
function renderPendingQueue() {
  const el = document.getElementById("pending-queue");
  if (!el) return;
  if (!getIsAdmin()) { el.innerHTML = ""; return; }

  let html = "";

  // Pending match scores
  if (pendingMatches.length) {
    html += `<div style="font-weight:700;font-size:13px;color:#0F2D18;margin-bottom:10px">
      Pending Match Scores (${pendingMatches.length})
    </div>`;
    pendingMatches.forEach(m => {
      const d = m.submittedAt ? new Date(m.submittedAt).toLocaleDateString() : "";
      html += `<div class="pending-card" style="margin-bottom:10px">
        <div>
          <b>${m.player1} vs ${m.player2}</b>
          <div style="font-size:12px;color:#666">Score: ${m.score} &bull; Submitted ${d}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-secondary btn-sm" onclick="window._approveMatch('${m.id}')">Approve</button>
          <button class="btn-danger btn-sm" onclick="window._rejectMatch('${m.id}')">x Reject</button>
        </div>
      </div>`;
    });
  }

  // Pending player registrations
  if (pendingPlayers.length) {
    html += `<div style="font-weight:700;font-size:13px;color:#0F2D18;margin:16px 0 10px">
      Pending Player Registrations (${pendingPlayers.length})
    </div>`;
    pendingPlayers.forEach(p => {
      const d = p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : "";
      html += `<div class="pending-card" style="margin-bottom:10px">
        <div>
          <b>${p.name}</b>
          <div style="font-size:12px;color:#666">${p.division.toUpperCase()} &bull; Submitted ${d}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-sm" style="color:#27500a;border-color:#27500a" onclick="window._approvePlayer('${p.id}')">Approve</button>
          <button class="btn-sm" style="color:#C0392B;border-color:#C0392B" onclick="window._rejectPlayer('${p.id}')">x Reject</button>
        </div>
      </div>`;
    });
  }

  if (!pendingMatches.length && !pendingPlayers.length) {
    html = `<p style="color:#888;font-size:13px">No pending submissions.</p>`;
  }

  el.innerHTML = html;
}

export function updatePublicDropdowns() {
  const selects = ["pub-p1", "pub-p2"];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const players = getPlayers();
    sel.innerHTML = `<option value="">Select player...</option>` +
      players.map(p => `<option value="${p.name}">${p.name} (${(p.division||"").toUpperCase()})</option>`).join("");
  });
}

// ── APPROVE / REJECT MATCH ──
window._approveMatch = async (id) => {
  const m = pendingMatches.find(x => x.id === id);
  if (!m) return;

  // Parse score — expects format like "6-3, 6-4" or "6-3"
  const sets = [];
  const parts = m.score.split(",").map(s => s.trim());
  parts.forEach(part => {
    const nums = part.split("-").map(n => parseInt(n.trim()));
    if (nums.length === 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
      sets.push({ p1: nums[0], p2: nums[1], tb: null });
    }
  });

  if (!sets.length) {
    alert("Could not parse score format. Expected: 6-3, 6-4"); return;
  }

  // Determine winner by sets
  let p1Sets = 0, p2Sets = 0;
  sets.forEach(s => { if (s.p1 > s.p2) p1Sets++; else p2Sets++; });
  const winner = p1Sets >= p2Sets ? 1 : 2;

  try {
    const matchData = {
      matchType: "singles",
      player1: m.player1,
      player2: m.player2,
      winner,
      sets,
      resultType: "completed",
      source: m.source || "player_submission",
      date: new Date().toISOString(),
      timestamp: Date.now(),
      season: getCurrentSeason()
    };
    // Include RR metadata if it's a round robin score
    if (m.source === "roundrobin" && m.rrId) {
      matchData.rrId = m.rrId;
      matchData.rrGroup = m.rrGroup;
    }
    await addDoc(collection(db, "matches"), matchData);

    // If RR match, update RR standings
    if (m.source === "roundrobin" && m.rrId) {
      window._rrEnterScoreFromApproval && window._rrEnterScoreFromApproval(m.rrId, m.rrGroup, m.player1, m.player2, p1Sets, p2Sets);
    }

    await deleteDoc(doc(db, "pending_matches", id));
  } catch (err) {
    alert("Error approving: " + err.message);
  }
};

window._rejectMatch = async (id) => {
  if (confirm("Reject this score submission?")) {
    await deleteDoc(doc(db, "pending_matches", id));
  }
};

// ── APPROVE / REJECT PLAYER ──
window._approvePlayer = async (id) => {
  const p = pendingPlayers.find(x => x.id === id);
  if (!p) return;
  try {
    await addDoc(collection(db, "players"), {
      name: p.name,
      division: p.division
    });
    await deleteDoc(doc(db, "pending_players", id));
    // Notify app that player was approved
    if (onPlayerApprovedCallback) onPlayerApprovedCallback(p.name, p.division);
  } catch (err) {
    alert("Error approving player: " + err.message);
  }
};

window._rejectPlayer = async (id) => {
  if (confirm("Reject this player registration?")) {
    await deleteDoc(doc(db, "pending_players", id));
  }
};
