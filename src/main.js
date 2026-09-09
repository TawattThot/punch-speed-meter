import './style.css';
import { PunchEstimator, msToMph } from './physics.js';
import {
  loadHistory,
  addResult,
  clearHistory,
  loadHighScore,
  considerHighScore,
  clearHighScore,
} from './storage.js';
import { DONATE_URL, APP_VERSION } from './config.js';

const app = document.getElementById('app');
const estimator = new PunchEstimator();

const DEFAULT_PARTY_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'];

const state = {
  // permission | modes | highscores | arm | punch | results
  // party-setup | party-pass | party-arm | party-punch | party-result | party-final
  screen: 'permission',
  mode: null, // 'solo' | 'party'
  sensorOk: false,
  sensorMsg: 'Sensors not enabled yet',
  permissionDenied: false,
  awaitingPermission: false,
  needsIOSPermission:
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function',
  secure: window.isSecureContext,
  hasMotionAPI: typeof window.DeviceMotionEvent !== 'undefined',
  liveAccelG: 0,
  liveSpeedMph: 0,
  lastResult: null,
  history: loadHistory(),
  highScore: loadHighScore(),
  beatHighScore: false,
  listening: false,
  party: null,
};

let motionHandler = null;

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

function timeAgo(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isPhoneCapable() {
  return state.secure && state.hasMotionAPI;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isPartyScreen(screen = state.screen) {
  return String(screen).startsWith('party-');
}

function currentPartyPlayer() {
  if (!state.party) return null;
  return state.party.players[state.party.currentIndex] ?? null;
}

function partyStandingRows() {
  if (!state.party) return [];
  return state.party.players
    .map((p, i) => ({ ...p, index: i }))
    .sort((a, b) => {
      const am = a.score?.peakSpeedMph ?? -1;
      const bm = b.score?.peakSpeedMph ?? -1;
      if (bm !== am) return bm - am;
      const ap = a.score?.power ?? -1;
      const bp = b.score?.power ?? -1;
      return bp - ap;
    });
}

function partyWinner() {
  const rows = partyStandingRows();
  return rows.find((r) => r.score) ?? null;
}

function createParty(names) {
  const cleaned = names
    .map((n) => String(n).trim())
    .filter(Boolean)
    .slice(0, 6);
  while (cleaned.length < 2) cleaned.push(`Player ${cleaned.length + 1}`);
  return {
    players: cleaned.map((name) => ({ name, score: null })),
    currentIndex: 0,
  };
}

function phaseCopy() {
  switch (state.screen) {
    case 'permission':
      return {
        label: 'Get Ready',
        hint: 'Enable motion sensors, then pick Solo or Party Mode.',
        big: '0.0',
        unit: 'MPH PEAK',
      };
    case 'modes':
      return {
        label: 'Choose Mode',
        hint: 'Solo for personal bests. Party for pass-the-phone rounds (one punch each).',
        big: 'GO',
        unit: 'PICK A MODE',
      };
    case 'highscores':
      return {
        label: 'High Score',
        hint: 'Your best punch on this device.',
        big: state.highScore ? fmt(state.highScore.peakSpeedMph, 1) : '—',
        unit: state.highScore ? 'MPH BEST' : 'NO SCORE YET',
      };
    case 'arm':
    case 'party-arm':
      return {
        label: 'Arm',
        hint: state.mode === 'party'
          ? `${currentPartyPlayer()?.name ?? 'Player'}: hold the phone tight, tap Arm, then one controlled punch.`
          : 'Hold the phone tight in your fist. Tap Arm, then throw a controlled punch.',
        big: 'READY',
        unit: 'WAIT FOR ARM',
      };
    case 'punch':
    case 'party-punch':
      return {
        label: estimator.phase === 'punching' ? 'Punching' : 'Armed — Punch!',
        hint:
          estimator.phase === 'punching'
            ? 'Measuring… finish through the strike.'
            : 'Punch now. Keep a firm grip — do not throw your phone.',
        big: fmt(state.liveSpeedMph, 1),
        unit: 'MPH LIVE',
      };
    case 'results':
      return {
        label: state.beatHighScore ? 'New High Score!' : 'Results',
        hint: state.beatHighScore
          ? 'You topped your best punch. Reset to chase again.'
          : 'Nice hit. Reset to go again.',
        big: fmt(state.lastResult?.peakSpeedMph, 1),
        unit: 'MPH PEAK',
      };
    case 'party-setup':
      return {
        label: 'Party Setup',
        hint: '2–6 players. Edit names, then start — one armed punch each.',
        big: String(state.party?.players.length ?? 2),
        unit: 'PLAYERS',
      };
    case 'party-pass': {
      const p = currentPartyPlayer();
      return {
        label: 'Pass the phone',
        hint: 'Hand the phone to the next player. When ready, tap Continue.',
        big: p?.name ?? '—',
        unit: `PLAYER ${(state.party?.currentIndex ?? 0) + 1} OF ${state.party?.players.length ?? 0}`,
      };
    }
    case 'party-result': {
      const p = currentPartyPlayer();
      return {
        label: p?.name ?? 'Result',
        hint: 'Score locked. Check the running board, then continue.',
        big: fmt(p?.score?.peakSpeedMph ?? state.lastResult?.peakSpeedMph, 1),
        unit: 'MPH PEAK',
      };
    }
    case 'party-final': {
      const w = partyWinner();
      return {
        label: 'Winner',
        hint: w ? `${w.name} takes the crown.` : 'Round complete.',
        big: w ? w.name : '—',
        unit: w?.score ? `${fmt(w.score.peakSpeedMph, 1)} MPH` : 'PARTY OVER',
      };
    }
    default:
      return { label: '', hint: '', big: '—', unit: '' };
  }
}

function statusPill() {
  if (!state.secure) {
    return `<div class="status-pill bad">Needs HTTPS</div>`;
  }
  if (!state.hasMotionAPI) {
    return `<div class="status-pill bad">Open on your phone</div>`;
  }
  if (state.sensorOk) {
    return `<div class="status-pill">Sensors active</div>`;
  }
  return `<div class="status-pill warn">${escapeHtml(state.sensorMsg)}</div>`;
}

function phoneOnlyBanner() {
  if (isPhoneCapable()) return '';
  const reason = !state.secure
    ? 'This page must be opened over HTTPS on a phone.'
    : 'Motion sensors are not available in this browser.';
  return `
    <section class="card phone-only" role="alert">
      <div class="icon" aria-hidden="true">📱</div>
      <div>
        <h2>Phone only</h2>
        <p>${escapeHtml(reason)} Open this link on your phone (Safari or Chrome), tap <strong>Allow Motion Access</strong>, then arm and punch.</p>
      </div>
    </section>
  `;
}

function renderHighScorePanel(compact = false) {
  const hs = state.highScore;
  if (!hs) {
    return `
      <section class="card high-score-panel">
        <h2><span>🏆 High Score</span></h2>
        <div class="empty">No high score yet — land a punch to set the chase.</div>
      </section>
    `;
  }
  return `
    <section class="card high-score-panel">
      <h2>
        <span>🏆 High Score</span>
        ${compact ? '' : `<span class="hs-meta">${escapeHtml(timeAgo(hs.at))}</span>`}
      </h2>
      <div class="hs-row">
        <div class="hs-main">${fmt(hs.peakSpeedMph, 1)} <span>mph</span></div>
        <div class="hs-power">${fmt(hs.power, 1)}/10</div>
      </div>
      ${
        compact
          ? ''
          : `<div class="hs-sub">${fmt(hs.peakSpeedKmh, 1)} km/h · ${fmt(hs.peakAccelG, 1)} g · ${escapeHtml(timeAgo(hs.at))}</div>`
      }
    </section>
  `;
}

function renderBeatBanner() {
  if (!state.beatHighScore || (state.screen !== 'results' && state.screen !== 'party-result')) {
    return '';
  }
  return `<div class="beat-banner" role="status">🔥 NEW HIGH SCORE — you beat it!</div>`;
}

function renderHistory() {
  if (!state.history.length) {
    return `<div class="empty">No punches yet — your session history will show up here.</div>`;
  }
  return `<ul class="history-list">${state.history
    .map(
      (h) => `<li>
        <div class="mph">${fmt(h.peakSpeedMph, 1)} mph <span style="color:var(--muted);font-weight:600">/ ${fmt(h.peakSpeedKmh, 1)} km/h</span></div>
        <div><strong>${fmt(h.power, 1)}</strong>/10</div>
        <div class="meta">${fmt(h.peakAccelG, 1)} g · ${escapeHtml(timeAgo(h.at))}</div>
      </li>`
    )
    .join('')}</ul>`;
}

function renderPermissionCoach() {
  if (state.screen !== 'permission' || state.permissionDenied) return '';
  return `
    <section class="card coach" role="status">
      <div class="icon" aria-hidden="true">📡</div>
      <div>
        <h2>Allow motion sensors</h2>
        <p>After you tap the button, your phone will show a system dialog — tap <strong>Allow</strong> so we can measure punch speed.</p>
      </div>
    </section>
  `;
}

function renderPermissionRecovery() {
  if (state.screen !== 'permission' || !state.permissionDenied) return '';
  return `
    <section class="card recovery" role="alert">
      <div class="icon" aria-hidden="true">🔒</div>
      <div>
        <h2>Permission denied</h2>
        <p>Motion access was blocked. Fix it with the steps below, then tap <strong>Try Allow Again</strong>.</p>
        <div class="recovery-steps">
          <h3>iPhone (Safari)</h3>
          <ul>
            <li>Settings → Safari → scroll to <strong>Motion &amp; Orientation Access</strong> (turn ON)</li>
            <li>Or clear website data for this site / reopen the link and tap <strong>Allow</strong> when asked</li>
            <li>Also try Settings → Safari → Advanced → Website Data → remove the trycloudflare site, reload, tap Allow</li>
          </ul>
          <h3>Android Chrome</h3>
          <ul>
            <li>If a site settings gear appeared, allow <strong>Motion sensors</strong></li>
            <li>Or Site settings → Permissions → Motion sensors → Allow</li>
            <li>Reload and try again</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function renderModePicker() {
  if (state.screen !== 'modes') return '';
  return `
    <section class="card mode-picker">
      <h2>Modes</h2>
      <div class="mode-grid">
        <button id="btn-mode-solo" type="button" class="mode-card">
          <span class="mode-emoji" aria-hidden="true">🥊</span>
          <span class="mode-title">Solo</span>
          <span class="mode-desc">Arm, punch, chase your high score</span>
        </button>
        <button id="btn-mode-party" type="button" class="mode-card">
          <span class="mode-emoji" aria-hidden="true">🎉</span>
          <span class="mode-title">Party</span>
          <span class="mode-desc">2–6 players · one punch each · crown a winner</span>
        </button>
        <button id="btn-mode-highscores" type="button" class="mode-card mode-card-wide">
          <span class="mode-emoji" aria-hidden="true">🏆</span>
          <span class="mode-title">High Scores</span>
          <span class="mode-desc">View your best punch on this phone</span>
        </button>
      </div>
    </section>
  `;
}

function renderPartySetup() {
  if (state.screen !== 'party-setup' || !state.party) return '';
  const count = state.party.players.length;
  const nameInputs = state.party.players
    .map(
      (p, i) => `
      <label class="party-name-row">
        <span>P${i + 1}</span>
        <input type="text" data-party-name="${i}" maxlength="16" value="${escapeHtml(p.name)}" autocomplete="off" />
      </label>`
    )
    .join('');
  return `
    <section class="card party-setup">
      <h2>Players</h2>
      <div class="party-count">
        <button id="btn-party-dec" class="secondary" type="button" ${count <= 2 ? 'disabled' : ''}>−</button>
        <div class="party-count-val">${count}</div>
        <button id="btn-party-inc" class="secondary" type="button" ${count >= 6 ? 'disabled' : ''}>+</button>
      </div>
      <div class="party-names">${nameInputs}</div>
      <p class="party-note">One armed punch per player — no windmill spam. Pass the phone between turns.</p>
    </section>
  `;
}

function renderPartyBoard(highlightIndex = null) {
  if (!state.party) return '';
  const rows = state.party.players
    .map((p, i) => {
      const scored = p.score != null;
      const active = i === highlightIndex;
      return `<li class="${active ? 'active' : ''} ${scored ? 'scored' : ''}">
        <span class="pb-name">${escapeHtml(p.name)}</span>
        <span class="pb-score">${scored ? `${fmt(p.score.peakSpeedMph, 1)} mph` : '—'}</span>
        <span class="pb-power">${scored ? `${fmt(p.score.power, 1)}/10` : ''}</span>
      </li>`;
    })
    .join('');
  return `
    <section class="card party-board">
      <h2>Running scores</h2>
      <ul class="party-board-list">${rows}</ul>
    </section>
  `;
}

function renderPartyFinalBoard() {
  if (state.screen !== 'party-final' || !state.party) return '';
  const ranked = partyStandingRows();
  const rows = ranked
    .map((p, rank) => {
      const crown = rank === 0 && p.score ? '👑 ' : '';
      return `<li class="${rank === 0 ? 'winner' : ''}">
        <span class="pb-rank">#${rank + 1}</span>
        <span class="pb-name">${crown}${escapeHtml(p.name)}</span>
        <span class="pb-score">${p.score ? `${fmt(p.score.peakSpeedMph, 1)} mph` : '—'}</span>
        <span class="pb-power">${p.score ? `${fmt(p.score.power, 1)}/10` : ''}</span>
      </li>`;
    })
    .join('');
  return `
    <section class="card party-board party-final-board">
      <h2>Final standings</h2>
      <ul class="party-board-list">${rows}</ul>
    </section>
  `;
}

function renderActions() {
  if (state.screen === 'permission') {
    const disabled = !isPhoneCapable() || state.awaitingPermission ? ' disabled' : '';
    const label = state.permissionDenied ? 'Try Allow Again' : 'Allow Motion Access';
    return `<button id="btn-enable" type="button"${disabled}>${label}</button>`;
  }
  if (state.screen === 'modes') {
    return '';
  }
  if (state.screen === 'highscores') {
    return `
      <button id="btn-back-modes" type="button">Back to modes</button>
      <button id="btn-clear-highscore" class="ghost" type="button">Clear high score</button>
    `;
  }
  if (state.screen === 'party-setup') {
    return `
      <button id="btn-party-start" type="button">Start Party</button>
      <button id="btn-back-modes" class="secondary" type="button">Back</button>
    `;
  }
  if (state.screen === 'party-pass') {
    return `
      <button id="btn-party-ready" type="button">I'm ready — Continue</button>
      <button id="btn-party-quit" class="ghost" type="button">Quit party</button>
    `;
  }
  if (state.screen === 'arm' || state.screen === 'party-arm') {
    return `
      <button id="btn-arm" type="button">Arm</button>
      ${
        state.screen === 'party-arm'
          ? `<button id="btn-party-quit" class="ghost" type="button">Quit party</button>`
          : `<button id="btn-back-modes" class="ghost" type="button">Modes</button>`
      }
    `;
  }
  if (state.screen === 'punch' || state.screen === 'party-punch') {
    return `<button id="btn-cancel" class="secondary" type="button">Cancel</button>`;
  }
  if (state.screen === 'results') {
    return `
      <button id="btn-reset" type="button">Reset</button>
      <button id="btn-arm-again" class="secondary" type="button">Arm again</button>
      <button id="btn-back-modes" class="ghost" type="button">Modes</button>
    `;
  }
  if (state.screen === 'party-result') {
    const last = state.party && state.party.currentIndex >= state.party.players.length - 1;
    return `
      <button id="btn-party-next" type="button">${last ? 'See winner' : 'Next player'}</button>
    `;
  }
  if (state.screen === 'party-final') {
    return `
      <button id="btn-party-again" type="button">Play again</button>
      <button id="btn-back-modes" class="secondary" type="button">Back to modes</button>
    `;
  }
  return '';
}

function renderStageExtras() {
  const result = state.lastResult;
  if ((state.screen === 'results' || state.screen === 'party-result') && result) {
    return `<div class="substats">
      <div class="stat"><div class="label">km/h</div><div class="value">${fmt(result.peakSpeedKmh, 1)}</div></div>
      <div class="stat"><div class="label">Peak accel</div><div class="value">${fmt(result.peakAccelG, 1)} g</div></div>
      <div class="stat"><div class="label">Power</div><div class="value">${fmt(result.power, 1)} / 10</div></div>
      <div class="stat"><div class="label">Duration</div><div class="value">${Math.round(result.durationMs)} ms</div></div>
    </div>`;
  }
  if (state.screen === 'punch' || state.screen === 'party-punch') {
    return `<div class="substats">
      <div class="stat"><div class="label">Accel</div><div class="value">${fmt(state.liveAccelG, 1)} g</div></div>
      <div class="stat"><div class="label">Phase</div><div class="value">${escapeHtml(estimator.phase)}</div></div>
    </div>`;
  }
  if (state.screen === 'highscores' && state.highScore) {
    const hs = state.highScore;
    return `<div class="substats">
      <div class="stat"><div class="label">km/h</div><div class="value">${fmt(hs.peakSpeedKmh, 1)}</div></div>
      <div class="stat"><div class="label">Peak accel</div><div class="value">${fmt(hs.peakAccelG, 1)} g</div></div>
      <div class="stat"><div class="label">Power</div><div class="value">${fmt(hs.power, 1)} / 10</div></div>
      <div class="stat"><div class="label">When</div><div class="value" style="font-size:0.95rem">${escapeHtml(timeAgo(hs.at))}</div></div>
    </div>`;
  }
  if (state.screen === 'party-final') {
    const w = partyWinner();
    if (!w?.score) return '';
    return `<div class="substats">
      <div class="stat"><div class="label">Winner mph</div><div class="value">${fmt(w.score.peakSpeedMph, 1)}</div></div>
      <div class="stat"><div class="label">Power</div><div class="value">${fmt(w.score.power, 1)} / 10</div></div>
    </div>`;
  }
  return '';
}

function showSafety() {
  return !['modes', 'highscores', 'party-setup', 'party-pass', 'party-final'].includes(
    state.screen
  );
}

function showHistory() {
  return state.mode === 'solo' && ['arm', 'punch', 'results'].includes(state.screen);
}

function render() {
  const copy = phaseCopy();
  const meterPct = Math.min(100, (state.liveAccelG / 8) * 100);
  const stageClass = [
    'stage card',
    state.screen === 'results' || state.screen === 'party-result' ? 'result-flash' : '',
    state.beatHighScore && (state.screen === 'results' || state.screen === 'party-result')
      ? 'beat-flash'
      : '',
    state.screen === 'party-pass' ? 'pass-stage' : '',
    state.screen === 'party-final' ? 'final-stage' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const pulse =
    (state.screen === 'punch' || state.screen === 'party-punch') &&
    estimator.phase === 'armed'
      ? ' pulse'
      : '';

  app.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <h1>Punch Speed Meter</h1>
        <span>Phone-in-fist peak speed</span>
      </div>
      <div class="badge">v${APP_VERSION}</div>
    </header>

    ${
      showSafety()
        ? `<section class="card safety">
      <div class="icon" aria-hidden="true">⚠️</div>
      <div>
        <h2>Safety</h2>
        <ul>
          <li>Hold the phone firmly — never throw it.</li>
          <li>Clear space; don’t punch toward people or hard objects.</li>
          <li>Use a case; stop if the grip feels loose.</li>
        </ul>
      </div>
    </section>`
        : ''
    }

    ${phoneOnlyBanner()}
    ${statusPill()}
    ${renderPermissionCoach()}
    ${renderPermissionRecovery()}
    ${state.screen === 'permission' || state.screen === 'modes' ? renderHighScorePanel(true) : ''}
    ${renderModePicker()}
    ${renderPartySetup()}

    ${
      state.screen !== 'modes' && state.screen !== 'party-setup'
        ? `<section class="${stageClass}">
      <div class="phase-label${pulse}">${escapeHtml(copy.label)}</div>
      <div class="big-number">${escapeHtml(copy.big)}<span class="unit">${escapeHtml(copy.unit)}</span></div>
      ${
        state.screen === 'party-pass'
          ? `<p class="pass-callout">Next player</p>`
          : `<div class="meter" aria-hidden="true"><span style="width:${meterPct}%"></span></div>`
      }
      <p class="hint">${escapeHtml(copy.hint)}</p>
      ${renderBeatBanner()}
      ${renderStageExtras()}
    </section>`
        : ''
    }

    ${
      state.screen === 'party-result' || state.screen === 'party-pass'
        ? renderPartyBoard(state.party?.currentIndex ?? null)
        : ''
    }
    ${renderPartyFinalBoard()}

    <div class="actions">${renderActions()}</div>

    ${
      showHistory()
        ? `<section class="card history">
      <h2>
        <span>Session history</span>
        <button id="btn-clear" class="ghost" type="button" style="padding:6px 10px;width:auto">Clear</button>
      </h2>
      ${renderHistory()}
    </section>`
        : ''
    }

    ${state.screen === 'results' ? renderHighScorePanel(false) : ''}

    <div class="donate-row">
      <button id="btn-donate" class="ghost donate" type="button">Donate</button>
      <span class="donate-hint">Optional — supports development (opens browser)</span>
    </div>

    <p class="footer-note">
      Estimates use high-pass / gravity-removed acceleration and short-window integration.
      Recreational accuracy only. Motion stays on-device. Open on your phone.
    </p>
  `;

  bind();
}

function readPartyNamesFromDom() {
  if (!state.party) return;
  state.party.players.forEach((p, i) => {
    const input = document.querySelector(`input[data-party-name="${i}"]`);
    if (input) {
      const v = input.value.trim();
      p.name = v || DEFAULT_PARTY_NAMES[i] || `Player ${i + 1}`;
    }
  });
}

function bind() {
  document.getElementById('btn-enable')?.addEventListener('click', onEnableSensors);
  document.getElementById('btn-arm')?.addEventListener('click', onArm);
  document.getElementById('btn-cancel')?.addEventListener('click', onCancel);
  document.getElementById('btn-reset')?.addEventListener('click', onReset);
  document.getElementById('btn-arm-again')?.addEventListener('click', onArm);
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    state.history = clearHistory();
    render();
  });
  document.getElementById('btn-donate')?.addEventListener('click', onDonate);

  document.getElementById('btn-mode-solo')?.addEventListener('click', () => {
    state.mode = 'solo';
    state.party = null;
    state.beatHighScore = false;
    state.lastResult = null;
    state.screen = 'arm';
    render();
  });
  document.getElementById('btn-mode-party')?.addEventListener('click', () => {
    state.mode = 'party';
    state.party = createParty(DEFAULT_PARTY_NAMES.slice(0, 2));
    state.beatHighScore = false;
    state.lastResult = null;
    state.screen = 'party-setup';
    render();
  });
  document.getElementById('btn-mode-highscores')?.addEventListener('click', () => {
    state.highScore = loadHighScore();
    state.screen = 'highscores';
    render();
  });
  document.getElementById('btn-back-modes')?.addEventListener('click', () => {
    estimator.resetSessionState();
    state.mode = null;
    state.party = null;
    state.lastResult = null;
    state.beatHighScore = false;
    state.liveAccelG = 0;
    state.liveSpeedMph = 0;
    state.screen = state.sensorOk ? 'modes' : 'permission';
    render();
  });
  document.getElementById('btn-clear-highscore')?.addEventListener('click', () => {
    state.highScore = clearHighScore();
    state.beatHighScore = false;
    render();
  });

  document.getElementById('btn-party-inc')?.addEventListener('click', () => {
    readPartyNamesFromDom();
    if (!state.party || state.party.players.length >= 6) return;
    const i = state.party.players.length;
    state.party.players.push({
      name: DEFAULT_PARTY_NAMES[i] || `Player ${i + 1}`,
      score: null,
    });
    render();
  });
  document.getElementById('btn-party-dec')?.addEventListener('click', () => {
    readPartyNamesFromDom();
    if (!state.party || state.party.players.length <= 2) return;
    state.party.players.pop();
    render();
  });
  document.getElementById('btn-party-start')?.addEventListener('click', () => {
    readPartyNamesFromDom();
    state.party.currentIndex = 0;
    state.party.players.forEach((p) => {
      p.score = null;
    });
    state.screen = 'party-pass';
    render();
  });
  document.getElementById('btn-party-ready')?.addEventListener('click', () => {
    state.screen = 'party-arm';
    render();
  });
  document.getElementById('btn-party-next')?.addEventListener('click', () => {
    if (!state.party) return;
    if (state.party.currentIndex >= state.party.players.length - 1) {
      state.screen = 'party-final';
    } else {
      state.party.currentIndex += 1;
      state.lastResult = null;
      state.beatHighScore = false;
      state.screen = 'party-pass';
    }
    render();
  });
  document.getElementById('btn-party-again')?.addEventListener('click', () => {
    if (!state.party) return;
    const names = state.party.players.map((p) => p.name);
    state.party = createParty(names);
    state.lastResult = null;
    state.beatHighScore = false;
    state.screen = 'party-pass';
    render();
  });
  document.getElementById('btn-party-quit')?.addEventListener('click', () => {
    estimator.resetSessionState();
    state.mode = null;
    state.party = null;
    state.lastResult = null;
    state.beatHighScore = false;
    state.liveAccelG = 0;
    state.liveSpeedMph = 0;
    state.screen = 'modes';
    render();
  });

  // Keep party name edits live without full re-render on every keystroke beyond input
  document.querySelectorAll('input[data-party-name]').forEach((input) => {
    input.addEventListener('change', readPartyNamesFromDom);
    input.addEventListener('blur', readPartyNamesFromDom);
  });
}

function onDonate() {
  const url = DONATE_URL;
  if (!url) return;
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(url);
    }
  } catch (err) {
    console.warn(err);
    window.location.href = url;
  }
}

async function onEnableSensors() {
  if (!state.secure) {
    state.sensorMsg = 'Open via HTTPS on your phone';
    render();
    return;
  }
  if (!state.hasMotionAPI) {
    state.sensorMsg = 'Open on your phone — sensors unavailable here';
    render();
    return;
  }

  state.awaitingPermission = true;
  state.permissionDenied = false;
  state.sensorMsg = 'Waiting for Allow…';
  const pill = document.querySelector('.status-pill');
  if (pill) {
    pill.className = 'status-pill warn';
    pill.textContent = 'Waiting for Allow…';
  }
  const enableBtn = document.getElementById('btn-enable');
  if (enableBtn) enableBtn.disabled = true;

  try {
    let motionGranted = true;

    const needsMotionPerm =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';
    const needsOrientationPerm =
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';

    if (needsMotionPerm) {
      const res = await DeviceMotionEvent.requestPermission();
      motionGranted = res === 'granted';
    }

    if (needsOrientationPerm) {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (orientErr) {
        console.warn(orientErr);
      }
    }

    if (!motionGranted) {
      state.awaitingPermission = false;
      state.permissionDenied = true;
      state.sensorOk = false;
      state.sensorMsg = 'Permission denied';
      render();
      return;
    }

    startListening();
    state.awaitingPermission = false;
    state.permissionDenied = false;
    state.sensorOk = true;
    state.sensorMsg = 'Sensors active';
    state.screen = 'modes';
    render();
  } catch (err) {
    state.awaitingPermission = false;
    state.permissionDenied = true;
    state.sensorOk = false;
    state.sensorMsg = 'Permission denied';
    console.warn(err);
    render();
  }
}

function startListening() {
  if (state.listening) return;
  motionHandler = (event) => {
    const t = event.timeStamp || performance.now();
    let sample;
    if (event.acceleration && event.acceleration.x != null) {
      sample = {
        ax: event.acceleration.x,
        ay: event.acceleration.y,
        az: event.acceleration.z,
        t,
        includesGravity: false,
      };
    } else if (
      event.accelerationIncludingGravity &&
      event.accelerationIncludingGravity.x != null
    ) {
      sample = {
        ax: event.accelerationIncludingGravity.x,
        ay: event.accelerationIncludingGravity.y,
        az: event.accelerationIncludingGravity.z,
        t,
        includesGravity: true,
      };
    } else {
      return;
    }
    handleSample(sample);
  };
  window.addEventListener('devicemotion', motionHandler, { passive: true });
  state.listening = true;
}

function stopListening() {
  if (motionHandler) {
    window.removeEventListener('devicemotion', motionHandler);
    motionHandler = null;
  }
  state.listening = false;
}

function handleSample(sample) {
  const out = estimator.push(sample);
  if (!out) return;

  if (out.type === 'live') {
    state.liveAccelG = out.accelG;
    state.liveSpeedMph = out.speedMph;
    if (state.screen === 'punch' || state.screen === 'party-punch') {
      const big = document.querySelector('.big-number');
      const meter = document.querySelector('.meter > span');
      const hintPhase = document.querySelector('.phase-label');
      if (big && estimator.phase === 'punching') {
        big.childNodes[0].textContent = fmt(state.liveSpeedMph, 1);
      }
      if (meter) {
        meter.style.width = `${Math.min(100, (state.liveAccelG / 8) * 100)}%`;
      }
      if (hintPhase) {
        hintPhase.textContent =
          estimator.phase === 'punching' ? 'Punching' : 'Armed — Punch!';
      }
    }
    return;
  }

  if (out.type === 'result') {
    state.lastResult = out;
    state.history = addResult(out);
    const { highScore, beat } = considerHighScore(out);
    state.highScore = highScore;
    state.beatHighScore = beat;
    state.liveAccelG = out.peakAccelG;
    state.liveSpeedMph = out.peakSpeedMph;

    if (state.mode === 'party' && state.party) {
      const player = currentPartyPlayer();
      if (player) {
        player.score = {
          peakSpeedMph: out.peakSpeedMph,
          peakSpeedKmh: out.peakSpeedKmh,
          peakAccelG: out.peakAccelG,
          power: out.power,
          durationMs: out.durationMs,
          at: out.at,
        };
      }
      state.screen = 'party-result';
    } else {
      state.screen = 'results';
    }
    render();
  }
}

function onArm() {
  if (!state.sensorOk && !(state.hasMotionAPI && state.secure)) {
    state.sensorMsg = 'Enable sensors on your phone first';
    state.screen = 'permission';
    render();
    return;
  }
  estimator.arm();
  state.lastResult = null;
  state.beatHighScore = false;
  state.liveAccelG = 0;
  state.liveSpeedMph = 0;
  state.screen = state.mode === 'party' ? 'party-punch' : 'punch';
  if (!state.listening && state.hasMotionAPI && state.secure) {
    startListening();
    state.sensorOk = true;
  }
  render();
}

function onCancel() {
  estimator.resetSessionState();
  state.liveAccelG = 0;
  state.liveSpeedMph = 0;
  state.screen = state.mode === 'party' ? 'party-arm' : 'arm';
  render();
}

function onReset() {
  estimator.resetSessionState();
  state.lastResult = null;
  state.beatHighScore = false;
  state.liveAccelG = 0;
  state.liveSpeedMph = 0;
  state.screen = 'arm';
  render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* optional */
    });
  });
}

if (!state.hasMotionAPI) {
  state.sensorMsg = 'Open on your phone';
} else if (!state.secure) {
  state.sensorMsg = 'Needs secure context (HTTPS)';
} else if (state.needsIOSPermission) {
  state.sensorMsg = 'Tap Allow Motion Access';
} else {
  state.sensorMsg = 'Tap Allow Motion Access';
}

render();

window.__punchSpeedMeter = { estimator, state, msToMph };
