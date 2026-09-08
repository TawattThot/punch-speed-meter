import './style.css';
import { PunchEstimator, msToMph } from './physics.js';
import { loadHistory, addResult, clearHistory } from './storage.js';

const app = document.getElementById('app');
const estimator = new PunchEstimator();

const state = {
  screen: 'permission', // permission | arm | punch | results
  sensorOk: false,
  sensorMsg: 'Sensors not enabled yet',
  needsIOSPermission: typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function',
  secure: window.isSecureContext,
  hasMotionAPI: typeof window.DeviceMotionEvent !== 'undefined',
  liveAccelG: 0,
  liveSpeedMph: 0,
  lastResult: null,
  history: loadHistory(),
  listening: false,
  simulateMode: false,
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
    return `<div class="status-pill bad">Needs HTTPS or localhost</div>`;
  }
  if (!state.hasMotionAPI && !state.simulateMode) {
    return `<div class="status-pill warn">No DeviceMotion — use Simulate</div>`;
  }
  if (state.sensorOk) {
    return `<div class="status-pill">Sensors active</div>`;
  }
  return `<div class="status-pill warn">${escapeHtml(state.sensorMsg)}</div>`;
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

function renderActions() {
  if (state.screen === 'permission') {
    return `
      <button id="btn-enable" type="button">Enable Sensors</button>
      <button id="btn-simulate" class="ghost" type="button">Simulate punch (desktop)</button>
    `;
  }
  if (state.screen === 'arm') {
    return `
      <button id="btn-arm" type="button">Arm</button>
      <button id="btn-simulate" class="ghost" type="button">Simulate punch</button>
    `;
  }
  if (state.screen === 'punch') {
    return `
      <button id="btn-cancel" class="secondary" type="button">Cancel</button>
      <button id="btn-simulate" class="ghost" type="button">Simulate punch</button>
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

    ${statusPill()}

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
      Recreational accuracy only. iOS requires a user gesture + HTTPS (or localhost).
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
  document.getElementById('btn-simulate')?.addEventListener('click', onSimulate);
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    state.history = clearHistory();
    render();
  });
}

async function onEnableSensors() {
  if (!state.secure) {
    state.sensorMsg = 'Open via HTTPS or localhost';
    render();
    return;
  }
  if (!state.hasMotionAPI) {
    state.sensorMsg = 'DeviceMotion unavailable';
    state.simulateMode = true;
    state.screen = 'arm';
    render();
    return;
  }

  try {
    if (state.needsIOSPermission) {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') {
        state.sensorMsg = 'Permission denied';
        render();
        return;
      }
    }
    startListening();
    state.sensorOk = true;
    state.sensorMsg = 'Sensors active';
    state.screen = 'arm';
    render();
  } catch (err) {
    state.sensorMsg = 'Permission failed — try Simulate';
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
      // lightweight live update without full re-render thrash: update DOM nodes if present
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
      const accelEl = document.querySelector('.substats .stat .value');
      if (accelEl && state.screen === 'punch') {
        // refresh substats simply via partial render when punching starts
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

function onSimulate() {
  state.simulateMode = true;
  if (state.screen === 'permission') {
    state.screen = 'arm';
    state.sensorMsg = 'Simulation mode';
    render();
  }
  // Auto-arm and feed synthetic samples
  estimator.arm();
  state.screen = 'punch';
  render();

  const samples = PunchEstimator.simulatePunch(0.9 + Math.random() * 0.5);
  let i = 0;
  const tick = () => {
    if (i >= samples.length) return;
    handleSample(samples[i++]);
    if (state.screen === 'punch') {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
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
  state.sensorMsg = 'No DeviceMotion API';
} else if (!state.secure) {
  state.sensorMsg = 'Needs secure context (HTTPS)';
} else if (state.needsIOSPermission) {
  state.sensorMsg = 'Tap Enable for iOS permission';
} else {
  state.sensorMsg = 'Tap Enable to start';
}

render();

// Export for console debugging / future kick adapter hook
window.__punchSpeedMeter = { estimator, state, msToMph };
