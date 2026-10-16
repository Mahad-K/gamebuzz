// ====================================================
//  ui.js — Screen Renderer & DOM Management
//  All DOM manipulation lives here. Pure presentation.
// ====================================================

import { SETTINGS } from './config.js';
import { state, getRemainingSeconds, getLeaderboard } from './game.js';

// ─────────────────────────────────────────────────
//  Screen registry
// ─────────────────────────────────────────────────
const SCREENS = {
  home:        document.getElementById('screen-home'),
  join:        document.getElementById('screen-join'),
  hostSetup:   document.getElementById('screen-host-setup'),
  lobby:       document.getElementById('screen-lobby'),
  question:    document.getElementById('screen-question'),
  reveal:      document.getElementById('screen-reveal'),
  leaderboard: document.getElementById('screen-leaderboard'),
};

let _currentScreen = null;
let _timerRAF = null;  // requestAnimationFrame id for timer

// ─────────────────────────────────────────────────
//  Show a screen
// ─────────────────────────────────────────────────
export function showScreen(name) {
  for (const [key, el] of Object.entries(SCREENS)) {
    if (el) el.classList.remove('active');
  }
  if (SCREENS[name]) {
    SCREENS[name].classList.add('active');
    _currentScreen = name;
  }
}

// ─────────────────────────────────────────────────
//  Toast notifications
// ─────────────────────────────────────────────────
const toastContainer = document.getElementById('toast-container');

export function toast(message, type = 'info', durationMs = 3000) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  toastContainer.appendChild(t);

  setTimeout(() => {
    t.classList.add('hiding');
    setTimeout(() => t.remove(), 300);
  }, durationMs);
}

// ─────────────────────────────────────────────────
//  Status banner (mid-game notification)
// ─────────────────────────────────────────────────
let _bannerTimeout = null;

export function showBanner(message, durationMs = 3500) {
  // Remove existing banner
  document.querySelectorAll('.status-banner').forEach(b => b.remove());
  if (_bannerTimeout) clearTimeout(_bannerTimeout);

  const banner = document.createElement('div');
  banner.className = 'status-banner';
  banner.textContent = message;
  document.body.appendChild(banner);

  _bannerTimeout = setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transition = 'opacity 0.5s';
    setTimeout(() => banner.remove(), 500);
  }, durationMs);
}

// ─────────────────────────────────────────────────
//  Confetti burst (winner celebration)
// ─────────────────────────────────────────────────
const CONFETTI_COLORS = ['#00f5ff', '#ffd32a', '#ff4757', '#2ed573', '#a855f7'];

export function triggerConfetti(count = 60) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.width  = (8 + Math.random() * 8) + 'px';
      piece.style.height = (8 + Math.random() * 8) + 'px';
      piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
      piece.style.animationDelay = '0s';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 4000);
    }, i * 30);
  }
}

// ─────────────────────────────────────────────────
//  HOME SCREEN
// ─────────────────────────────────────────────────
export function renderHome() {
  showScreen('home');
}

// ─────────────────────────────────────────────────
//  JOIN SCREEN
// ─────────────────────────────────────────────────
export function renderJoinScreen() {
  showScreen('join');
  const codeInput = document.getElementById('join-code');
  if (codeInput) codeInput.value = '';
  const nameInput = document.getElementById('join-name');
  if (nameInput) nameInput.value = '';
  if (codeInput) codeInput.focus();
}

// ─────────────────────────────────────────────────
//  HOST SETUP SCREEN
// ─────────────────────────────────────────────────
export function renderHostSetup() {
  showScreen('hostSetup');
  const nameInput = document.getElementById('host-name');
  if (nameInput) { nameInput.value = ''; nameInput.focus(); }

  const slider = document.getElementById('host-q-slider');
  const display = document.getElementById('host-q-count');
  if (slider && display) {
    slider.value = SETTINGS.DEFAULT_QUESTIONS;
    display.textContent = SETTINGS.DEFAULT_QUESTIONS;
    slider.addEventListener('input', () => {
      display.textContent = slider.value;
    });
  }
}

// ─────────────────────────────────────────────────
//  LOBBY / WAITING ROOM
// ─────────────────────────────────────────────────
export function renderLobby() {
  showScreen('lobby');

  // Room code
  const codeEl = document.getElementById('lobby-code');
  if (codeEl) codeEl.textContent = state.roomCode;

  // Show/hide host panel vs waiting message
  const hostPanel  = document.getElementById('host-panel');
  const waitingMsg = document.getElementById('waiting-msg');
  const voteSection = document.getElementById('vote-section');

  if (state.isHost) {
    if (hostPanel)  hostPanel.classList.remove('hidden');
    if (waitingMsg) waitingMsg.classList.add('hidden');
  } else {
    if (hostPanel)  hostPanel.classList.add('hidden');
    if (waitingMsg) waitingMsg.classList.remove('hidden');
  }

  // Always show vote section for non-hosts when there are 2+ players
  // (rendered dynamically in updateLobbyPlayers)
}

// ─────────────────────────────────────────────────
//  Update player list in lobby
// ─────────────────────────────────────────────────
export function updateLobbyPlayers(players, votes = {}) {
  const grid = document.getElementById('lobby-players-grid');
  if (!grid) return;

  const entries = Object.entries(players).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
  const connectedCount = entries.filter(([, p]) => p.connected).length;

  // Update start button state (host)
  const startBtn = document.getElementById('btn-start-game');
  if (startBtn) {
    if (connectedCount < SETTINGS.MIN_PLAYERS) {
      startBtn.classList.add('btn-disabled');
      startBtn.disabled = true;
    } else {
      startBtn.classList.remove('btn-disabled');
      startBtn.disabled = false;
    }
  }

  // Player count hint
  const countHint = document.getElementById('player-count-hint');
  if (countHint) {
    countHint.textContent = `${connectedCount} / ${SETTINGS.MAX_PLAYERS} players${connectedCount < SETTINGS.MIN_PLAYERS ? ` (need ${SETTINGS.MIN_PLAYERS})` : ' — ready!'}`;
  }

  // Render player chips
  grid.innerHTML = '';
  for (const [pid, player] of entries) {
    const chip = document.createElement('div');
    chip.className = 'player-chip entering';
    if (pid === state.room?.host) chip.classList.add('is-host');
    if (pid === state.playerId)   chip.classList.add('is-me');
    if (!player.connected)        chip.classList.add('disconnected');

    chip.innerHTML = `
      <div class="player-avatar">${player.avatar || '🎮'}</div>
      <span class="player-name">${escapeHtml(player.name)}</span>
      ${pid === state.room?.host ? '<span class="player-crown" title="Host">👑</span>' : ''}
    `;
    grid.appendChild(chip);
  }

  // Vote section — only show to non-hosts if ≥ 2 players
  const voteSection = document.getElementById('vote-section');
  const voteList    = document.getElementById('vote-players-list');
  const currentHost = state.room?.host;

  if (!state.isHost && connectedCount >= 2 && voteSection && voteList) {
    voteSection.classList.remove('hidden');

    // Eligible vote targets: connected players who are not the current host and not yourself
    const targets = entries.filter(
      ([pid, p]) => p.connected && pid !== currentHost && pid !== state.playerId
    );

    // Count votes per target
    const voteCounts = {};
    for (const [tid, voters] of Object.entries(votes)) {
      voteCounts[tid] = Object.keys(voters || {}).length;
    }

    const myVotedFor = Object.entries(votes).find(
      ([, voters]) => voters && voters[state.playerId]
    )?.[0];

    voteList.innerHTML = '';
    if (targets.length === 0) {
      voteList.innerHTML = '<span class="text-muted" style="font-size:0.85rem">No other players to vote for yet.</span>';
    } else {
      for (const [pid, player] of targets) {
        const btn = document.createElement('button');
        btn.className = 'vote-btn' + (myVotedFor === pid ? ' voted' : '');
        btn.dataset.pid = pid;
        const vc = voteCounts[pid] || 0;
        btn.innerHTML = `
          ${escapeHtml(player.name)}
          ${vc > 0 ? `<span class="vote-count-badge">${vc}</span>` : ''}
        `;
        voteList.appendChild(btn);
      }
    }
  } else if (voteSection) {
    voteSection.classList.add('hidden');
  }
}

// ─────────────────────────────────────────────────
//  QUESTION SCREEN
// ─────────────────────────────────────────────────
export function renderQuestion(questionData) {
  showScreen('question');
  stopTimer();

  const { questionIndex, question, total, startTime } = questionData;

  // Progress
  const progressEl = document.getElementById('q-progress');
  if (progressEl) progressEl.textContent = `Q ${questionIndex + 1} / ${total}`;

  // Category
  const catEl = document.getElementById('q-category');
  if (catEl) catEl.textContent = question.c || '';

  // Question text
  const textEl = document.getElementById('question-text');
  if (textEl) textEl.textContent = question.q;

  // Answer options
  const grid = document.getElementById('options-grid');
  if (!grid) return;

  const optionClasses = ['opt-a', 'opt-b', 'opt-c', 'opt-d'];
  const optionLabels  = ['A', 'B', 'C', 'D'];

  grid.innerHTML = '';
  question.o.forEach((optText, i) => {
    const btn = document.createElement('button');
    btn.className = `option-btn ${optionClasses[i]}`;
    btn.dataset.index = i;
    btn.innerHTML = `
      <span class="option-label">${optionLabels[i]}</span>
      <span class="option-text">${escapeHtml(optText)}</span>
    `;
    grid.appendChild(btn);
  });

  // Status
  const statusEl = document.getElementById('answer-status');
  if (statusEl) { statusEl.textContent = 'Choose your answer!'; statusEl.className = 'answer-status'; }

  // Answered counter
  const countEl = document.getElementById('answered-count');
  if (countEl) countEl.textContent = '';

  // Start countdown timer UI
  startTimer(startTime);
}

// ─────────────────────────────────────────────────
//  Lock in player's answer (visual feedback)
// ─────────────────────────────────────────────────
export function lockAnswer(answerIndex) {
  const grid = document.getElementById('options-grid');
  if (!grid) return;

  grid.querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === answerIndex) btn.classList.add('selected');
    else btn.style.opacity = '0.55';
  });

  const statusEl = document.getElementById('answer-status');
  if (statusEl) {
    statusEl.textContent = '✓ Answer locked in!';
    statusEl.className = 'answer-status answered';
  }
}

// ─────────────────────────────────────────────────
//  Update answered count during question
// ─────────────────────────────────────────────────
export function updateAnsweredCount(answered, total) {
  const el = document.getElementById('answered-count');
  if (el) el.textContent = `${answered} / ${total} answered`;
}

// ─────────────────────────────────────────────────
//  Countdown timer
// ─────────────────────────────────────────────────
export function startTimer(questionStartTime) {
  stopTimer();

  const barEl    = document.getElementById('timer-bar-fill');
  const numberEl = document.getElementById('timer-number');
  const totalSec = SETTINGS.ANSWER_TIME_SEC;

  function tick() {
    const elapsed  = (Date.now() - questionStartTime) / 1000;
    const remaining = Math.max(0, totalSec - elapsed);
    const pct = (remaining / totalSec) * 100;

    if (barEl) {
      barEl.style.width = pct + '%';
      barEl.className = 'timer-bar-fill';
      if (remaining <= 5)  barEl.classList.add('critical');
      else if (remaining <= 10) barEl.classList.add('warning');
    }

    if (numberEl) {
      numberEl.textContent = Math.ceil(remaining) + 's';
      numberEl.className = 'timer-number';
      if (remaining <= 5)  numberEl.classList.add('critical');
      else if (remaining <= 10) numberEl.classList.add('warning');
    }

    if (remaining > 0) {
      _timerRAF = requestAnimationFrame(tick);
    }
  }

  _timerRAF = requestAnimationFrame(tick);
}

export function stopTimer() {
  if (_timerRAF) { cancelAnimationFrame(_timerRAF); _timerRAF = null; }
}

// ─────────────────────────────────────────────────
//  REVEAL SCREEN
// ─────────────────────────────────────────────────
export function renderReveal(revealData) {
  showScreen('reveal');
  stopTimer();

  const { correctIndex, correctText, myAnswer, myDelta, firstCorrectPlayer, deltas } = revealData;

  // Reveal correct answer on options grid (still visible in DOM if same session)
  // Actually, reveal screen is separate, so just show info card:
  const answerEl = document.getElementById('reveal-answer-text');
  if (answerEl) answerEl.textContent = correctText;

  const pointsEl = document.getElementById('reveal-points');
  if (pointsEl) {
    pointsEl.textContent = myDelta > 0 ? `+${myDelta}` : '0';
    pointsEl.style.color = myDelta > 0 ? 'var(--gold)' : 'var(--text-dim)';
  }

  const ptLabelEl = document.getElementById('reveal-points-label');
  if (ptLabelEl) {
    if (myAnswer === null) ptLabelEl.textContent = 'No answer — 0 pts';
    else if (myDelta === 0) ptLabelEl.textContent = 'Wrong answer — 0 pts';
    else if (myDelta === SETTINGS.POINTS_CORRECT + SETTINGS.POINTS_FIRST_BONUS)
      ptLabelEl.textContent = `Correct (+${SETTINGS.POINTS_CORRECT}) + First Bonus (+${SETTINGS.POINTS_FIRST_BONUS})!`;
    else ptLabelEl.textContent = `Correct! +${SETTINGS.POINTS_CORRECT} pts`;
  }

  // First correct badge
  const firstEl = document.getElementById('reveal-first-badge');
  if (firstEl) {
    if (firstCorrectPlayer === state.playerId) {
      firstEl.textContent = '⚡ First Correct!';
      firstEl.classList.remove('hidden');
    } else if (firstCorrectPlayer && state.players[firstCorrectPlayer]) {
      firstEl.textContent = `⚡ ${escapeHtml(state.players[firstCorrectPlayer].name)} was first!`;
      firstEl.classList.remove('hidden');
    } else {
      firstEl.classList.add('hidden');
    }
  }

  // Mini leaderboard
  const scoresList = document.getElementById('reveal-scores-list');
  if (scoresList) {
    const lb = getLeaderboard();
    scoresList.innerHTML = lb.map((p, i) => {
      const delta = deltas?.[p.id] || 0;
      return `
        <div class="reveal-score-row" style="animation-delay:${i * 0.05}s">
          <span class="rsr-rank">#${i + 1}</span>
          <span class="rsr-name">${p.avatar || '🎮'} ${escapeHtml(p.name)}${p.id === state.playerId ? ' (you)' : ''}</span>
          <span class="rsr-delta">${delta > 0 ? '+' + delta : ''}</span>
          <span class="rsr-score">${p.score}</span>
        </div>
      `;
    }).join('');
  }

  // Next question countdown
  _revealCountdown(SETTINGS.REVEAL_TIME_SEC);
}

let _revealCountdownInterval = null;

function _revealCountdown(sec) {
  if (_revealCountdownInterval) clearInterval(_revealCountdownInterval);
  const el = document.getElementById('reveal-countdown');
  let remaining = sec;
  if (el) el.textContent = remaining;
  _revealCountdownInterval = setInterval(() => {
    remaining--;
    if (el) el.textContent = Math.max(0, remaining);
    if (remaining <= 0) {
      clearInterval(_revealCountdownInterval);
      _revealCountdownInterval = null;
    }
  }, 1000);
}

// ─────────────────────────────────────────────────
//  LEADERBOARD SCREEN
// ─────────────────────────────────────────────────
export function renderLeaderboard() {
  showScreen('leaderboard');
  stopTimer();
  if (_revealCountdownInterval) { clearInterval(_revealCountdownInterval); _revealCountdownInterval = null; }

  const lb = getLeaderboard();
  const listEl = document.getElementById('lb-list');

  if (!listEl) return;

  const rankIcons = ['🥇', '🥈', '🥉'];

  listEl.innerHTML = lb.map((p, i) => {
    const isMe = p.id === state.playerId;
    const rankDisplay = i < 3
      ? `<span class="lb-rank lb-rank-${i + 1}">${rankIcons[i]}</span>`
      : `<span class="lb-rank lb-rank-n">#${i + 1}</span>`;

    return `
      <div class="lb-entry${isMe ? ' is-me' : ''}" style="animation-delay:${0.1 + i * 0.1}s">
        ${rankDisplay}
        <div class="lb-avatar">${p.avatar || '🎮'}</div>
        <span class="lb-name">${escapeHtml(p.name)}${isMe ? ' <span style="font-size:0.75rem;color:var(--primary)">(you)</span>' : ''}</span>
        <div style="text-align:right">
          <div class="lb-score">${p.score}</div>
          <div class="lb-score-pts">pts</div>
        </div>
      </div>
    `;
  }).join('');

  // Show/hide host "Play Again" button
  const playAgainBtn = document.getElementById('btn-play-again');
  if (playAgainBtn) {
    if (state.isHost) playAgainBtn.classList.remove('hidden');
    else              playAgainBtn.classList.add('hidden');
  }

  // Trigger confetti for top 3
  if (lb[0]?.id === state.playerId) {
    triggerConfetti(80);
  } else if (lb.indexOf(lb.find(p => p.id === state.playerId)) < 3) {
    triggerConfetti(30);
  }
}

// ─────────────────────────────────────────────────
//  Update question screen during a running game
//  (called when answers come in from other players)
// ─────────────────────────────────────────────────
export function updateAnsweredDisplay(answersObj, players) {
  const connected = Object.values(players).filter(p => p.connected).length;
  const answered  = Object.keys(answersObj).length;
  updateAnsweredCount(answered, connected);
}

// ─────────────────────────────────────────────────
//  Show answer result overlay on question screen
//  (right after time runs out, before reveal screen)
// ─────────────────────────────────────────────────
export function flashAnswerResult(myAnswer, correctIndex) {
  const grid = document.getElementById('options-grid');
  if (!grid) return;

  grid.querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === correctIndex) {
      btn.classList.add('correct');
    } else if (i === myAnswer && myAnswer !== correctIndex) {
      btn.classList.add('wrong', 'selected');
    } else {
      btn.classList.add('wrong');
    }
  });
}

// ─────────────────────────────────────────────────
//  Escape HTML helper
// ─────────────────────────────────────────────────
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─────────────────────────────────────────────────
//  Set button loading state
// ─────────────────────────────────────────────────
export function setButtonLoading(btnEl, loading, originalText) {
  if (!btnEl) return;
  if (loading) {
    btnEl.dataset.origText = btnEl.textContent;
    btnEl.innerHTML = '<span class="spinner"></span>';
    btnEl.disabled = true;
  } else {
    btnEl.textContent = originalText || btnEl.dataset.origText || btnEl.textContent;
    btnEl.disabled = false;
  }
}
