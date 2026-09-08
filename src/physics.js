/**
 * Punch kinematics from DeviceMotion samples.
 *
 * Assumptions (documented for users / future kick adapter):
 * 1. Phone is gripped firmly in a fist; orientation is roughly stable during the strike.
 * 2. We estimate speed from the magnitude of linear acceleration integrated over a
 *    short punch window — not a lab-grade 3D trajectory reconstruction.
 * 3. Prefer `acceleration` (gravity already removed by the OS). If missing, fall back
 *    to `accelerationIncludingGravity` and apply a simple high-pass / gravity estimate.
 * 4. Velocity is zeroed outside punch windows to limit integration drift.
 * 5. Sampling rate varies (~30–100 Hz). We use dt between timestamps for trapezoidal
 *    integration; if timestamps are missing we assume ~60 Hz.
 * 6. Peak speed is recreational / comparative, not competition-certified.
 */

const G = 9.80665; // m/s^2
const MPH_PER_MS = 2.23693629;
const KMH_PER_MS = 3.6;

/** Exponential high-pass coefficient for gravity removal (~0.5–1 Hz-ish at 60 Hz). */
const GRAVITY_ALPHA = 0.9;

/** Punch detection thresholds (tuned for handheld phone punches). */
const START_G = 2.2; // enter punch when |a| exceeds this
const END_G = 1.2; // exit when |a| stays below this
const END_HOLD_MS = 80;
const MIN_PUNCH_MS = 40;
const MAX_PUNCH_MS = 450;
const COOLDOWN_MS = 500;

export function msToMph(v) {
  return v * MPH_PER_MS;
}

export function msToKmh(v) {
  return v * KMH_PER_MS;
}

export function mag3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Fun 1–10 power score from peak speed (m/s) and peak accel (g).
 * Rough bands: casual ~5–12 mph, solid ~15–25, hard ~30+.
 */
export function powerScore(peakSpeedMs, peakAccelG) {
  const mph = msToMph(peakSpeedMs);
  const speedPart = Math.min(8, (mph / 35) * 8);
  const accelPart = Math.min(2, (peakAccelG / 8) * 2);
  const raw = 1 + speedPart + accelPart;
  return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
}

export class PunchEstimator {
  constructor() {
    this.resetFilters();
    this.resetSessionState();
  }

  resetFilters() {
    this.gx = 0;
    this.gy = 0;
    this.gz = 0;
    this.gravityReady = false;
    this.prevAx = 0;
    this.prevAy = 0;
    this.prevAz = 0;
    this.prevT = null;
    this.havePrev = false;
  }

  resetSessionState() {
    this.phase = 'idle'; // idle | armed | punching | cooldown
    this.vel = 0;
    this.peakSpeed = 0;
    this.peakAccelG = 0;
    this.punchStartT = null;
    this.belowSince = null;
    this.cooldownUntil = 0;
    this.lastSample = null;
  }

  fullReset() {
    this.resetFilters();
    this.resetSessionState();
  }

  arm() {
    this.resetSessionState();
    this.phase = 'armed';
    this.vel = 0;
    this.peakSpeed = 0;
    this.peakAccelG = 0;
  }

  /**
   * @param {{ax:number,ay:number,az:number,t:number,includesGravity?:boolean}} sample
   * @returns {null | {type:'live', accelG:number, speedMph:number, phase:string} | {type:'result', ...}}
   */
  push(sample) {
    const t = sample.t;
    let ax = sample.ax;
    let ay = sample.ay;
    let az = sample.az;

    if (sample.includesGravity) {
      if (!this.gravityReady) {
        this.gx = ax;
        this.gy = ay;
        this.gz = az;
        this.gravityReady = true;
      } else {
        this.gx = GRAVITY_ALPHA * this.gx + (1 - GRAVITY_ALPHA) * ax;
        this.gy = GRAVITY_ALPHA * this.gy + (1 - GRAVITY_ALPHA) * ay;
        this.gz = GRAVITY_ALPHA * this.gz + (1 - GRAVITY_ALPHA) * az;
      }
      ax -= this.gx;
      ay -= this.gy;
      az -= this.gz;
    }

    const aMag = mag3(ax, ay, az); // m/s^2
    const accelG = aMag / G;
    this.lastSample = { ax, ay, az, aMag, accelG, t };

    let dt;
    if (this.prevT == null) {
      dt = 1 / 60;
    } else {
      dt = Math.max(0.004, Math.min(0.05, (t - this.prevT) / 1000));
    }

    // Trapezoidal integration of |a| is not physical for vector velocity, so we
    // integrate the component along the instantaneous acceleration direction by
    // projecting delta-v along the motion: use scalar speed estimate from |a|
    // only while punching, with a mild damping term to limit runaway.
    // Better approach for peak estimate: integrate vector velocity, take |v|.
    let liveSpeed = 0;

    if (this.phase === 'armed' || this.phase === 'punching') {
      if (this.havePrev) {
        // Vector integrate linear accel → velocity
        // Use private vector state lazily
        if (this._vx == null) {
          this._vx = this._vy = this._vz = 0;
        }
        this._vx += 0.5 * (this.prevAx + ax) * dt;
        this._vy += 0.5 * (this.prevAy + ay) * dt;
        this._vz += 0.5 * (this.prevAz + az) * dt;
        // Light damping outside strong accel to reduce drift
        if (accelG < 0.8) {
          this._vx *= 0.98;
          this._vy *= 0.98;
          this._vz *= 0.98;
        }
        this.vel = mag3(this._vx, this._vy, this._vz);
      }
      liveSpeed = this.vel;
    }

    this.prevAx = ax;
    this.prevAy = ay;
    this.prevAz = az;
    this.prevT = t;
    this.havePrev = true;

    const now = t;

    if (this.phase === 'cooldown') {
      if (now >= this.cooldownUntil) {
        this.phase = 'idle';
      }
      return { type: 'live', accelG, speedMph: 0, phase: this.phase };
    }

    if (this.phase === 'armed') {
      if (accelG >= START_G) {
        this.phase = 'punching';
        this.punchStartT = now;
        this.belowSince = null;
        this.peakSpeed = this.vel;
        this.peakAccelG = accelG;
        this._vx = this._vy = this._vz = 0;
        this.vel = 0;
      }
      return {
        type: 'live',
        accelG,
        speedMph: msToMph(liveSpeed),
        phase: this.phase,
      };
    }

    if (this.phase === 'punching') {
      this.peakSpeed = Math.max(this.peakSpeed, this.vel);
      this.peakAccelG = Math.max(this.peakAccelG, accelG);

      const elapsed = now - this.punchStartT;
      if (accelG < END_G) {
        if (this.belowSince == null) this.belowSince = now;
      } else {
        this.belowSince = null;
      }

      const heldLow =
        this.belowSince != null && now - this.belowSince >= END_HOLD_MS;
      const timedOut = elapsed >= MAX_PUNCH_MS;
      const longEnough = elapsed >= MIN_PUNCH_MS;

      if ((heldLow && longEnough) || timedOut) {
        const result = {
          type: 'result',
          peakSpeedMs: this.peakSpeed,
          peakSpeedMph: msToMph(this.peakSpeed),
          peakSpeedKmh: msToKmh(this.peakSpeed),
          peakAccelG: this.peakAccelG,
          power: powerScore(this.peakSpeed, this.peakAccelG),
          durationMs: elapsed,
          at: Date.now(),
        };
        this.phase = 'cooldown';
        this.cooldownUntil = now + COOLDOWN_MS;
        this._vx = this._vy = this._vz = 0;
        this.vel = 0;
        return result;
      }

      return {
        type: 'live',
        accelG,
        speedMph: msToMph(this.vel),
        phase: this.phase,
      };
    }

    return { type: 'live', accelG, speedMph: 0, phase: this.phase };
  }

  /** Synthetic punch samples for desktop simulation (no sensors). */
  static simulatePunch(strength = 1) {
    const samples = [];
    const n = 40;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      // Bell-shaped forward spike along x, mild y noise
      const envelope = Math.exp(-Math.pow((u - 0.35) / 0.12, 2));
      const a = strength * 35 * envelope; // m/s^2 peak ~3.5g * strength
      samples.push({
        ax: a,
        ay: (Math.random() - 0.5) * 2,
        az: 9.8 + (Math.random() - 0.5) * 0.5,
        t: t0 + i * (1000 / 60),
        includesGravity: true,
      });
    }
    // settle
    for (let i = 0; i < 15; i++) {
      samples.push({
        ax: (Math.random() - 0.5) * 0.3,
        ay: (Math.random() - 0.5) * 0.3,
        az: 9.8,
        t: t0 + (n + i) * (1000 / 60),
        includesGravity: true,
      });
    }
    return samples;
  }
}
