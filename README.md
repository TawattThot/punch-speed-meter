# Punch Speed Meter

Mobile-first web app that estimates **punch peak speed** from your phone's accelerometer. Hold the phone in your fist, arm, punch, and see peak speed (mph + km/h), peak acceleration (g), and a fun 1-10 power score.

Built with **Vite + vanilla JS**. No backend.

## Safety

- **Hold the phone firmly.** Do **not** throw your phone.
- Clear the area; do not punch toward people, walls, or hard objects.
- Use a protective case. Stop immediately if your grip feels loose.
- This is a recreational estimate, not a certified sports instrument.

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL on your phone (same Wi-Fi).

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server with `--host` (LAN access) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build (`--host`) |

## Phone testing (important)

`DeviceMotion` requires a **secure context**:

- **HTTPS**, or
- **`localhost` / `127.0.0.1`**

### Local network testing with Vite

```bash
npm run dev
```

Vite is configured with `server.host: true`. On many phones, `http://<your-lan-ip>:5173` works for sensors on Android. **iOS Safari** is stricter:

1. Prefer an HTTPS tunnel to the Vite port, **or**
2. Use `npm run build && npm run preview` behind HTTPS.

### iOS permission

iOS requires a **user gesture** to call `DeviceMotionEvent.requestPermission()`. Tap **Enable Sensors** on the first screen.

## How to use

1. Read the safety notes.
2. Tap **Enable Sensors** (or **Simulate punch** on desktop).
3. Grip the phone in your fist, then tap **Arm**.
4. Throw a controlled punch.
5. View results, then **Reset** / **Arm again**.

Session history is stored in `localStorage` on device.

## How speed is estimated

1. Read linear acceleration from `DeviceMotionEvent`.
   - Prefer `acceleration` (OS gravity-removed).
   - Else use `accelerationIncludingGravity` and an exponential high-pass / gravity estimate.
2. Detect a punch when acceleration magnitude exceeds ~2.2 g, then end when it stays low (~1.2 g) briefly or after a max window (~450 ms).
3. During the punch window, trapezoidal-integrate acceleration to velocity and take |v| as the speed estimate.
4. Report peak |v| as peak speed, plus peak |a| in g.
5. Map speed + accel into a fun **1-10 power score**.

### Physics assumptions and caveats

- Phone orientation is assumed roughly stable in the fist; this is **not** full 3D pose tracking.
- Integration drifts; we limit the window and lightly damp velocity at low accel.
- Device sample rates vary (~30-100 Hz); timestamps drive `dt` when available.
- Results are for **comparison / fun**, not lab accuracy. Soft punches, loose grip, or spinning the phone will skew numbers.
- Desktop **Simulate punch** feeds a synthetic acceleration spike when sensors are missing.

See comments in `src/physics.js` for implementation details.

## PWA

- `public/manifest.webmanifest` — install metadata / theme
- `public/sw.js` — optional lightweight app-shell cache
- Icons in `public/` (`icon.svg`, `icon-192.png`, `icon-512.png`)

## Project layout

```
src/main.js       UI + permission + flow
src/physics.js    Gravity removal, punch detect, integration
src/storage.js    localStorage history
src/style.css     Dark athletic mobile UI
public/           Manifest, SW, icons
```

## TODO — future kick adapter (stub)

No kick UI in v1. A future adapter could:

- Reuse `PunchEstimator` with different thresholds / longer windows.
- Mount the phone on a shin guard or shoe (strap) and calibrate orientation.
- Swap copy / safety text for kicks and add a mode flag in storage.

```js
// Future: src/adapters/kick.js
// export function createKickEstimator() {
//   return new PunchEstimator(/* kick-tuned thresholds */);
// }
```

## License

MIT
