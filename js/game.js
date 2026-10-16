// ====================================================
//  game.js — Game State Machine & Logic
//  Manages all game state, timers, scoring, and
//  admin transfer. Works with firebase.js for persistence.
// ====================================================

import { SETTINGS } from './config.js';
import { QUESTIONS } from './questions.js';
import {
  startGame,
  advanceQuestion,
  setRevealPhase,
  submitAnswer,
  updateScores,
  getAnswers,
  transferHost,
  castVote,
  leaveRoom,
  cleanupListeners,
  listenRoom,
  listenPlayers,
  listenAnswers,
  listenVotes,
  markConnected,
} from './firebase.js';

// ─────────────────────────────────────────────────
//  Game State (singleton)
// ─────────────────────────────────────────────────
export const state = {
  // Identity
  roomCode:    null,
  playerId:    null,
  playerName:  null,
  isHost:      false,

  // Room snapshot (latest from Firebase)
  room: null,
  players: {},          // { [playerId]: { name, score, connected, avatar } }
  votes: {},            // { [targetId]: { [voterId]: true } }

  // Game progress
  currentQuestion: -1,
  phase: 'idle',         // 'idle' | 'answering' | 'reveal' | 'finished'
  myAnswer: null,        // index of selected answer (null = not answered)
  questionStartTime: 0,
  selectedQuestions: [], // subset of QUESTIONS

  // Timers (host only)
  _answerTimer: null,
  _revealTimer: null,
  _timerInterval: null,  // for countdown UI

  // Unsubscribe functions for Firebase listeners
  _unsubRoom:    null,
  _unsubPlayers: null,
  _unsubAnswers: null,
  _unsubVotes:   null,
};

// Callbacks registered by ui/app layer
const callbacks = {
  onRoomUpdate: null,
  onPlayersUpdate: null,
  onVotesUpdate: null,
  onPhaseChange: null,
  onQuestionChange: null,
  onAnswersUpdate: null,
  onGameEnd: null,
};

// ─────────────────────────────────────────────────
//  Register event callbacks from UI layer
// ─────────────────────────────────────────────────
export function on(event, fn) {
  callbacks[event] = fn;
}

function emit(event, data) {
  if (callbacks[event]) callbacks[event](data);
}

// ─────────────────────────────────────────────────
//  Initialize game session (called after host/join)
// ─────────────────────────────────────────────────
export function initSession(code, playerId, playerName, isHost) {
  state.roomCode   = code;
  state.playerId   = playerId;
  state.playerName = playerName;
  state.isHost     = isHost;
  state.myAnswer   = null;

  // Re-register presence on reconnect
  markConnected(code, playerId).catch(console.error);

  // Setup Firebase listeners
  _subscribeAll(code);

  // Handle page visibility change (re-mark connected on focus)
  document.addEventListener('visibilitychange', _handleVisibility);
}

// ─────────────────────────────────────────────────
//  Subscribe to all relevant Firebase paths
// ─────────────────────────────────────────────────
function _subscribeAll(code) {
  // Unsubscribe previous if any
  _unsubscribeAll();

  state._unsubRoom = listenRoom(code, _onRoomUpdate);
  state._unsubPlayers = listenPlayers(code, _onPlayersUpdate);
  state._unsubVotes = listenVotes(code, _onVotesUpdate);
}

function _unsubscribeAll() {
  if (state._unsubRoom)    { state._unsubRoom();    state._unsubRoom = null; }
  if (state._unsubPlayers) { state._unsubPlayers(); state._unsubPlayers = null; }
  if (state._unsubAnswers) { state._unsubAnswers(); state._unsubAnswers = null; }
  if (state._unsubVotes)   { state._unsubVotes();   state._unsubVotes = null; }
}

// ─────────────────────────────────────────────────
//  Firebase room listener callback
// ─────────────────────────────────────────────────
function _onRoomUpdate(roomData) {
  if (!roomData) {
    // Room deleted — game over
    emit('onGameEnd', { reason: 'room_deleted' });
    return;
  }

  const prevPhase    = state.phase;
  const prevQuestion = state.currentQuestion;

  state.room              = roomData;
  state.phase             = roomData.phase || 'idle';
  state.currentQuestion   = roomData.currentQuestion ?? -1;
  state.questionStartTime = roomData.questionStartTime || 0;

  // Rebuild selected questions list from Firebase
  if (roomData.questions && roomData.questions.length > 0) {
    state.selectedQuestions = roomData.questions;
  }

  // Update isHost (can change if host transferred)
  const wasHost  = state.isHost;
  state.isHost   = roomData.host === state.playerId;
  if (!wasHost && state.isHost) {
    // We just became the host — take over timers if game is in progress
    if (roomData.status === 'playing' && state.phase === 'answering') {
      _takeOverHostTimer();
    }
  }

  // Phase change handlers
  if (state.phase !== prevPhase || state.currentQuestion !== prevQuestion) {
    _handlePhaseChange(prevPhase, prevQuestion);
  }

  emit('onRoomUpdate', roomData);
}

// ─────────────────────────────────────────────────
//  Firebase players listener callback
// ─────────────────────────────────────────────────
function _onPlayersUpdate(playersData) {
  state.players = playersData || {};
  emit('onPlayersUpdate', state.players);

  // Auto-detect host disconnect — promote oldest joined connected player
  if (state.room && state.room.host) {
    const hostPlayer = state.players[state.room.host];
    if (hostPlayer && !hostPlayer.connected) {
      _promoteNextHost();
    }
  }

  // Check if game should end (only 1 player left connected during a game)
  if (state.room?.status === 'playing') {
    const connectedCount = Object.values(state.players).filter(p => p.connected).length;
    if (connectedCount <= 1) {
      // Transition to finished
      if (state.isHost) {
        _endGame();
      }
    }
  }
}

// ─────────────────────────────────────────────────
//  Firebase votes listener callback
// ─────────────────────────────────────────────────
function _onVotesUpdate(votesData) {
  state.votes = votesData || {};

  // Check if any candidate has majority votes
  const connectedPlayers = Object.entries(state.players)
    .filter(([pid, p]) => p.connected && pid !== state.room?.host);
  const totalVoters = connectedPlayers.length;
  const majority = Math.floor(totalVoters / 2) + 1;

  for (const [targetId, voters] of Object.entries(state.votes)) {
    const voteCount = Object.keys(voters || {}).length;
    if (voteCount >= majority && totalVoters >= 2) {
      // Majority reached — transfer host
      if (state.isHost || Object.keys(voters).includes(state.playerId)) {
        // Only one client should fire this — use the current host or first voter
        if (state.isHost || state.playerId === Object.keys(voters)[0]) {
          transferHost(state.roomCode, targetId).catch(console.error);
        }
      }
    }
  }

  emit('onVotesUpdate', state.votes);
}

// ─────────────────────────────────────────────────
//  Promote the oldest-joined connected player to host
// ─────────────────────────────────────────────────
function _promoteNextHost() {
  const connected = Object.entries(state.players)
    .filter(([pid, p]) => p.connected && pid !== state.room?.host)
    .sort(([, a], [, b]) => a.joinedAt - b.joinedAt);

  if (connected.length === 0) {
    // No one left, clean up
    return;
  }

  const [newHostId] = connected[0];
  // Only the new host should call transferHost (to avoid race conditions)
  // Pick the player with the lowest joinedAt among connected non-hosts
  // We use the fact that all clients share the same logic
  if (newHostId === state.playerId) {
    transferHost(state.roomCode, newHostId).catch(console.error);
  }
}

// ─────────────────────────────────────────────────
//  Handle phase/question transitions
// ─────────────────────────────────────────────────
function _handlePhaseChange(prevPhase, prevQuestion) {
  const { phase, currentQuestion } = state;

  if (phase === 'answering' && (prevPhase !== 'answering' || currentQuestion !== prevQuestion)) {
    // New question starting
    state.myAnswer = null;
    _cancelHostTimers();

    // Subscribe to this question's answers
    if (state._unsubAnswers) { state._unsubAnswers(); state._unsubAnswers = null; }
    state._unsubAnswers = listenAnswers(state.roomCode, currentQuestion, _onAnswersUpdate);

    // Host starts the answer timer
    if (state.isHost) {
      _startAnswerTimer();
    }

    emit('onQuestionChange', {
      questionIndex: currentQuestion,
      question: state.selectedQuestions[currentQuestion],
      total: state.selectedQuestions.length,
      startTime: state.questionStartTime,
    });
  }

  if (phase === 'reveal') {
    _cancelHostTimers();

    if (state.isHost) {
      // Host: calculate scores, write reveal data to Firebase, start reveal timer.
      // The emit happens inside _calculateAndWriteScores directly.
      _calculateAndWriteScores().then(() => {
        _startRevealTimer();
      });
    } else {
      // Non-host: revealData is written to Firebase by the host.
      // It's available in state.room.revealData as set by the room listener.
      const rd = state.room?.revealData;
      if (rd) {
        emit('onPhaseChange', {
          phase: 'reveal',
          correctIndex: rd.correctIndex,
          correctText: rd.correctText,
          deltas: rd.deltas || {},
          firstCorrectPlayer: rd.firstCorrectPlayer || null,
          myAnswer: state.myAnswer,
          myDelta: rd.deltas?.[state.playerId] || 0,
        });
      }
    }
  }

  if (phase === 'finished') {
    _cancelHostTimers();
    emit('onGameEnd', { players: state.players });
  }
}

// ─────────────────────────────────────────────────
//  Firebase answers listener callback
// ─────────────────────────────────────────────────
function _onAnswersUpdate(answersData) {
  emit('onAnswersUpdate', answersData || {});

  // Host: check if all connected players have answered → early reveal
  if (state.isHost && state.phase === 'answering') {
    const connectedPlayers = Object.entries(state.players)
      .filter(([, p]) => p.connected)
      .map(([pid]) => pid);

    const answered = Object.keys(answersData || {});
    const allAnswered = connectedPlayers.every(pid => answered.includes(pid));

    if (allAnswered && connectedPlayers.length > 0) {
      _triggerReveal();
    }
  }
}

// ─────────────────────────────────────────────────
//  Host: Start answer timer (20s)
// ─────────────────────────────────────────────────
function _startAnswerTimer() {
  const ms = SETTINGS.ANSWER_TIME_SEC * 1000;
  state._answerTimer = setTimeout(() => {
    _triggerReveal();
  }, ms);
}

function _triggerReveal() {
  if (state.phase !== 'answering') return; // already moved on
  _cancelHostTimers();
  setRevealPhase(state.roomCode).catch(console.error);
}

// ─────────────────────────────────────────────────
//  Host: Start reveal timer (4s)
// ─────────────────────────────────────────────────
function _startRevealTimer() {
  state._revealTimer = setTimeout(() => {
    const nextQ = state.currentQuestion + 1;
    advanceQuestion(state.roomCode, nextQ, state.selectedQuestions.length)
      .catch(console.error);
  }, SETTINGS.REVEAL_TIME_SEC * 1000);
}

// ─────────────────────────────────────────────────
//  Cancel host timers
// ─────────────────────────────────────────────────
function _cancelHostTimers() {
  if (state._answerTimer)  { clearTimeout(state._answerTimer);  state._answerTimer  = null; }
  if (state._revealTimer)  { clearTimeout(state._revealTimer);  state._revealTimer  = null; }
  if (state._timerInterval){ clearInterval(state._timerInterval); state._timerInterval = null; }
}

// ─────────────────────────────────────────────────
//  New host takes over timer mid-game
// ─────────────────────────────────────────────────
function _takeOverHostTimer() {
  _cancelHostTimers();
  if (state.phase === 'answering') {
    const elapsed = Date.now() - state.questionStartTime;
    const remaining = Math.max(0, SETTINGS.ANSWER_TIME_SEC * 1000 - elapsed);
    state._answerTimer = setTimeout(() => {
      _triggerReveal();
    }, remaining);
  } else if (state.phase === 'reveal') {
    _calculateAndWriteScores().then(() => _startRevealTimer());
  }
}

// ─────────────────────────────────────────────────
//  Calculate scores and write to Firebase
// ─────────────────────────────────────────────────
async function _calculateAndWriteScores() {
  const qIdx = state.currentQuestion;
  const question = state.selectedQuestions[qIdx];
  if (!question) return {};

  const answers = await getAnswers(state.roomCode, qIdx);
  const correctIndex = question.a;
  const correctText  = question.o[correctIndex];

  const deltas = {};
  let firstCorrectTime = Infinity;
  let firstCorrectPlayer = null;

  // Gather correct answers and find the fastest
  for (const [pid, ans] of Object.entries(answers)) {
    if (ans.answer === correctIndex) {
      deltas[pid] = (deltas[pid] || 0) + SETTINGS.POINTS_CORRECT;
      if (ans.timestamp < firstCorrectTime) {
        firstCorrectTime = ans.timestamp;
        firstCorrectPlayer = pid;
      }
    }
  }

  // Add first-correct bonus
  if (firstCorrectPlayer) {
    deltas[firstCorrectPlayer] = (deltas[firstCorrectPlayer] || 0) + SETTINGS.POINTS_FIRST_BONUS;
  }

  // Write scores to Firebase
  if (Object.keys(deltas).length > 0) {
    await updateScores(state.roomCode, deltas);
  }

  // Write reveal data to Firebase (so non-hosts can read it from their room listener)
  const revealPayload = { correctIndex, correctText, deltas, firstCorrectPlayer };
  await setRevealPhase(state.roomCode, revealPayload);

  // Emit reveal for THIS client (the host) directly since it won't re-enter _handlePhaseChange
  emit('onPhaseChange', {
    phase: 'reveal',
    correctIndex,
    correctText,
    deltas,
    firstCorrectPlayer,
    myAnswer: state.myAnswer,
    myDelta: deltas[state.playerId] || 0,
  });

  return { correctIndex, correctText, deltas, firstCorrectPlayer };
}

// ─────────────────────────────────────────────────
//  End game manually (e.g. too few players)
// ─────────────────────────────────────────────────
async function _endGame() {
  await advanceQuestion(state.roomCode, state.selectedQuestions.length, state.selectedQuestions.length);
}

// ─────────────────────────────────────────────────
//  PUBLIC: Host starts game
// ─────────────────────────────────────────────────
export async function hostStartGame(questionCount) {
  if (!state.isHost) return;

  // Pick random questions from the bank
  const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, questionCount);

  await startGame(state.roomCode, selected, questionCount);
}

// ─────────────────────────────────────────────────
//  PUBLIC: Player submits an answer
// ─────────────────────────────────────────────────
export async function playerAnswer(answerIndex) {
  if (state.myAnswer !== null) return; // already answered
  if (state.phase !== 'answering') return;

  state.myAnswer = answerIndex;
  await submitAnswer(state.roomCode, state.currentQuestion, state.playerId, answerIndex);
}

// ─────────────────────────────────────────────────
//  PUBLIC: Player casts a vote for a new host
// ─────────────────────────────────────────────────
export async function voteForHost(targetPlayerId) {
  await castVote(state.roomCode, targetPlayerId, state.playerId);
}

// ─────────────────────────────────────────────────
//  PUBLIC: Leave the game
// ─────────────────────────────────────────────────
export async function leaveGame() {
  _cancelHostTimers();
  _unsubscribeAll();
  document.removeEventListener('visibilitychange', _handleVisibility);

  if (state.roomCode && state.playerId) {
    await leaveRoom(state.roomCode, state.playerId);
  }

  // Reset state
  Object.assign(state, {
    roomCode: null, playerId: null, playerName: null, isHost: false,
    room: null, players: {}, votes: {}, currentQuestion: -1,
    phase: 'idle', myAnswer: null, questionStartTime: 0, selectedQuestions: [],
  });
}

// ─────────────────────────────────────────────────
//  Page visibility — re-register presence on focus
// ─────────────────────────────────────────────────
function _handleVisibility() {
  if (!document.hidden && state.roomCode && state.playerId) {
    markConnected(state.roomCode, state.playerId).catch(console.error);
  }
}

// ─────────────────────────────────────────────────
//  Utility: get ordered players array by score
// ─────────────────────────────────────────────────
export function getLeaderboard() {
  return Object.entries(state.players)
    .map(([pid, p]) => ({ id: pid, ...p }))
    .sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────
//  Utility: get remaining timer seconds
// ─────────────────────────────────────────────────
export function getRemainingSeconds() {
  if (state.phase !== 'answering') return 0;
  const elapsed = (Date.now() - state.questionStartTime) / 1000;
  return Math.max(0, SETTINGS.ANSWER_TIME_SEC - elapsed);
}
