// ── Tournament Bracket Module ──
import { getCurrentSeason } from "./matches.js";
import { db, collection, doc, addDoc, setDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, where } from "./firebase.js";
import { getIsAdmin } from "./admin.js";

let tournaments = [];
let activeTournamentId = null;

export function initTournament() {
  const ref = collection(db, "tournaments");
  const q = query(ref, orderBy("createdAt", "desc"));

  onSnapshot(q, snap => {
    tournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTourneyList();
    // Refresh bracket view if one is open
    if (activeTournamentId) window._viewBracket(activeTournamentId);
  }, err => {
    console.error("Tournament listener error:", err);
  });

  document.getElementById("tourney-gen-seeds").addEventListener("click", () => {
    const size = parseInt(document.getElementById("tourney-size").value);
    if (!size || size < 2) { alert("Please enter the number of players first (minimum 2)."); return; }
    const container = document.getElementById("tourney-seeds");
    container.innerHTML = `<h3>Enter Player Names (${size} players)</h3>`;
    for (let i = 1; i <= size; i++) {
      container.innerHTML += `<div class="form-row"><label>Player ${i} <input type="text" class="seed-input" list="player-list" placeholder="Player name"></label></div>`;
    }
  });

  document.getElementById("tourney-form").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("tourney-msg");
    msg.textContent = "Saving...";
    msg.className = "";

    const name     = document.getElementById("tourney-name").value.trim();
    const division = document.getElementById("tourney-div").value;
    const size     = parseInt(document.getElementById("tourney-size").value);
    const date     = document.getElementById("tourney-date").value;

    if (!name)           { msg.textContent = "Please enter a tournament name."; msg.className = "msg-err"; return; }
    if (!date)           { msg.textContent = "Please enter a date."; msg.className = "msg-err"; return; }
    if (!size || size<2) { msg.textContent = "Please enter the number of players."; msg.className = "msg-err"; return; }

    const seedInputs = document.querySelectorAll(".seed-input");
    const seeds = Array.from(seedInputs).map(i => i.value.trim()).filter(Boolean);
    if (seeds.length < 2) { msg.textContent = "Click Generate Seed Slots and enter at least 2 player names."; msg.className = "msg-err"; return; }

    // RANDOMIZE the draw using Fisher-Yates shuffle
    const shuffled = [...seeds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Build bracket from shuffled order
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(size, 2))));
    const allSeeds = [...shuffled];
    while (allSeeds.length < bracketSize) allSeeds.push("BYE");

    const numRounds = Math.log2(bracketSize);
    const matches = {};

    // Round 1 — randomized players
    for (let m = 0; m < bracketSize / 2; m++) {
      const p1 = allSeeds[m * 2]     || "BYE";
      const p2 = allSeeds[m * 2 + 1] || "BYE";
      const winner = p2 === "BYE" ? p1 : (p1 === "BYE" ? p2 : "");
      matches[`r0_m${m}`] = { p1, p2, score: "", winner };
    }

    // Remaining rounds — empty
    for (let r = 1; r < numRounds; r++) {
      const matchCount = Math.pow(2, numRounds - r - 1);
      for (let m = 0; m < matchCount; m++) {
        matches[`r${r}_m${m}`] = { p1: "", p2: "", score: "", winner: "" };
      }
    }

    // Propagate BYE winners forward
    for (let m = 0; m < bracketSize / 2; m++) {
      const match = matches[`r0_m${m}`];
      if (match.winner) {
        const nextMatch = Math.floor(m / 2);
        const slot = m % 2 === 0 ? "p1" : "p2";
        const key = `r1_m${nextMatch}`;
        if (matches[key]) matches[key][slot] = match.winner;
      }
    }

    const payload = {
      name, division, size, bracketSize, numRounds,
      date, seeds: shuffled,
      matches, status: "active", champion: "",
      createdAt: new Date().toISOString()
    };

    try {
      const docRef = await addDoc(collection(db, "tournaments"), payload);
      console.log("Tournament saved:", docRef.id);

      // Write Round 1 matches to the scheduled collection
      const r1Count = bracketSize / 2;
      const scheduleWrites = [];
      for (let m = 0; m < r1Count; m++) {
        const match = payload.matches[`r0_m${m}`];
        // Skip BYE matches
        if (match.p1 === "BYE" || match.p2 === "BYE") continue;
        const matchKey = `r0_m${m}`;
        scheduleWrites.push(addDoc(collection(db, "scheduled"), {
          matchType: "singles",
          division: division,
          player1: match.p1,
          player2: match.p2,
          dateTime: `${date}T09:00:00`,
          court: "Tournament Court",
          status: "upcoming",
          source: "tournament",
          tournamentId: docRef.id,
          tournamentName: name,
          round: "Round 1",
          matchKey: matchKey
        }));
      }
      await Promise.all(scheduleWrites);
      console.log(`Added ${scheduleWrites.length} matches to schedule`);

      msg.textContent = `Tournament created! ${scheduleWrites.length} Round 1 matches added to Schedule.`;
      msg.className = "msg-ok";
      e.target.reset();
      document.getElementById("tourney-seeds").innerHTML = "";
    } catch (err) {
      console.error("Error:", err);
      msg.textContent = `Error: ${err.message}`;
      msg.className = "msg-err";
    }
  });
}

function getRoundName(roundIdx, numRounds) {
  const fromEnd = numRounds - 1 - roundIdx;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quarterfinal";
  if (fromEnd === 3) return "Round of 16";
  if (fromEnd === 4) return "Round of 32";
  return `Round ${roundIdx + 1}`;
}

function renderTourneyList() {
  const el = document.getElementById("tourney-list");
  if (!tournaments.length) { el.innerHTML = "<p>No tournaments yet.</p>"; return; }
  const isAdmin = getIsAdmin();
  el.innerHTML = tournaments.map(t => {
    const status = t.status === "active" ? "Active - In Progress" : "Done - Completed";
    const champ  = t.champion ? `<br>Champion: <b>${t.champion}</b>` : "";
    const delBtn = isAdmin
      ? `<button class="btn-sm" style="color:#C0392B;border-color:#C0392B;float:right;padding:4px 10px" onclick="event.stopPropagation();window._deleteTournament('${t.id}')">Delete</button>`
      : "";
    return `<div class="tourney-card" onclick="window._viewBracket('${t.id}')">
      ${delBtn}
      <h4>${t.name}</h4>
      <p>${(t.division||"").toUpperCase()} &bull; ${t.size} players &bull; ${t.date} &bull; ${status}${champ}</p>
    </div>`;
  }).join("");
}

window._deleteTournament = async (id) => {
  console.log("Delete requested for tournament ID:", id);
  const t = tournaments.find(x => x.id === id);
  if (!t) { console.error("Tournament not found in local list:", id); return; }
  if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
  try {
    console.log("Calling deleteDoc on tournaments/" + id);

    // Delete tournament document
    await deleteDoc(doc(db, "tournaments", id));

    // Delete scheduled entries for this tournament only
    // Match history in the matches collection is intentionally preserved on the leaderboard
    const schedRef = collection(db, "scheduled");
    const q = query(schedRef, where("tournamentId", "==", id));
    const snap = await getDocs(q);
    const deletes = snap.docs.map(d => deleteDoc(doc(db, "scheduled", d.id)));
    await Promise.all(deletes);
    console.log(`Deleted tournament + ${deletes.length} scheduled entries. Match history preserved on leaderboard.`);

    if (activeTournamentId === id) {
      activeTournamentId = null;
      const view = document.getElementById("bracket-view");
      view.classList.add("hidden");
      view.innerHTML = "";
    }
  } catch (err) {
    console.error("Delete error:", err);
    alert("Error deleting: " + err.message + "\nCheck Firebase rules.");
  }
};

window._viewBracket = (id) => {
  const t = tournaments.find(x => x.id === id);
  if (!t || !t.matches) return;

  activeTournamentId = id;
  const view = document.getElementById("bracket-view");
  view.classList.remove("hidden");
  const isAdmin = getIsAdmin();

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <h3>${t.name} <small style="color:#757575">${t.date}</small></h3>
    <div style="display:flex;gap:8px">
      ${isAdmin ? `<button class="btn-sm" style="color:#C0392B;border-color:#C0392B" onclick="window._deleteTournament('${t.id}')">Delete Tournament</button>` : ""}
      <button class="btn-sm" onclick="document.getElementById('bracket-view').classList.add('hidden');window._activeTournamentId=null">x Close</button>
    </div>
  </div>`;

  if (t.champion) html += `<div class="tourney-champion">Champion: ${t.champion}</div>`;
  html += `<div class="bracket">`;

  for (let r = 0; r < t.numRounds; r++) {
    const matchCount = Math.pow(2, t.numRounds - r - 1);
    html += `<div class="bracket-round"><h4>${getRoundName(r, t.numRounds)}</h4>`;

    for (let m = 0; m < matchCount; m++) {
      const key   = `r${r}_m${m}`;
      const match = t.matches[key] || { p1:"", p2:"", score:"", winner:"" };
      const completed = match.winner ? "completed" : "";
      const p1Display = match.p1 || "TBD";
      const p2Display = match.p2 || "TBD";
      const p1Class   = match.winner && match.winner === match.p1 ? "winner" : (!match.p1 ? "empty" : "");
      const p2Class   = match.winner && match.winner === match.p2 ? "winner" : (!match.p2 ? "empty" : "");
      const scoreStr  = match.score ? ` (${match.score})` : "";
      const isBye     = match.p1 === "BYE" || match.p2 === "BYE";
      const canEnter  = isAdmin && match.p1 && match.p2 && !match.winner && !isBye;
      const enterBtn  = canEnter ? `<button class="btn-sm" onclick="window._enterBracketScore('${id}','${key}')">Score</button>` : "";

      html += `<div class="bracket-match ${completed}">
        <div class="bracket-slot ${p1Class}">${p1Display}${match.winner === match.p1 ? scoreStr : ""}</div>
        <div class="bracket-slot ${p2Class}">${p2Display}</div>
        ${enterBtn}
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  view.innerHTML = html;
};

window._enterBracketScore = async (tourneyId, matchKey) => {
  const score = prompt("Enter scores (e.g. 6-4, 7-5):");
  if (!score) return;
  const winnerNum = prompt("Who won? Enter 1 for top player or 2 for bottom player:");
  if (winnerNum !== "1" && winnerNum !== "2") { alert("Please enter 1 or 2."); return; }

  const t = tournaments.find(x => x.id === tourneyId);
  if (!t) return;

  const parts    = matchKey.match(/r(\d+)_m(\d+)/);
  const roundIdx = parseInt(parts[1]);
  const matchIdx = parseInt(parts[2]);

  const match  = { ...t.matches[matchKey] };
  match.score  = score;
  match.winner = winnerNum === "1" ? match.p1 : match.p2;

  const updatedMatches = { ...t.matches, [matchKey]: match };

  // Advance winner to next round
  const nextRound = roundIdx + 1;
  const nextMatchIdx = Math.floor(matchIdx / 2);
  const nextKey   = `r${nextRound}_m${nextMatchIdx}`;
  let nextMatchReady = null;

  if (updatedMatches[nextKey] !== undefined) {
    const nextM = { ...updatedMatches[nextKey] };
    nextM[matchIdx % 2 === 0 ? "p1" : "p2"] = match.winner;
    updatedMatches[nextKey] = nextM;

    // Check if both players are now set in the next round match
    if (nextM.p1 && nextM.p2 && nextM.p1 !== "BYE" && nextM.p2 !== "BYE" && !nextM.winner) {
      nextMatchReady = { key: nextKey, match: nextM, roundIdx: nextRound, matchIdx: nextMatchIdx };
    }
  }

  // Check for champion
  const finalKey   = `r${t.numRounds - 1}_m0`;
  const finalMatch = updatedMatches[finalKey];
  const isComplete = !!(finalMatch && finalMatch.winner);
  const champion   = isComplete ? finalMatch.winner : (t.champion || "");

  // Get round name for schedule label
  const roundNames = ["Round 1","Round 2","Quarterfinal","Semifinal","Final"];
  const getRoundLabel = (rIdx, numR) => {
    const fromEnd = numR - 1 - rIdx;
    if (fromEnd === 0) return "Final";
    if (fromEnd === 1) return "Semifinal";
    if (fromEnd === 2) return "Quarterfinal";
    return `Round ${rIdx + 1}`;
  };

  try {
    // Save tournament state
    await setDoc(doc(db, "tournaments", tourneyId), {
      matches: updatedMatches,
      status:  isComplete ? "completed" : "active",
      champion
    }, { merge: true });

    // Write match result to matches collection so it appears on leaderboard
    const setScores = score.split(",").map(s => {
      const parts = s.trim().split("-");
      const p1s = parseInt(parts[0]) || 0;
      const p2s = parseInt(parts[1]) || 0;
      return { p1: p1s, p2: p2s, tb: null };
    });
    const matchWinner = winnerNum === "1" ? 1 : 2;
    await addDoc(collection(db, "matches"), {
      matchType: "singles",
      division: t.division,
      player1: match.p1,
      player2: match.p2,
      winner: matchWinner,
      sets: setScores,
      resultType: "completed",
      source: "tournament",
      tournamentId: tourneyId,
      tournamentName: t.name,
      round: getRoundLabel(roundIdx, t.numRounds),
      date: new Date().toISOString(),
      timestamp: Date.now(),
      season: getCurrentSeason()
    });

    // Remove the completed match from scheduled
    // Use single where clause (no composite index needed) then filter matchKey in JS
    const schedRef = collection(db, "scheduled");
    const qDone = query(schedRef, where("tournamentId", "==", tourneyId));
    const snapDone = await getDocs(qDone);
    const toDelete = snapDone.docs.filter(d => d.data().matchKey === matchKey);
    await Promise.all(toDelete.map(d => deleteDoc(doc(db, "scheduled", d.id))));

    // Add next round match to scheduled if both players are ready
    if (nextMatchReady) {
      const roundLabel = getRoundLabel(nextMatchReady.roundIdx, t.numRounds);
      await addDoc(collection(db, "scheduled"), {
        matchType: "singles",
        division: t.division,
        player1: nextMatchReady.match.p1,
        player2: nextMatchReady.match.p2,
        dateTime: `${t.date}T09:00:00`,
        court: "Tournament Court",
        status: "upcoming",
        source: "tournament",
        tournamentId: tourneyId,
        tournamentName: t.name,
        round: roundLabel,
        matchKey: nextMatchReady.key
      });
    }

    if (isComplete) {
      // Clean up any remaining scheduled matches for this tournament
      const qAll = query(schedRef, where("tournamentId", "==", tourneyId));
      const snapAll = await getDocs(qAll);
      await Promise.all(snapAll.docs.map(d => deleteDoc(doc(db, "scheduled", d.id))));
    }

  } catch (err) {
    console.error("Score update error:", err);
    alert("Error saving score: " + err.message);
  }
};
