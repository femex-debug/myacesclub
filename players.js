// ── Players Module ──
let onPlayerSkillSetCallback = null;
export function onPlayerSkillSet(cb) { onPlayerSkillSetCallback = cb; }
import { db, collection, doc, addDoc, setDoc, deleteDoc, getDocs, onSnapshot, query, orderBy, where } from "./firebase.js";
import { getIsAdmin } from "./admin.js";

let playersList = []; // [{ id, name, division }]
let onPlayersChange = () => {};

export function getPlayers() { return playersList; }
export function setOnPlayersChange(fn) { onPlayersChange = fn; }

export function initPlayers() {
  const playersRef = collection(db, "players");
  const q = query(playersRef, orderBy("name"));

  onSnapshot(q, snap => {
    playersList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRoster();
    updateDatalist();
    onPlayersChange();
  });

  document.getElementById("add-player-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("new-player-name").value.trim();
    const division = document.getElementById("new-player-div").value;
    if (!name) return;
    if (playersList.find(p => p.name.toLowerCase() === name.toLowerCase())) { alert("Player already exists."); return; }
    await addDoc(collection(db, "players"), { name, division });
    if (onPlayerSkillSetCallback) onPlayerSkillSetCallback(name, division);
    document.getElementById("new-player-name").value = "";
  });
}

function renderRoster() {
  const el = document.getElementById("player-roster");
  el.innerHTML = playersList.map(p =>
    `<div class="roster-item">
      <span>${p.name} <span class="div-pill div-${p.division}">${(p.division||"").toUpperCase()}</span></span>
      <button class="btn-danger btn-sm" onclick="window._removePlayer('${p.id}')">Remove</button>
    </div>`
  ).join("");
}

window._removePlayer = async (id) => {
  if (confirm("Remove this player from the roster?")) await deleteDoc(doc(db, "players", id));
};

window._removePlayerByName = async (name) => {
  const player = playersList.find(p => p.name === name);
  if (!player) return;
  const deleteHistory = confirm(
    `Remove ${name} from the leaderboard?\n\nClick OK to remove them AND delete their match history.\nThis cannot be undone.`
  );
  if (!deleteHistory) return;
  try {
    // Delete player record
    await deleteDoc(doc(db, "players", player.id));
    // Delete all matches involving this player
    const matchesRef = collection(db, "matches");
    const q1 = query(matchesRef, where("player1", "==", name));
    const q2 = query(matchesRef, where("player2", "==", name));
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const deletes = [
      ...snap1.docs.map(d => deleteDoc(doc(db, "matches", d.id))),
      ...snap2.docs.map(d => deleteDoc(doc(db, "matches", d.id)))
    ];
    await Promise.all(deletes);
    console.log(`Removed ${name} and ${deletes.length} matches`);
  } catch (err) {
    console.error("Remove player error:", err);
    alert("Error removing player: " + err.message);
  }
};

// Expose admin check for leaderboard delete buttons
window._getIsAdmin = () => getIsAdmin();

export function updateDatalist() {
  const dl = document.getElementById("player-list");
  dl.innerHTML = playersList.map(p => `<option value="${p.name}">`).join("");
}

// ── Skill Level Assignment (admin only) ──
export function renderSkillAssignment() {
  const el = document.getElementById("skill-assignment");
  if (!el) return;
  if (!getIsAdmin()) { el.innerHTML = ""; return; }

  if (!playersList.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px 0"><div class="empty-sub">No players yet</div></div>`;
    return;
  }

  // Sort: unassigned first, then alphabetical
  const sorted = [...playersList].sort((a, b) => {
    const aSet = a.division ? 1 : 0;
    const bSet = b.division ? 1 : 0;
    return aSet - bSet || a.name.localeCompare(b.name);
  });

  const unassigned = sorted.filter(p => !p.division);
  let html = "";

  if (unassigned.length) {
    html += `<div class="info-banner" style="margin-bottom:12px">
      <span class="info-icon">!</span>
      ${unassigned.length} player${unassigned.length>1?"s":""} still need a skill level assigned.
    </div>`;
  }

  html += sorted.map(p => {
    const div = (p.division || "").toLowerCase();
    const isUnset = !p.division;
    return `<div class="skill-row${isUnset?" unset":""}">
      <div class="player-label">
        <span>${p.name}</span>
        ${div ? `<span class="division-badge badge-${div}">${div.toUpperCase()}</span>` : ""}
        ${isUnset ? `<span class="unset-badge">Unset</span>` : ""}
      </div>
      <select onchange="window._setSkillLevel('${p.id}', this.value)">
        <option value="" ${!div?"selected":""} disabled>Set level...</option>
        <option value="beginner" ${div==="beginner"?"selected":""}>Beginner</option>
        <option value="experienced" ${div==="experienced"?"selected":""}>Experienced</option>
      </select>
    </div>`;
  }).join("");

  el.innerHTML = html;
}

window._setSkillLevel = async (playerId, level) => {
  if (!level) return;
  try {
    await setDoc(doc(db, "players", playerId), { division: level }, { merge: true });
    // Notify app that skill level was set (app.js wires this to round robin)
    const player = playersList.find(p => p.id === playerId);
    if (player && onPlayerSkillSetCallback) onPlayerSkillSetCallback(player.name, level);
  } catch (err) {
    alert("Error updating skill level: " + err.message);
  }
};
