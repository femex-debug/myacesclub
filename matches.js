// ── Matches Module (score entry, recent, h2h) ──
import { db, collection, addDoc, getDocs, getDoc, onSnapshot, query, orderBy, doc, setDoc } from "./firebase.js";
import { renderLeaderboard, setMatches, computeMVP } from "./leaderboard.js";
import { updateDatalist } from "./players.js";

let allMatches = [];
let currentSeason = "default";

export function getCurrentSeason() { return currentSeason; }

function determineWinner(sets) {
  let s1 = 0, s2 = 0;
  sets.forEach(s => { if (s.p1 > s.p2) s1++; else if (s.p2 > s.p1) s2++; });
  return s1 >= s2 ? 1 : 2;
}

function formatSets(sets) {
  return sets.map(s => {
    const a = s.p1 !== undefined ? s.p1 : s[0];
    const b = s.p2 !== undefined ? s.p2 : s[1];
    const tb = s.tb !== undefined ? s.tb : s[2];
    let str = `${a}-${b}`;
    if (tb !== undefined && tb !== null && tb !== "") str += `(${tb})`;
    return str;
  }).join(", ");
}

export function initMatches() {
  const matchesRef = collection(db, "matches");
  const q = query(matchesRef, orderBy("timestamp", "asc"));

  // Load current season from config, then start listener
  getDoc(doc(db, "config", "season")).then(snap => {
    currentSeason = snap.exists() ? (snap.data().current || "default") : "default";
  }).catch(() => { currentSeason = "default"; });

  // Update season label on page
  function updateSeasonLabel(s) {
    const el = document.getElementById("lb-season-label");
    if (!el) return;
    const num = s === "default" ? 1 : parseInt(s.replace("season_","")) || 1;
    el.textContent = `Season ${num}`;
  }

  onSnapshot(q, snap => {
    allMatches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Filter to current season only for leaderboard
    const seasonMatches = allMatches.filter(m => (m.season || "default") === currentSeason);
    setMatches(seasonMatches);
    renderLeaderboard();
    renderRecent();
    renderPending();
    computeMVP();
  });

  // Also re-filter when season changes (after a reset)
  onSnapshot(doc(db, "config", "season"), snap => {
    currentSeason = snap.exists() ? (snap.data().current || "default") : "default";
    updateSeasonLabel(currentSeason);
    const seasonMatches = allMatches.filter(m => (m.season || "default") === currentSeason);
    setMatches(seasonMatches);
    renderLeaderboard();
    renderRecent();
    computeMVP();
  });

  initMatchForm();
  initH2H();
}

// ── Set rows ──
function initMatchForm() {
  const container = document.getElementById("sets-container");
  let setCount = 1;

  document.getElementById("add-set-btn").addEventListener("click", () => {
    if (setCount >= 5) return;
    setCount++;
    const row = document.createElement("div");
    row.className = "set-row";
    row.innerHTML = `<span>Set ${setCount}</span>
      <input type="number" min="0" max="7" class="set-p1" required placeholder="P1/T1">
      <span>–</span>
      <input type="number" min="0" max="7" class="set-p2" required placeholder="P2/T2">
      <input type="number" min="0" max="99" class="set-tb" placeholder="TB">`;
    container.appendChild(row);
  });

  document.getElementById("remove-set-btn").addEventListener("click", () => {
    if (setCount <= 1) return;
    container.removeChild(container.lastElementChild);
    setCount--;
  });

  document.getElementById("match-form").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("form-msg");
    const type = document.getElementById("match-type").value;
    const resultType = document.getElementById("result-type").value;

    // Gather players
    let matchData;
    if (type === "singles") {
      const p1 = document.getElementById("p1").value.trim();
      const p2 = document.getElementById("p2").value.trim();
      if (!p1 || !p2 || p1.toLowerCase() === p2.toLowerCase()) {
        msg.textContent = "Enter two different players."; msg.className = "msg-err"; return;
      }
      matchData = { matchType: "singles", player1: p1, player2: p2 };
    } else {
      const d1a = document.getElementById("md1a").value.trim();
      const d1b = document.getElementById("md1b").value.trim();
      const d2a = document.getElementById("md2a").value.trim();
      const d2b = document.getElementById("md2b").value.trim();
      if (!d1a || !d1b || !d2a || !d2b) {
        msg.textContent = "Enter all four players."; msg.className = "msg-err"; return;
      }
      const names = [d1a, d1b, d2a, d2b].map(n => n.toLowerCase());
      if (new Set(names).size !== 4) {
        msg.textContent = "All four players must be different."; msg.className = "msg-err"; return;
      }
      matchData = { matchType: "doubles", team1a: d1a, team1b: d1b, team2a: d2a, team2b: d2b };
    }

    // Gather sets
    const sp1 = document.querySelectorAll(".set-p1");
    const sp2 = document.querySelectorAll(".set-p2");
    const stb = document.querySelectorAll(".set-tb");
    const sets = [];
    for (let i = 0; i < sp1.length; i++) {
      const a = parseInt(sp1[i].value), b = parseInt(sp2[i].value);
      if (isNaN(a) || isNaN(b)) { msg.textContent = "Fill in all set scores."; msg.className = "msg-err"; return; }
      if (a === b) { msg.textContent = `Set ${i + 1}: scores can't be equal.`; msg.className = "msg-err"; return; }
      const tb = stb[i] ? parseInt(stb[i].value) : null;
      sets.push({ p1: a, p2: b, tb: isNaN(tb) ? null : tb });
    }

    matchData.sets = sets;
    matchData.winner = determineWinner(sets);
    matchData.resultType = resultType;
    matchData.date = new Date().toISOString();
    matchData.timestamp = Date.now();
    matchData.season = currentSeason;

    try {
      await addDoc(collection(db, "matches"), matchData);
      const winnerName = getWinnerName(matchData);
      msg.textContent = `${winnerName} wins!`; msg.className = "msg-ok";
      e.target.reset();
      while (setCount > 1) { container.removeChild(container.lastElementChild); setCount--; }
    } catch (err) {
      msg.textContent = "Error saving. Check Firebase config."; msg.className = "msg-err";
      console.error(err);
    }
  });
}

function getWinnerName(m) {
  if (m.matchType === "doubles") {
    return m.winner === 1 ? `${m.team1a} & ${m.team1b}` : `${m.team2a} & ${m.team2b}`;
  }
  return m.winner === 1 ? m.player1 : m.player2;
}

function getLoserName(m) {
  if (m.matchType === "doubles") {
    return m.winner === 1 ? `${m.team2a} & ${m.team2b}` : `${m.team1a} & ${m.team1b}`;
  }
  return m.winner === 1 ? m.player2 : m.player1;
}

// ── Recent ──
function renderRecent() {
  const list = document.getElementById("recent-list");
  const last15 = allMatches.slice(-15).reverse();
  list.innerHTML = last15.map(m => {
    const date = m.date ? new Date(m.date).toLocaleDateString() : "";
    const tag = m.matchType === "doubles" ? " Doubles" : "";
    const rt = m.resultType && m.resultType !== "completed" ? ` (${m.resultType.toUpperCase()})` : "";
    const shareText = encodeURIComponent(`ACES Club: ${getWinnerName(m)} def. ${getLoserName(m)} ${formatSets(m.sets)}`);
    return `<li>
      <div><span class="match-players"><span class="winner-badge">W ${getWinnerName(m)}</span> def. ${getLoserName(m)}${rt}</span></div>
      <span class="match-score">${formatSets(m.sets)}</span>
      <div class="match-meta">${date}${tag} <a href="https://wa.me/?text=${shareText}" target="_blank" class="wa-share" title="Share on WhatsApp">Share</a></div>
    </li>`;
  }).join("");
}

// ── Pending scheduled matches ──
function renderPending() {
  // Handled by schedule module — this renders in enter-score tab
  // We import scheduled matches and show ones without results
}

// ── H2H ──
function initH2H() {
  document.getElementById("h2h-btn").addEventListener("click", () => {
    const a = document.getElementById("h2h-a").value.trim();
    const b = document.getElementById("h2h-b").value.trim();
    const result = document.getElementById("h2h-result");
    if (!a || !b) { result.innerHTML = "<p>Enter both player names.</p>"; return; }

    let aWins = 0, bWins = 0, history = [];
    allMatches.forEach(m => {
      const allPlayers = m.matchType === "doubles"
        ? [m.team1a, m.team1b, m.team2a, m.team2b]
        : [m.player1, m.player2];
      const hasA = allPlayers.some(p => p && p.toLowerCase() === a.toLowerCase());
      const hasB = allPlayers.some(p => p && p.toLowerCase() === b.toLowerCase());
      if (!hasA || !hasB) return;

      // Check they're on opposite sides
      let aTeam, bTeam;
      if (m.matchType === "doubles") {
        const t1 = [m.team1a?.toLowerCase(), m.team1b?.toLowerCase()];
        const t2 = [m.team2a?.toLowerCase(), m.team2b?.toLowerCase()];
        if (t1.includes(a.toLowerCase())) aTeam = 1; else aTeam = 2;
        if (t1.includes(b.toLowerCase())) bTeam = 1; else bTeam = 2;
      } else {
        aTeam = m.player1.toLowerCase() === a.toLowerCase() ? 1 : 2;
        bTeam = m.player1.toLowerCase() === b.toLowerCase() ? 1 : 2;
      }
      if (aTeam === bTeam) return; // same team in doubles

      if (m.winner === aTeam) aWins++; else bWins++;
      history.push({ winner: m.winner === aTeam ? a : b, sets: m.sets, date: m.date });
    });

    if (aWins + bWins === 0) {
      result.innerHTML = `<p>No matches between <b>${a}</b> and <b>${b}</b>.</p>`; return;
    }

    let html = `<div class="h2h-card"><div class="big">${a} ${aWins} – ${bWins} ${b}</div>
      <p>${aWins + bWins} match${aWins + bWins > 1 ? "es" : ""}</p><hr style="margin:.75rem 0">`;
    history.reverse().forEach(h => {
      const d = h.date ? new Date(h.date).toLocaleDateString() : "";
      html += `<p><b>${h.winner}</b> won ${formatSets(h.sets)} <small>${d}</small></p>`;
    });
    result.innerHTML = html + "</div>";
  });
}

// Navigate to H2H tab with player pre-filled
window._goH2H = (name) => {
  document.getElementById("h2h-a").value = name;
  document.getElementById("h2h-b").value = "";
  document.getElementById("h2h-result").innerHTML = "<p>Select a second player to compare.</p>";
  // Switch to H2H tab
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('[data-tab="h2h"]').classList.add("active");
  document.getElementById("h2h").classList.add("active");
  document.getElementById("h2h-b").focus();
};

export { allMatches, formatSets, determineWinner };
