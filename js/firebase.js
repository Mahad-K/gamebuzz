// ====================================================
//  firebase.js — Firebase Realtime Database Service
//  All Firebase operations go through this module.
// ====================================================

import { firebaseConfig, SETTINGS } from './config.js';

import { initializeApp }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  remove,
  onValue,
  off,
  serverTimestamp,
  onDisconnect as fbOnDisconnect,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ─── Init ────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Active Firebase listeners we need to clean up on leave
const activeListeners = {};

// ─────────────────────────────────────────────────
//  Helper: db ref shortcuts
// ─────────────────────────────────────────────────
const roomRef   = (code)             => ref(db, `rooms/${code}`);
const playersRef = (code)            => ref(db, `rooms/${code}/players`);
const playerRef  = (code, pid)       => ref(db, `rooms/${code}/players/${pid}`);
const answersRef = (code, qIdx)      => ref(db, `rooms/${code}/answers/${qIdx}`);
const answerRef  = (code, qIdx, pid) => ref(db, `rooms/${code}/answers/${qIdx}/${pid}`);
const votesRef   = (code)            => ref(db, `rooms/${code}/votes`);
const voteRef    = (code, targetId)  => ref(db, `rooms/${code}/votes/${targetId}`);

// ─────────────────────────────────────────────────
//  Generate a random 6-digit room code
// ─────────────────────────────────────────────────
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─────────────────────────────────────────────────
//  Generate a unique player ID
// ─────────────────────────────────────────────────
function generatePlayerId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// ─────────────────────────────────────────────────
//  Check if a room code is already in use
// ─────────────────────────────────────────────────
async function isCodeTaken(code) {
  const snap = await get(roomRef(code));
  return snap.exists();
}

// ─────────────────────────────────────────────────
//  Create a new game room (called by host)
//  Returns: { code, playerId }
// ─────────────────────────────────────────────────
export async function createRoom(hostName, questionCount) {
  let code = generateCode();
  let attempts = 0;
  while (await isCodeTaken(code)) {
    code = generateCode();
    if (++attempts > 10) throw new Error('Could not generate unique room code. Try again.');
  }

  const playerId = generatePlayerId();

  await set(roomRef(code), {
    host: playerId,
    status: 'waiting',
    questionCount,
    currentQuestion: -1,
    questionStartTime: 0,
    phase: 'idle',
    createdAt: Date.now(),
    questions: [],
    players: {
      [playerId]: {
        name: hostName.trim(),
        score: 0,
        joinedAt: Date.now(),
        connected: true,
        avatar: randomAvatar(),
      }
    }
  });

  // Setup presence/disconnect for this player
  await setupPresence(code, playerId);

  return { code, playerId };
}

// ─────────────────────────────────────────────────
//  Join an existing room (called by player)
//  Returns: playerId
// ─────────────────────────────────────────────────
export async function joinRoom(code, playerName) {
  const snap = await get(roomRef(code));
  if (!snap.exists()) throw new Error('Room not found. Check the code and try again.');

  const room = snap.val();
  if (room.status !== 'waiting') throw new Error('Game has already started. You cannot join mid-game.');

  // Count connected players
  const players = room.players || {};
  const connectedCount = Object.values(players).filter(p => p.connected).length;
  
  if (connectedCount >= SETTINGS.MAX_PLAYERS) throw new Error(`Room is full (max ${SETTINGS.MAX_PLAYERS} players).`);

  const playerId = generatePlayerId();
  await set(playerRef(code, playerId), {
    name: playerName.trim(),
    score: 0,
    joinedAt: Date.now(),
    connected: true,
    avatar: randomAvatar(),
  });

  await setupPresence(code, playerId);

  return playerId;
}

// ─────────────────────────────────────────────────
//  Setup Firebase onDisconnect presence handling
// ─────────────────────────────────────────────────
async function setupPresence(code, playerId) {
  const pRef = playerRef(code, playerId);
  // When the client disconnects, mark as not connected
  await fbOnDisconnect(pRef).update({ connected: false });
}

// ─────────────────────────────────────────────────
//  Mark player as reconnected
// ─────────────────────────────────────────────────
export async function markConnected(code, playerId) {
  await update(playerRef(code, playerId), { connected: true });
  // Re-register onDisconnect after reconnect
  await setupPresence(code, playerId);
}

// ─────────────────────────────────────────────────
//  Leave a room (mark disconnected, handle host transfer)
// ─────────────────────────────────────────────────
export async function leaveRoom(code, playerId) {
  try {
    await update(playerRef(code, playerId), { connected: false });
  } catch (_) { /* ignore if room already deleted */ }
}

// ─────────────────────────────────────────────────
//  Transfer host to another player
// ─────────────────────────────────────────────────
export async function transferHost(code, newHostId) {
  await update(roomRef(code), { host: newHostId });
  // Clear all votes after transfer
  await set(votesRef(code), null);
}

// ─────────────────────────────────────────────────
//  Start the game — host writes selected questions
//  and flips room status to 'playing'
// ─────────────────────────────────────────────────
export async function startGame(code, selectedQuestions, questionCount) {
  await update(roomRef(code), {
    status: 'playing',
    questionCount,
    questions: selectedQuestions,
    currentQuestion: 0,
    questionStartTime: Date.now(),
    phase: 'answering',
  });
}

// ─────────────────────────────────────────────────
//  Advance to next question (host only)
// ─────────────────────────────────────────────────
export async function advanceQuestion(code, nextIndex, totalQuestions) {
  if (nextIndex >= totalQuestions) {
    // Game over
    await update(roomRef(code), {
      status: 'finished',
      phase: 'finished',
      currentQuestion: nextIndex,
    });
  } else {
    await update(roomRef(code), {
      currentQuestion: nextIndex,
      questionStartTime: Date.now(),
      phase: 'answering',
    });
    // Clear answers for next question
    await set(answersRef(code, nextIndex), null);
  }
}

// ─────────────────────────────────────────────────
//  Set phase to reveal (host only, after time's up)
// ─────────────────────────────────────────────────
export async function setRevealPhase(code, revealData = null) {
  const update_data = { phase: 'reveal' };
  if (revealData) update_data.revealData = revealData;
  await update(roomRef(code), update_data);
}

// ─────────────────────────────────────────────────
//  Submit a player's answer
// ─────────────────────────────────────────────────
export async function submitAnswer(code, qIdx, playerId, answerIndex) {
  await set(answerRef(code, qIdx, playerId), {
    answer: answerIndex,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────────
//  Update player scores (host calculates, then writes)
// ─────────────────────────────────────────────────
export async function updateScores(code, scoreDeltas) {
  // scoreDeltas: { [playerId]: pointsToAdd }
  const snap = await get(playersRef(code));
  if (!snap.exists()) return;
  const players = snap.val();

  const updates = {};
  for (const [pid, delta] of Object.entries(scoreDeltas)) {
    if (players[pid]) {
      updates[`players/${pid}/score`] = (players[pid].score || 0) + delta;
    }
  }
  if (Object.keys(updates).length > 0) {
    await update(roomRef(code), updates);
  }
}

// ─────────────────────────────────────────────────
//  Get all answers for a question (snapshot)
// ─────────────────────────────────────────────────
export async function getAnswers(code, qIdx) {
  const snap = await get(answersRef(code, qIdx));
  return snap.exists() ? snap.val() : {};
}

// ─────────────────────────────────────────────────
//  Cast a vote for a new host
// ─────────────────────────────────────────────────
export async function castVote(code, targetPlayerId, voterPlayerId) {
  // Remove any existing vote by this voter first
  const votesSnap = await get(votesRef(code));
  if (votesSnap.exists()) {
    const allVotes = votesSnap.val();
    for (const [tid, voters] of Object.entries(allVotes)) {
      if (voters && voters[voterPlayerId]) {
        await remove(ref(db, `rooms/${code}/votes/${tid}/${voterPlayerId}`));
      }
    }
  }
  // Cast new vote
  await set(ref(db, `rooms/${code}/votes/${targetPlayerId}/${voterPlayerId}`), true);
}

// ─────────────────────────────────────────────────
//  REAL-TIME LISTENERS
// ─────────────────────────────────────────────────

/**
 * Listen to the whole room (status, host, currentQuestion, phase, questionStartTime)
 * cb(roomData) — called whenever room data changes
 */
export function listenRoom(code, cb) {
  const r = roomRef(code);
  const handler = onValue(r, snap => cb(snap.exists() ? snap.val() : null));
  activeListeners[`room_${code}`] = { ref: r, handler };
  return () => off(r, 'value', handler);
}

/**
 * Listen to the players list
 * cb(playersObject) — { [playerId]: { name, score, connected, ... } }
 */
export function listenPlayers(code, cb) {
  const r = playersRef(code);
  const handler = onValue(r, snap => cb(snap.exists() ? snap.val() : {}));
  activeListeners[`players_${code}`] = { ref: r, handler };
  return () => off(r, 'value', handler);
}

/**
 * Listen to answers for a specific question
 * cb(answersObject)
 */
export function listenAnswers(code, qIdx, cb) {
  const r = answersRef(code, qIdx);
  const handler = onValue(r, snap => cb(snap.exists() ? snap.val() : {}));
  activeListeners[`answers_${code}_${qIdx}`] = { ref: r, handler };
  return () => off(r, 'value', handler);
}

/**
 * Listen to votes
 * cb(votesObject) — { [targetPlayerId]: { [voterPlayerId]: true } }
 */
export function listenVotes(code, cb) {
  const r = votesRef(code);
  const handler = onValue(r, snap => cb(snap.exists() ? snap.val() : {}));
  activeListeners[`votes_${code}`] = { ref: r, handler };
  return () => off(r, 'value', handler);
}

// ─────────────────────────────────────────────────
//  Clean up all listeners
// ─────────────────────────────────────────────────
export function cleanupListeners() {
  for (const key of Object.keys(activeListeners)) {
    const { ref: r, handler } = activeListeners[key];
    off(r, 'value', handler);
    delete activeListeners[key];
  }
}

// ─────────────────────────────────────────────────
//  Delete a room entirely (host, on game end)
// ─────────────────────────────────────────────────
export async function deleteRoom(code) {
  await remove(roomRef(code));
}

// ─────────────────────────────────────────────────
//  Get a single snapshot of the room (no listener)
// ─────────────────────────────────────────────────
export async function getRoom(code) {
  const snap = await get(roomRef(code));
  return snap.exists() ? snap.val() : null;
}

// ─────────────────────────────────────────────────
//  Get a single snapshot of all players
// ─────────────────────────────────────────────────
export async function getPlayers(code) {
  const snap = await get(playersRef(code));
  return snap.exists() ? snap.val() : {};
}

// ─────────────────────────────────────────────────
//  Avatar emoji pool
// ─────────────────────────────────────────────────
const AVATARS = ['🦊','🐼','🦁','🐯','🦄','🐸','🐧','🦋','🐙','🦀','🐺','🦉','🦝','🐻','🦖'];

function randomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}
