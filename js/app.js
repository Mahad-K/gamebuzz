// ====================================================
//  app.js — Main Entry Point
//  Wires together UI events ↔ Game logic ↔ Firebase
// ====================================================

import { SETTINGS } from './config.js';
import {
  state,
  initSession,
  hostStartGame,
  playerAnswer,
  voteForHost,
  leaveGame,
  on as gameOn,
} from './game.js';
import { createRoom, joinRoom } from './firebase.js';
import {
  renderHome,
  renderJoinScreen,
  renderHostSetup,
  renderLobby,
  renderQuestion,
  lockAnswer,
  updateLobbyPlayers,
  updateAnsweredDisplay,
  flashAnswerResult,
  renderReveal,
  renderLeaderboard,
  showScreen,
  toast,
  showBanner,
  setButtonLoading,
} from './ui.js';

// ─────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderHome();
  _bindHomeEvents();
  _bindJoinEvents();
  _bindHostSetupEvents();
  _bindLobbyEvents();
  _bindGameEvents();
  _bindLeaderboardEvents();
  _bindGameCallbacks();
  _bindBeforeUnload();
});

// ─────────────────────────────────────────────────
//  HOME SCREEN EVENTS
// ─────────────────────────────────────────────────
function _bindHomeEvents() {
  const btnHost = document.getElementById('btn-host');
  const btnJoin = document.getElementById('btn-join');

  btnHost?.addEventListener('click', () => {
    renderHostSetup();
  });

  btnJoin?.addEventListener('click', () => {
    renderJoinScreen();
  });
}

// ─────────────────────────────────────────────────
//  JOIN SCREEN EVENTS
// ─────────────────────────────────────────────────
function _bindJoinEvents() {
  const backBtn   = document.getElementById('btn-join-back');
  const joinBtn   = document.getElementById('btn-join-submit');
  const codeInput = document.getElementById('join-code');
  const nameInput = document.getElementById('join-name');

  backBtn?.addEventListener('click', renderHome);

  // Auto-format code input (uppercase, digits only, max 6)
  codeInput?.addEventListener('input', () => {
    let v = codeInput.value.replace(/\D/g, '').slice(0, 6);
    codeInput.value = v;
  });

  // Submit on Enter
  nameInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinBtn?.click();
  });
  codeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && codeInput.value.length === 6) nameInput?.focus();
  });

  joinBtn?.addEventListener('click', async () => {
    const code = codeInput?.value.trim();
    const name = nameInput?.value.trim();

    if (!code || code.length !== 6) {
      toast('Enter a valid 6-digit room code!', 'error'); return;
    }
    if (!name || name.length < 1) {
      toast('Enter your name!', 'error'); return;
    }
    if (name.length > 20) {
      toast('Name too long (max 20 characters)', 'error'); return;
    }

    setButtonLoading(joinBtn, true);
    try {
      const playerId = await joinRoom(code.toUpperCase(), name);
      initSession(code.toUpperCase(), playerId, name, false);
      renderLobby();
    } catch (err) {
      toast(err.message || 'Could not join room.', 'error');
      setButtonLoading(joinBtn, false, 'JOIN!');
    }
  });
}

// ─────────────────────────────────────────────────
//  HOST SETUP SCREEN EVENTS
// ─────────────────────────────────────────────────
function _bindHostSetupEvents() {
  const backBtn   = document.getElementById('btn-host-back');
  const createBtn = document.getElementById('btn-create-room');
  const nameInput = document.getElementById('host-name');

  backBtn?.addEventListener('click', renderHome);

  nameInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') createBtn?.click();
  });

  createBtn?.addEventListener('click', async () => {
    const name = nameInput?.value.trim();
    const slider = document.getElementById('host-q-slider');
    const questionCount = slider ? parseInt(slider.value, 10) : SETTINGS.DEFAULT_QUESTIONS;

    if (!name || name.length < 1) {
      toast('Enter your name!', 'error'); return;
    }
    if (name.length > 20) {
      toast('Name too long (max 20 characters)', 'error'); return;
    }

    setButtonLoading(createBtn, true);
    try {
      const { code, playerId } = await createRoom(name, questionCount);
      initSession(code, playerId, name, true);
      renderLobby();
    } catch (err) {
      toast(err.message || 'Could not create room.', 'error');
      setButtonLoading(createBtn, false, 'CREATE ROOM');
    }
  });
}

// ─────────────────────────────────────────────────
//  LOBBY SCREEN EVENTS
// ─────────────────────────────────────────────────
function _bindLobbyEvents() {
  // Start game button (host)
  const startBtn = document.getElementById('btn-start-game');
  startBtn?.addEventListener('click', async () => {
    const slider = document.getElementById('lobby-q-slider');
    const qCount = slider ? parseInt(slider.value, 10) : (state.room?.questionCount || SETTINGS.DEFAULT_QUESTIONS);

    const connected = Object.values(state.players).filter(p => p.connected).length;
    if (connected < SETTINGS.MIN_PLAYERS) {
      toast(`Need at least ${SETTINGS.MIN_PLAYERS} players to start!`, 'warning'); return;
    }

    setButtonLoading(startBtn, true);
    try {
      await hostStartGame(qCount);
    } catch (err) {
      toast(err.message || 'Could not start game.', 'error');
      setButtonLoading(startBtn, false, 'START GAME');
    }
  });

  // Lobby question count slider update
  const lobbySlider = document.getElementById('lobby-q-slider');
  const lobbyQCount = document.getElementById('lobby-q-count-display');
  lobbySlider?.addEventListener('input', () => {
    if (lobbyQCount) lobbyQCount.textContent = lobbySlider.value;
  });

  // Vote buttons (delegated from vote list container)
  const voteList = document.getElementById('vote-players-list');
  voteList?.addEventListener('click', async e => {
    const btn = e.target.closest('.vote-btn');
    if (!btn) return;
    const targetId = btn.dataset.pid;
    if (!targetId) return;

    // Toggle — if already voted for this player, do nothing extra (Firebase handles deduplication)
    await voteForHost(targetId);
    toast(`Voted to make ${state.players[targetId]?.name || 'player'} host!`, 'info');
  });
}

// ─────────────────────────────────────────────────
//  IN-GAME EVENTS (question screen)
// ─────────────────────────────────────────────────
function _bindGameEvents() {
  // Answer option clicks (delegated from options grid)
  const optionsGrid = document.getElementById('options-grid');
  optionsGrid?.addEventListener('click', async e => {
    const btn = e.target.closest('.option-btn');
    if (!btn || btn.disabled) return;
    if (state.myAnswer !== null) return; // already answered
    if (state.phase !== 'answering') return;

    const answerIndex = parseInt(btn.dataset.index, 10);
    lockAnswer(answerIndex);
    await playerAnswer(answerIndex);
  });
}

// ─────────────────────────────────────────────────
//  LEADERBOARD EVENTS
// ─────────────────────────────────────────────────
function _bindLeaderboardEvents() {
  // Play Again (host resets the room)
  const playAgainBtn = document.getElementById('btn-play-again');
  playAgainBtn?.addEventListener('click', async () => {
    // Simple: go back to host setup
    await leaveGame();
    renderHostSetup();
    toast('Start a new game!', 'success');
  });

  // Home button
  const homeBtn = document.getElementById('btn-lb-home');
  homeBtn?.addEventListener('click', async () => {
    await leaveGame();
    renderHome();
  });
}

// ─────────────────────────────────────────────────
//  GAME STATE CALLBACKS (from game.js events)
// ─────────────────────────────────────────────────
function _bindGameCallbacks() {

  // Room meta update (status, host, etc.)
  gameOn('onRoomUpdate', (roomData) => {
    if (!roomData) return;
    // Nothing extra needed — handled by onPlayersUpdate and onPhaseChange
  });

  // Player list changed
  gameOn('onPlayersUpdate', (players) => {
    if (_isOnScreen('lobby')) {
      updateLobbyPlayers(players, state.votes);
    }

    // If host changed and we ARE now host, notify
    if (state.isHost && _isOnScreen('lobby')) {
      const hostPanel  = document.getElementById('host-panel');
      const waitingMsg = document.getElementById('waiting-msg');
      if (hostPanel)  hostPanel.classList.remove('hidden');
      if (waitingMsg) waitingMsg.classList.add('hidden');
    }
  });

  // Vote changes
  gameOn('onVotesUpdate', (votes) => {
    if (_isOnScreen('lobby')) {
      updateLobbyPlayers(state.players, votes);
    }
  });

  // New question
  gameOn('onQuestionChange', (questionData) => {
    renderQuestion(questionData);
  });

  // Answers coming in during question phase
  gameOn('onAnswersUpdate', (answersObj) => {
    if (_isOnScreen('question')) {
      updateAnsweredDisplay(answersObj, state.players);
    }
  });

  // Phase change: 'reveal' object or 'reveal' string
  gameOn('onPhaseChange', (data) => {
    if (data === 'reveal' || data?.phase === 'reveal') {
      // Flash answers on question screen first (if still visible)
      if (_isOnScreen('question') && data.correctIndex !== undefined) {
        flashAnswerResult(state.myAnswer, data.correctIndex);
        // Small delay so players see the flash before switching to reveal
        setTimeout(() => renderReveal(data), 600);
      } else if (data.correctIndex !== undefined) {
        renderReveal(data);
      }
    }
  });

  // Game ended
  gameOn('onGameEnd', (data) => {
    if (data?.reason === 'room_deleted') {
      toast('The room was closed.', 'warning');
      leaveGame().then(renderHome);
      return;
    }
    renderLeaderboard();
  });
}

// ─────────────────────────────────────────────────
//  Beforeunload — mark disconnected gracefully
// ─────────────────────────────────────────────────
function _bindBeforeUnload() {
  window.addEventListener('beforeunload', () => {
    if (state.roomCode && state.playerId) {
      // Best-effort synchronous mark — Firebase onDisconnect handles the rest
      leaveGame();
    }
  });
}

// ─────────────────────────────────────────────────
//  Helper: check if a screen is currently active
// ─────────────────────────────────────────────────
function _isOnScreen(name) {
  const screenId = {
    home:        'screen-home',
    join:        'screen-join',
    hostSetup:   'screen-host-setup',
    lobby:       'screen-lobby',
    question:    'screen-question',
    reveal:      'screen-reveal',
    leaderboard: 'screen-leaderboard',
  }[name];

  if (!screenId) return false;
  return document.getElementById(screenId)?.classList.contains('active') ?? false;
}
