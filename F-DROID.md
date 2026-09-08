# F-Droid packaging notes

Punch Speed Meter is intended for **F-Droid** as free/open-source software (MIT).

## App identity

| Field | Value |
|-------|-------|
| Application ID | `com.tawattthot.punchspeed` |
| Name | Punch Speed Meter |
| License | MIT |
| Source | https://github.com/TawattThot/punch-speed-meter |
| Donate | https://paypal.me/joeyboy215 |
| versionName | `1.0.0` |
| versionCode | `1` |

## Drafted fdroiddata metadata (in-this-repo)

Copy this file into a fork of `fdroiddata` as `metadata/com.tawattthot.punchspeed.yml`:

- **In-repo path:** [metadata/com.tawattthot.punchspeed.yml](metadata/com.tawattthot.punchspeed.yml)
- **Modeled on:** Capacitor apps such as `com.gurkenwerfer.calyx` (forky npm + npm ci + cap sync)
- **Tag:** `v1.0.0` (Builds commit points at this tag)
- **AntiFeatures**: `NonFreeNet` — INTERNET is only for optional PayPal donate (paypal.me/joeyboy215 in the system browser); see MaintainerNotes in the YAML

## FOSS constraints

- Capacitor Android wrapper only; no Play Billing; no GMS / Play Services plugin.
- Motion sensing is on-device via WebView `DeviceMotion`.
- `INTERNET` is only for optional Donate (PayPal.me opens in the system browser).
- Required hardware feature: accelerometer (`android.hardware.sensor.accelerometer`).

## Build from source

Need Node 20', JDK 17'+, and Android SDK (compileSdk / API 34).

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
Release unsigned: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

F-Droid will sign release builds with its own keys.

## Fastlane metadata

Store listing copy lives under `fastlane/metadata/android/en-US/` (title, short/full description, changelogs). Donate URL also in `Donate.txt`.

## Submit to F-Droid — MR merge request walkthrough (Joseph)

Do **not** submit to Google Play Console unless you deliberately want Play later — this packaging path is F-Droid-first.

### 1. GitLab account

1. Open https://gitlab.com and sign in (or create an account).
2. Add an SSH key or personal access token if you plan to push over git.

### 2. Fork fdroiddata

1. Open https://gitlab.com/fdroid/fdroiddata
2. Click **Fork** — create a fork under your GitLab username/group.
3. Clone your fork:

   ```bash
   git clone https://gitlab.com/<YOUR-USER>/fdroiddata.git
  cd fdroiddata
   git checkout -b add-punch-speed-meter
  ```

### 3. Copy the drafted YAML

From this repo (`punch-speed-meter`) copy the file into the fork: 

  ```bash
  # From the punch-speed-meter clone (this repo):
  cp /path/to/punch-speed-meter/metadata/com.tawattthot.punchspeed.yml \
      /path/to/fdroiddata/metadata/com.tawattthot.punchspeed.yml
  cd /path/to/fdroiddata
  git add metadata/com.tawattthot.punchspeed.yml
  git commit -m "Add com.tawattthot.punchspeed (MIT, punch speed meter)"
  git push -u origin add-punch-speed-meter
  ```

### 4. Open the merge request

1. On GitLab, open your fork – you should see a **Create merge request** banner.
2. Target:
   - Source: your fork / branch `add-punch-speed-meter`
   - Target: `fdroid/fdroiddata` / `master`
3. Title suggestion: `New app: Punch Speed Meter (com.tawattthot.punchspeed)`
4. In the description, note:
   - MIT license
   - Capacitor Android build (npm ci + cap sync + gradle)
   - Source: https://github.com/TawattThot/punch-speed-meter
   - Tag: v1.0.0
   - Donate: https://paypal.me/joeyboy215
   - NonFreeNet: optional PayPal donate only (INTERNET is not required for core features)
5. Submit the MR and wait for build server / reviewer feedback.

Official docs: https://f-droid.org/docs/Inclusion_How-To/
