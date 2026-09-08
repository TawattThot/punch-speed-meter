import './style.css';
import { PunchEstimator, msToMph } from './physics.js';
import { loadHistory, addResult, clearHistory } from './storage.js';

const app = document.getElementById('app');
const estimator = new PunchEstimator();

const state = {
  screen: 'permission', // permission | arm | punch | results
  sensorOk: false,
  sensorMsg: 'Sensors not enabled yet',
  permissionDenied: false,
  awaitingPermission: false,
  needsIOSPermission: typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function',
  secure: window.isSecureContext,
  hasMotionAPI: typeof window.DeviceMotionEvent !== 'undefined',
  liveAccelG: 0,
  liveSpeedMph: 0,
  lastResult: null,
  history: loadHistory(),
  listening: false,
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

function phaseCopy() {
  switch (state.screen) {
    case 'permission':
      return {
        label: 'Get Ready',
        hint: 'Enable motion sensors, then arm up and punch while gripping the phone firmly.',
        big: '0.0',
        unit: 'MPH PEAK',
      };
    case 'arm':
      return {
        label: 'Arm',
        hint: 'Hold the phone tight in your fist. Tap Arm, then throw a controlled punch.',
        big: 'READY',
        unit: 'WAIT FOR ARM',
      };
    case 'punch':
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
        label: 'Results',
        hint: 'Nice hit. Reset to go again.',
        big: fmt(state.lastResult?.peakSpeedMph, 1),
        unit: 'MPH PEAK',
      };
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

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

function renderActions() {
  if (state.screen === 'permission') {
    const disabled = !isPhoneCapable() || state.awaitingPermission ? ' disabled' : '';
    const label = state.permissionDenied ? 'Try Allow Again' : 'Allow Motion Access';
    return `
      <button id="btn-enable" type="button"${disabled}>${label}</button>
    `;
  }
  if (state.screen === 'arm') {
    return `
      <button id="btn-arm" type="button">Arm</button>
    `;
  }
  if (state.screen === 'punch') {
    return `
      <button id="btn-cancel" class="secondary" type="button">Cancel</button>
    `;
  }
  // results
  return `
    <button id="btn-reset" type="button">Reset</button>
    <button id="btn-arm-again" class="secondary" type="button">Arm again</button>
  `;
}

function render() {
  const copy = phaseCopy();
  const result = state.lastResult;
  const meterPct = Math.min(100, (state.liveAccelG / 8) * 100);
  const stageClass =
    state.screen === 'results' ? 'stage card result-flash' : 'stage card';
  const pulse = state.screen === 'punch' && estimator.phase === 'armed' ? ' pulse' : '';

  app.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <h1>Punch Speed Meter</h1>
        <span>Phone-in-fist peak speed</span>
      </div>
      <div class="badge">v1 punch</div>
    </header>

    <section class="card safety">
      <div class="icon" aria-hidden="true">⚠️</div>
      <div>
        <h2>Safety</h2>
        <ul>
          <li>Hold the phone firmly — never throw it.</li>
          <li>Clear space; don’t punch toward people or hard objects.</li>
          <li>Use a case; stop if the grip feels loose.</li>
        </ul>
      </div>
    </section>

    ${phoneOnlyBanner()}
    ${statusPill()}
    ${renderPermissionCoach()}
    ${renderPermissionRecovery()}

    <section class="${stageClass}">
      <div class="phase-label${pulse}">${escapeHtml(copy.label)}</div>
      <div class="big-number">${escapeHtml(copy.big)}<span class="unit">${escapeHtml(copy.unit)}</span></div>
      <div class="meter" aria-hidden="true"><span style="width:${meterPct}%"></span></div>
      <p class="hint">${escapeHtml(copy.hint)}</p>
      ${
        state.screen === 'results' && result
          ? `<div class="substats">
              <div class="stat"><div class="label">km/h</div><div class="value">${fmt(result.peakSpeedKmh, 1)}</div></div>
              <div class="stat"><div class="label">Peak accel</div><div class="value">${fmt(result.peakAccelG, 1)} g</div></div>
              <div class="stat"><div class="label">Power</div><div class="value">${fmt(result.power, 1)} / 10</div></div>
              <div class="stat"><div class="label">Duration</div><div class="value">${Math.round(result.durationMs)} ms</div></div>
            </div>`
          : state.screen === 'punch'
            ? `<div class="substats">
                <div class="stat"><div class="label">Accel</div><div class="value">${fmt(state.liveAccelG, 1)} g</div></div>
                <div class="stat"><div class="label">Phase</div><div class="value">${escapeHtml(estimator.phase)}</div></div>
              </div>`
            : ''
      }
    </section>

    <div class="actions">${renderActions()}</div>

    <section class="card history">
      <h2>
        <span>Session history</span>
        <button id="btn-clear" class="ghost" type="button" style="padding:6px 10px;width:auto">Clear</button>
      </h2>
      ${renderHistory()}
    </section>

    <p class="footer-note">
      Estimates use high-pass / gravity-removed acceleration and short-window integration.
      Recreational accuracy only. iOS requires a user tap + HTTPS. Open on your phone.
    </p>
  `;

  bind();
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

  // Keep this synchronous with the tap so iOS still treats requestPermission as user-activated.
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

    // Motion is required; call from the user gesture first.
    if (needsMotionPerm) {
      const res = await DeviceMotionEvent.requestPermission();
      motionGranted = res === 'granted';
    }

    // Also request orientation when available (best-effort; motion remains required).
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
    state.screen = 'arm';
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
    if (state.screen === 'punch') {
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
    state.screen = 'results';
    state.liveAccelG = out.peakAccelG;
    state.liveSpeedMph = out.peakSpeedMph;
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
  state.liveAccelG = 0;
  state.liveSpeedMph = 0;
  state.screen = 'punch';
  if (!state.listening && state.hasMotionAPI && state.secure) {
    startListening();
    state.sensorOk = true;
  }
  render();
}

function onCancel() {
  estimator.resetSessionState();
  state.screen = 'arm';
  state.liveAccelG = 0;
  state.liveSpeedMph = 0;
  render();
}

function onReset() {
  estimator.resetSessionState();
  state.lastResult = null;
  state.liveAccelG = 0;
  state.liveSpeedMph = 0;
  state.screen = 'arm';
  render();
}

// Register service worker when available (PWA nice-to-have)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* optional */
    });
  });
}

// Initial routing hints
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

// Export for console debugging / future kick adapter hook
window.__punchSpeedMeter = { estimator, state, msToMph };
