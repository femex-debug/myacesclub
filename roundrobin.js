// ── Round Robin Tournament Module ──
import { getCurrentSeason } from "./matches.js";
import { db, collection, doc, addDoc, setDoc, deleteDoc, getDocs, onSnapshot, query, where } from "./firebase.js";
import { getIsAdmin } from "./admin.js";
import { getPlayers } from "./players.js";

const RR_START = "2026-06-15";
let rrTournaments = {}; // { id: data }

// ── Score Modal Helper ──
function showScoreModal(p1, p2, onSubmit) {
  const modal = document.getElementById("score-modal");
  const title = document.getElementById("score-modal-title");
  const sub = document.getElementById("score-modal-sub");
  const inp1 = document.getElementById("score-modal-p1");
  const inp2 = document.getElementById("score-modal-p2");
  const msg = document.getElementById("score-modal-msg");

  title.textContent = `${p1} vs ${p2}`;
  sub.textContent = `Enter sets won by each player`;
  inp1.value = ""; inp2.value = ""; msg.textContent = "";
  inp1.placeholder = p1; inp2.placeholder = p2;
  modal.classList.remove("hidden");
  inp1.focus();

  const submitBtn = document.getElementById("score-modal-submit");
  const cancelBtn = document.getElementById("score-modal-cancel");

  function cleanup() {
    modal.classList.add("hidden");
    submitBtn.replaceWith(submitBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  }

  document.getElementById("score-modal-submit").addEventListener("click", () => {
    const s1 = parseInt(inp1.value), s2 = parseInt(inp2.value);
    if (isNaN(s1) || isNaN(s2) || s1 === s2 || s1 < 0 || s2 < 0) {
      msg.textContent = "Enter valid scores (can't be equal)"; msg.className = "form-msg msg-err"; return;
    }
    cleanup();
    onSubmit(s1, s2);
  });
  document.getElementById("score-modal-cancel").addEventListener("click", cleanup);
}

// Admin state read directly from admin.js — no local copy needed
export function setRRAdminMode(val) { renderRRPage(); } // kept for app.js compatibility

// ── Week Deadline Calculator ──
function getWeekDeadline(startDate, weekIndex) {
  const start = new Date(startDate);
  const deadline = new Date(start.getTime() + (weekIndex + 1) * 7 * 24 * 60 * 60 * 1000);
  return deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initRoundRobin() {
  // Listen to rr_tournaments collection
  onSnapshot(collection(db, "rr_tournaments"), snap => {
    rrTournaments = {};
    snap.docs.forEach(d => { rrTournaments[d.id] = { id: d.id, ...d.data() }; });
    renderRRPage();
  });
}

// ── AUTO-ASSIGN GROUPS ──
// Fisher-Yates shuffle then split into 2 groups per division
function assignGroups(players, division) {
  const filtered = players.filter(p => {
    const d = (p.division || p.skillLevel || "").toLowerCase();
    if (division === "beginner") return d === "beginner";
    return d === "experienced";
  });
  // Shuffle
  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }
  const half = Math.ceil(filtered.length / 2);
  return {
    A: filtered.slice(0, half).map(p => p.name),
    B: filtered.slice(half).map(p => p.name)
  };
}

// ── DOUBLE ROUND ROBIN using circle method ──
// Returns flat array of all matchup pairs — everyone plays everyone twice
function generateDoubleRRMatchups(players) {
  const list = [...players];
  if (list.length % 2 !== 0) list.push("BYE");
  const n = list.length;
  const allRounds = [];
  const fixed = list[0];
  const rotating = list.slice(1);

  // First pass — everyone plays everyone once
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    const circle = [fixed, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const p1 = circle[i];
      const p2 = circle[n - 1 - i];
      if (p1 !== "BYE" && p2 !== "BYE") round.push({p1, p2});
    }
    allRounds.push(round);
    rotating.push(rotating.shift());
  }

  // Second pass — reverse all matchups so everyone plays everyone a second time
  const firstPass = JSON.parse(JSON.stringify(allRounds));
  firstPass.forEach(round => {
    allRounds.push(round.map(m => ({p1: m.p2, p2: m.p1})));
  });

  return allRounds; // double round robin
}

// Pack rounds into weeks — 2 rounds per week (2 assigned matches per player per week)
function buildWeeklyAssignments(rounds) {
  const weeks = [];
  let idx = 0;
  while (idx < rounds.length) {
    const weekMatches = [];
    for (let r = 0; r < 2 && idx < rounds.length; r++, idx++) {
      weekMatches.push(...rounds[idx]);
    }
    weeks.push(weekMatches);
  }
  return weeks;
}

// ── CREATE ROUND ROBIN ──
async function createRoundRobin(division) {
  const players = getPlayers();
  const groups  = assignGroups(players, division);

  if (groups.A.length < 2 && groups.B.length < 2) {
    alert(`Not enough ${division} players assigned. Go to Admin tab and assign skill levels first.`);
    return;
  }

  const weeklyA = buildWeeklyAssignments(generateDoubleRRMatchups(groups.A));
  const weeklyB = buildWeeklyAssignments(generateDoubleRRMatchups(groups.B));

  // ── FLATTEN everything — Firestore cannot store arrays inside arrays ──
  // schedule: flat map  "A_w0_m0" -> {p1,p2}
  // players:  flat map  "A_0" -> "Name",  "A_count" -> N
  // standings: flat map "A_stand_Name" -> {played,setWins,...}

  const schedule  = {};
  const playerMap = {};
  const standings = {};

  ["A","B"].forEach(grp => {
    const grpPlayers = grp === "A" ? groups.A : groups.B;
    const weekly     = grp === "A" ? weeklyA  : weeklyB;

    // Players as indexed keys
    playerMap[`${grp}_count`] = grpPlayers.length;
    grpPlayers.forEach((name, i) => {
      playerMap[`${grp}_${i}`] = name;
    });

    // Schedule as flat keys
    weekly.forEach((week, wi) => {
      week.forEach((match, mi) => {
        schedule[`${grp}_w${wi}_m${mi}`] = { p1: match.p1, p2: match.p2 };
      });
      schedule[`${grp}_w${wi}_count`] = week.length;
    });
    schedule[`${grp}_weekCount`] = weekly.length;

    // Standings as flat keys
    grpPlayers.forEach(name => {
      const key = `${grp}_${name.replace(/[.#$\[\]/]/g,"_")}`;
      standings[key] = { name, group: grp, played: 0, setWins: 0, setLosses: 0, matchWins: 0 };
    });
  });

  const payload = {
    division,
    startDate: RR_START,
    status:    "active",
    playerMap,
    schedule,
    standings,
    matchLog:   {},
    semifinals: {},
    final:      {},
    champion:   "",
    createdAt:  new Date().toISOString()
  };

  try {
    await addDoc(collection(db, "rr_tournaments"), payload);
  } catch (err) {
    alert("Error creating tournament: " + err.message);
    console.error("Payload that failed:", JSON.stringify(payload, null, 2));
  }
}

// ── AUTO-ADD NEW PLAYER TO ACTIVE ROUND ROBIN ──
export async function addPlayerToRoundRobin(playerName, division) {
  const active = Object.values(rrTournaments).find(t =>
    t.status === "active" && t.division === division
  );
  if (!active) return;
  const t = active;

  // Check not already in tournament
  const grpA = getGroupPlayers(t, "A");
  const grpB = getGroupPlayers(t, "B");
  if (grpA.includes(playerName) || grpB.includes(playerName)) return;

  // Add to smaller group
  const grp = grpA.length <= grpB.length ? "A" : "B";
  const existingPlayers = grp === "A" ? grpA : grpB;

  // New player matchups start from week 1 (index 0) so they catch up
  const existingWeekCount = t.schedule?.[`${grp}_weekCount`] || 0;

  const newSchedule = { ...t.schedule };

  // New player plays everyone in the group twice (home + away)
  const matchups = [];
  existingPlayers.forEach(p => {
    matchups.push({ p1: playerName, p2: p });
    matchups.push({ p1: p, p2: playerName });
  });

  // Distribute 2 matchups per week, starting from week 0
  for (let idx = 0; idx < matchups.length; idx++) {
    const wi = Math.floor(idx / 2); // 2 matches per week
    const currentCount = newSchedule[`${grp}_w${wi}_count`] || 0;
    newSchedule[`${grp}_w${wi}_m${currentCount}`] = matchups[idx];
    newSchedule[`${grp}_w${wi}_count`] = currentCount + 1;
  }
  // Extend weekCount if new player needs more weeks than exist
  const neededWeeks = Math.ceil(matchups.length / 2);
  if (neededWeeks > existingWeekCount) {
    newSchedule[`${grp}_weekCount`] = neededWeeks;
  }

  // Update playerMap
  const newPlayerMap = { ...t.playerMap };
  const newCount = existingPlayers.length;
  newPlayerMap[`${grp}_${newCount}`] = playerName;
  newPlayerMap[`${grp}_count`] = newCount + 1;

  // Update standings
  const newStandings = { ...t.standings };
  const key = `${grp}_${playerName.replace(/[.#$\[\]/]/g,"_")}`;
  newStandings[key] = { name: playerName, group: grp, played:0, setWins:0, setLosses:0, matchWins:0 };

  try {
    await setDoc(doc(db, "rr_tournaments", t.id), {
      playerMap:  newPlayerMap,
      schedule:   newSchedule,
      standings:  newStandings
    }, { merge: true });
    console.log(`${playerName} added to ${division} Round Robin Group ${grp}`);
  } catch (err) {
    console.error("Error adding player to round robin:", err);
  }
}


window._rrEnterScore = (rrId, group, p1, p2) => {
  showScoreModal(p1, p2, async (p1Sets, p2Sets) => {
    const t = rrTournaments[rrId];
    if (!t) return;

    const winner = p1Sets > p2Sets ? p1 : p2;

    const st = JSON.parse(JSON.stringify(t.standings || {}));
    const k1 = `${group}_${p1.replace(/[.#$\[\]/]/g,"_")}`;
    const k2 = `${group}_${p2.replace(/[.#$\[\]/]/g,"_")}`;
    if (!st[k1]) st[k1] = { name: p1, group, played:0, setWins:0, setLosses:0, matchWins:0 };
    if (!st[k2]) st[k2] = { name: p2, group, played:0, setWins:0, setLosses:0, matchWins:0 };
    st[k1].played++;  st[k2].played++;
    st[k1].setWins += p1Sets; st[k1].setLosses += p2Sets;
    st[k2].setWins += p2Sets; st[k2].setLosses += p1Sets;
    if (p1Sets > p2Sets) st[k1].matchWins++;
    else st[k2].matchWins++;

  const matchRecord = {
    group, p1, p2, p1Sets, p2Sets, winner,
    date: new Date().toISOString()
  };

  const matchKey = `match_${Date.now()}`;
  const updatedMatches = { ...(t.matchLog || {}), [matchKey]: matchRecord };

  // Check if top 2 from each group can be determined
  const { semis, final, champion } = checkAdvancement(t, st, updatedMatches);

  try {
    await setDoc(doc(db, "rr_tournaments", rrId), {
      standings: st,
      matchLog: updatedMatches,  // use matchLog not matches to avoid Firestore array-of-arrays
      semifinals: semis || t.semifinals,
      final: final || t.final,
      champion: champion || t.champion || "",
      status: champion ? "completed" : t.status
    }, { merge: true });

    // Write to main matches collection for leaderboard
    await addDoc(collection(db, "matches"), {
      matchType: "singles",
      division: t.division,
      player1: p1,
      player2: p2,
      winner: p1Sets > p2Sets ? 1 : 2,
      sets: [{ p1: p1Sets, p2: p2Sets, tb: null }],
      resultType: "completed",
      source: "roundrobin",
      rrId,
      rrGroup: group,
      date: new Date().toISOString(),
      timestamp: Date.now(),
      season: getCurrentSeason()
    });

  } catch (err) {
    alert("Error saving score: " + err.message);
    console.error(err);
  }
  });
};

// Called from pending.js when approving an RR match — updates standings only (match already written)
window._rrEnterScoreFromApproval = async (rrId, group, p1, p2, p1Sets, p2Sets) => {
  const t = rrTournaments[rrId];
  if (!t) return;

  const winner = p1Sets > p2Sets ? p1 : p2;
  const st = JSON.parse(JSON.stringify(t.standings || {}));
  const k1 = `${group}_${p1.replace(/[.#$\[\]/]/g,"_")}`;
  const k2 = `${group}_${p2.replace(/[.#$\[\]/]/g,"_")}`;
  if (!st[k1]) st[k1] = { name: p1, group, played:0, setWins:0, setLosses:0, matchWins:0 };
  if (!st[k2]) st[k2] = { name: p2, group, played:0, setWins:0, setLosses:0, matchWins:0 };
  st[k1].played++; st[k2].played++;
  st[k1].setWins += p1Sets; st[k1].setLosses += p2Sets;
  st[k2].setWins += p2Sets; st[k2].setLosses += p1Sets;
  if (p1Sets > p2Sets) st[k1].matchWins++; else st[k2].matchWins++;

  const matchKey = `match_${Date.now()}`;
  const updatedMatchLog = { ...(t.matchLog || {}), [matchKey]: {
    group, p1, p2, p1Sets, p2Sets, winner, date: new Date().toISOString()
  }};

  const { semis, final, champion } = checkAdvancement(t, st, updatedMatchLog);

  try {
    await setDoc(doc(db, "rr_tournaments", rrId), {
      standings: st,
      matchLog: updatedMatchLog,
      semifinals: semis || t.semifinals,
      final: final || t.final,
      champion: champion || t.champion || "",
      status: champion ? "completed" : t.status
    }, { merge: true });
  } catch (err) {
    console.error("RR standings update error:", err);
  }
};

// Player submits RR score — goes to pending for admin approval
window._rrSubmitScore = (rrId, group, p1, p2) => {
  showScoreModal(p1, p2, async (p1Sets, p2Sets) => {
    try {
      await addDoc(collection(db, "pending_matches"), {
        player1: p1,
        player2: p2,
        score: `${p1Sets}-${p2Sets}`,
        source: "roundrobin",
        rrId,
        rrGroup: group,
        submittedAt: new Date().toISOString(),
        status: "pending"
      });
      alert("Score submitted! Awaiting admin approval.");
    } catch (err) {
      alert("Error submitting: " + err.message);
    }
  });
};


function checkAdvancement(t, standings, matchLog) {
  const grpAStand = {};
  const grpBStand = {};
  Object.entries(standings).forEach(([key, val]) => {
    if (val && val.group === "A" && val.name) grpAStand[val.name] = val;
    if (val && val.group === "B" && val.name) grpBStand[val.name] = val;
  });

  const topA = getTopTwo(grpAStand);
  const topB = getTopTwo(grpBStand);

  // Only advance if we have 2 from each group with at least 1 match played
  const aReady = topA.length >= 2 && Object.values(grpAStand).every(s => s.played > 0);
  const bReady = topB.length >= 2 && Object.values(grpBStand).every(s => s.played > 0);

  let semis = t.semifinals || {};
  let final = t.final || {};
  let champion = t.champion || "";

  if (aReady && bReady && !semis.semi1?.p1) {
    // Set up semifinals: A1 vs B2, B1 vs A2
    semis = {
      semi1: { p1: topA[0], p2: topB[1], winner: null },
      semi2: { p1: topB[0], p2: topA[1], winner: null }
    };
  }

  if (semis.semi1?.winner && semis.semi2?.winner && !final.p1) {
    final = { p1: semis.semi1.winner, p2: semis.semi2.winner, winner: null };
  }

  if (final.winner) champion = final.winner;

  return { semis, final, champion };
}

// ── ENTER SEMIFINAL / FINAL SCORE ──
window._rrEnterKnockoutScore = async (rrId, stage, matchId, p1, p2) => {
  const score = prompt(`${stage}: ${p1} vs ${p2}\nSets won format: e.g. 2-1`);
  if (!score) return;
  const parts = score.split("-").map(s => parseInt(s.trim()));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[0] === parts[1]) {
    alert("Invalid score format."); return;
  }
  const winner = parts[0] > parts[1] ? p1 : p2;

  const t = rrTournaments[rrId];
  if (!t) return;

  const matchKey = `knockout_${matchId}_${Date.now()}`;
  const updatedMatchLog = { ...(t.matchLog || {}), [matchKey]: {
    group: "knockout", p1, p2,
    p1Sets: parts[0], p2Sets: parts[1],
    winner, stage, matchId,
    date: new Date().toISOString()
  }};

  let champion = t.champion || "";
  if (stage === "final") champion = winner;

  // Update semis/final tracking
  const semis = t.semifinals ? JSON.parse(JSON.stringify(t.semifinals)) : {
    semi1: { p1: null, p2: null, winner: null },
    semi2: { p1: null, p2: null, winner: null }
  };
  const finalState = t.final ? JSON.parse(JSON.stringify(t.final)) : { p1: null, p2: null, winner: null };

  if (stage === "semifinal") {
    semis[matchId] = { p1, p2, winner };
    if (semis.semi1.winner && semis.semi2.winner) {
      finalState.p1 = semis.semi1.winner;
      finalState.p2 = semis.semi2.winner;
    }
  }
  if (stage === "final") {
    finalState.winner = winner;
  }

  try {
    await setDoc(doc(db, "rr_tournaments", rrId), {
      matchLog: updatedMatchLog,
      semifinals: semis,
      final: finalState,
      champion,
      status: champion ? "completed" : "active"
    }, { merge: true });

    // Write to main leaderboard
    await addDoc(collection(db, "matches"), {
      matchType: "singles",
      division: t.division,
      player1: p1,
      player2: p2,
      winner: parts[0] > parts[1] ? 1 : 2,
      sets: [{ p1: parts[0], p2: parts[1], tb: null }],
      resultType: "completed",
      source: "roundrobin",
      rrId,
      rrGroup: stage,
      date: new Date().toISOString(),
      timestamp: Date.now(),
      season: getCurrentSeason()
    });
  } catch (err) {
    alert("Error: " + err.message);
  }
};

window._rrDelete = async (rrId) => {
  if (!confirm("Delete this round robin tournament? Match history on the leaderboard will be preserved.")) return;
  try {
    await deleteDoc(doc(db, "rr_tournaments", rrId));
    // Clean up any scheduled entries tied to this tournament
    const schedRef = collection(db, "scheduled");
    const q = query(schedRef, where("tournamentId", "==", rrId));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "scheduled", d.id))));
    console.log("Round robin deleted. Match history preserved on leaderboard.");
  } catch (err) {
    alert("Error deleting: " + err.message);
  }
};

// ── RENDER ──
// ── HELPERS to read flat Firestore structure ──
function getGroupPlayers(t, grp) {
  // Support both new flat playerMap and old groupPlayers structure
  if (t.playerMap) {
    const count = t.playerMap[`${grp}_count`] || 0;
    const players = [];
    for (let i = 0; i < count; i++) {
      const name = t.playerMap[`${grp}_${i}`];
      if (name) players.push(name);
    }
    return players;
  }
  // Fallback for old structure
  return t.groupPlayers?.[grp] || t.groups?.[grp]?.players || [];
}

function getGroupStandings(t, grp) {
  // Support both new flat standings and old nested standings
  if (t.standings) {
    const result = {};
    // New flat format: keys like "A_Name"
    Object.entries(t.standings).forEach(([key, val]) => {
      if (val && val.group === grp && val.name) {
        result[val.name] = val;
      }
    });
    // Old nested format: t.standings.A.Name
    if (Object.keys(result).length === 0 && t.standings[grp]) {
      return t.standings[grp];
    }
    return result;
  }
  return {};
}

function getWeeklySchedule(t, grp) {
  if (!t.schedule) {
    // Old weeklyMatchups structure
    return t.groups?.[grp]?.weeklyMatchups || [];
  }
  const weekCount = t.schedule[`${grp}_weekCount`] || 0;
  const weeks = [];
  for (let wi = 0; wi < weekCount; wi++) {
    const matchCount = t.schedule[`${grp}_w${wi}_count`] || 0;
    const week = [];
    for (let mi = 0; mi < matchCount; mi++) {
      const m = t.schedule[`${grp}_w${wi}_m${mi}`];
      if (m) week.push(m);
    }
    if (week.length) weeks.push(week);
  }
  return weeks;
}

function getTopTwo(standing) {
  return Object.values(standing)
    .sort((a, b) => {
      const aName = a.name || a; const bName = b.name || b;
      const sa = typeof a === 'object' ? a : {setWins:0,setLosses:0,matchWins:0};
      const sb = typeof b === 'object' ? b : {setWins:0,setLosses:0,matchWins:0};
      if (sb.setWins !== sa.setWins) return sb.setWins - sa.setWins;
      return (sb.setWins - sb.setLosses) - (sa.setWins - sa.setLosses);
    })
    .slice(0, 2)
    .map(s => s.name || s);
}

export function renderRRPage() {
  const container = document.getElementById("rr-container");
  if (!container) return;
  const isAdmin = getIsAdmin();

  // Also update RR matchups in the Schedule tab
  const rrEl = document.getElementById("rr-schedule-section");
  if (rrEl) {
    const activeTab = document.querySelector(".sched-div-tab.active");
    const filter = activeTab ? activeTab.dataset.sdiv : "experienced";
    rrEl.innerHTML = renderRRSchedule(filter);
  }

  let html = "";

  if (isAdmin) {
    html += `<div class="rr-admin-bar">
      <button class="btn-primary" onclick="window._rrCreate('beginner')">+ Beginner Round Robin</button>
      <button class="btn-primary" onclick="window._rrCreate('experienced')">+ Experienced Round Robin</button>
    </div>`;
  }

  const tournaments = Object.values(rrTournaments).sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  if (!tournaments.length) {
    const emptyEl = document.getElementById("rr-empty");
    if (emptyEl) emptyEl.classList.remove("hidden");
    container.innerHTML = html;
    return;
  }
  const emptyEl = document.getElementById("rr-empty");
  if (emptyEl) emptyEl.classList.add("hidden");

  tournaments.forEach(t => {
    const statusBadge = t.status === "completed"
      ? `<span class="status-completed">Completed</span>`
      : `<span class="status-active">Active</span>`;

    html += `<div class="rr-card">`;

    // Header
    html += `<div class="rr-header">
      <div style="display:flex;align-items:center;gap:12px">
        <span class="rr-header-title">${t.division.toUpperCase()} ROUND ROBIN</span>
        ${statusBadge}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:Inter,sans-serif">Started ${t.startDate}</span>
        ${isAdmin ? `<button class="btn-sm" style="background:rgba(214,48,49,0.15);border-color:rgba(214,48,49,0.3);color:#FF8080" onclick="window._rrDelete('${t.id}')">Delete</button>` : ""}
      </div>
    </div>`;

    // Body
    html += `<div class="rr-body">`;
    html += `<div class="rr-groups">`;

    ["A","B"].forEach(grp => {
      const groupPlayers = getGroupPlayers(t, grp);
      const standing     = getGroupStandings(t, grp);
      if (!groupPlayers.length) return;

      const sorted = [...groupPlayers].sort((a,b) => {
        const sa = standing[a] || {setWins:0,setLosses:0,matchWins:0};
        const sb = standing[b] || {setWins:0,setLosses:0,matchWins:0};
        if (sb.setWins !== sa.setWins) return sb.setWins - sa.setWins;
        return (sb.setWins-sb.setLosses) - (sa.setWins-sa.setLosses);
      });

      html += `<div>`;
      html += `<div class="rr-group-title">Group ${grp}</div>`;

      // Standings table
      html += `<table class="rr-table" style="margin-bottom:12px">`;
      html += `<tr><th style="text-align:left">Player</th><th>SW</th><th>SL</th><th>W</th></tr>`;
      sorted.forEach((p,i) => {
        const raw = standing[p] || {};
        const s = {setWins: raw.setWins||0, setLosses: raw.setLosses||0, matchWins: raw.matchWins||0, played: raw.played||0};
        const isTop = i < 2 && s.played > 0;
        html += `<tr class="${isTop?"top-row":""}">
          <td>${isTop?"":""}${p}</td>
          <td>${s.setWins}</td>
          <td>${s.setLosses}</td>
          <td>${s.matchWins}</td>
        </tr>`;
      });
      html += `</table>`;

      // Match history
      const history = Object.values(t.matchLog||{}).filter(m => m.group===grp && !m.isSemiFinal && !m.isFinal);
      if (history.length) {
        html += `<div class="rr-week-label" style="margin-top:10px">Match History</div>`;
        history.slice().reverse().forEach(m => {
          const d = m.date ? new Date(m.date).toLocaleDateString() : "";
          html += `<div style="font-size:11px;color:var(--text-2);padding:3px 0;font-family:Inter,sans-serif">
            <span style="color:var(--green);font-weight:600">${m.winner}</span> def. ${m.p1===m.winner?m.p2:m.p1}
            <span style="background:var(--gold-pale);border-radius:10px;padding:1px 7px;font-size:10px;color:#7A5C00;margin:0 4px">${m.p1Sets}-${m.p2Sets}</span>
            <span style="color:var(--muted)">${d}</span>
          </div>`;
        });
      }

      // Admin: log open match
      if (isAdmin && t.status==="active") {
        html += `<div style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select id="rr-${t.id}-${grp}-p1" style="flex:1;min-width:100px;font-size:11px;padding:5px 8px">
            <option value="">Player 1</option>
            ${groupPlayers.map(p=>`<option value="${p}">${p}</option>`).join("")}
          </select>
          <span style="font-size:11px;color:var(--muted)">vs</span>
          <select id="rr-${t.id}-${grp}-p2" style="flex:1;min-width:100px;font-size:11px;padding:5px 8px">
            <option value="">Player 2</option>
            ${groupPlayers.map(p=>`<option value="${p}">${p}</option>`).join("")}
          </select>
          <button class="btn-secondary btn-xs" onclick="
            var p1=document.getElementById('rr-${t.id}-${grp}-p1').value;
            var p2=document.getElementById('rr-${t.id}-${grp}-p2').value;
            if(!p1||!p2||p1===p2){alert('Pick two different players');return;}
            window._rrEnterScore('${t.id}','${grp}',p1,p2)
          ">Log Match</button>
        </div>`;
      }

      html += `</div>`;
    });

    html += `</div>`; // rr-groups

    // Knockout stage — only show real names once semifinals are officially set
    const semis = t.semifinals;
    const fin = t.final;
    const hasSemis = semis?.semi1?.p1 && semis?.semi2?.p1;

    html += `</div><div class="rr-knockout">`;
    html += `<div class="rr-knockout-title">Knockout Stage</div>`;
    html += `<div class="semi-grid">`;

    const s1p1 = hasSemis ? semis.semi1.p1 : "TBD";
    const s1p2 = hasSemis ? semis.semi1.p2 : "TBD";
    const s2p1 = hasSemis ? semis.semi2.p1 : "TBD";
    const s2p2 = hasSemis ? semis.semi2.p2 : "TBD";
    const s1 = semis?.semi1, s2 = semis?.semi2;

    // Semi 1
    html += `<div class="semi-card">
      <div class="semi-label">Semifinal 1 — A1 vs B2</div>
      <div class="semi-matchup">${s1p1} vs ${s1p2}</div>
      ${s1?.winner ? `<div class="semi-result">${s1.winner} advances</div>` : (isAdmin && hasSemis && t.status==="active" ? `<button class="btn-secondary btn-xs" style="margin-top:8px" onclick="window._rrEnterKnockoutScore('${t.id}','semifinal','semi1','${s1p1}','${s1p2}')">Enter Score</button>` : "")}
    </div>`;

    // Semi 2
    html += `<div class="semi-card">
      <div class="semi-label">Semifinal 2 — B1 vs A2</div>
      <div class="semi-matchup">${s2p1} vs ${s2p2}</div>
      ${s2?.winner ? `<div class="semi-result">${s2.winner} advances</div>` : (isAdmin && hasSemis && t.status==="active" ? `<button class="btn-secondary btn-xs" style="margin-top:8px" onclick="window._rrEnterKnockoutScore('${t.id}','semifinal','semi2','${s2p1}','${s2p2}')">Enter Score</button>` : "")}
    </div>`;
    html += `</div>`;

    // Final
    if (s1?.winner && s2?.winner) {
      const fp1 = fin?.p1||s1.winner, fp2 = fin?.p2||s2.winner;
      html += `<div class="final-card">`;
      html += `<div class="final-label">Final</div>`;
      if (t.champion) {
        html += `<div class="final-champion">${t.champion}</div>`;
        html += `<div class="final-champ-label">${t.division} Champion</div>`;
      } else {
        html += `<div class="final-matchup">${fp1} vs ${fp2}</div>`;
        if (isAdmin) html += `<button class="btn-sm" style="background:rgba(201,168,76,0.2);border-color:rgba(201,168,76,0.4);color:var(--gold);margin-top:10px" onclick="window._rrEnterKnockoutScore('${t.id}','final','final','${fp1}','${fp2}')">Enter Final Score</button>`;
      }
      html += `</div>`;
    } else if (!hasSemis) {
      html += `<div class="final-card">`;
      html += `<div class="final-label">Final</div>`;
      html += `<div class="final-matchup">TBD vs TBD</div>`;
      html += `</div>`;
    }

    html += `</div>`; // close rr-knockout
    html += `</div>`; // rr-card
  });

  container.innerHTML = html;
}

window._rrCreate = (division) => createRoundRobin(division);

// ── RR SCHEDULE for the Schedule tab ──
export function renderRRSchedule(divFilter) {
  const isAdmin = getIsAdmin();
  let tournaments = Object.values(rrTournaments).filter(t => t.status === "active");
  if (divFilter && divFilter !== "all") {
    tournaments = tournaments.filter(t => t.division === divFilter);
  }
  if (!tournaments.length) return "";

  let html = "";
  tournaments.forEach(t => {
    html += `<div class="form-card" style="margin-bottom:16px">
      <div class="form-card-title">${t.division.toUpperCase()} Round Robin — Weekly Matchups</div>`;

    ["A","B"].forEach(grp => {
      const groupPlayers = getGroupPlayers(t, grp);
      if (!groupPlayers.length) return;
      const weekly = getWeeklySchedule(t, grp);
      if (!weekly.length) return;

      html += `<div class="rr-group-title" style="margin-top:12px">Group ${grp}</div>`;
      weekly.forEach((weekMatches, wi) => {
        html += `<div class="rr-week-label">Week ${wi+1} <span style="color:var(--muted);font-weight:400">— due ${getWeekDeadline(t.startDate || RR_START, wi)}</span></div>`;
        weekMatches.forEach(matchup => {
          const mp1 = matchup.p1 || "";
          const mp2 = matchup.p2 || "";
          if (!mp1 || !mp2) return;
          const played = (Object.values(t.matchLog||{})).some(m =>
            !m.isSemiFinal && !m.isFinal && m.group===grp &&
            ((m.p1===mp1&&m.p2===mp2)||(m.p1===mp2&&m.p2===mp1))
          );
          const scoreBtn = !played && t.status==="active"
            ? (isAdmin
              ? `<button class="btn-secondary btn-xs" onclick="window._rrEnterScore('${t.id}','${grp}','${mp1}','${mp2}')">Score</button>`
              : `<button class="btn-secondary btn-xs" onclick="window._rrSubmitScore('${t.id}','${grp}','${mp1}','${mp2}')">Submit Score</button>`)
            : "";
          html += `<div class="rr-matchup${played?" played":""}">
            <span style="font-size:12px">${played?"<span class='done-tag'>Done</span> ":""}${mp1} <span class='vs-sep'>vs</span> ${mp2}</span>
            ${scoreBtn}
          </div>`;
        });
      });
    });

    html += `</div>`;
  });
  return html;
}
