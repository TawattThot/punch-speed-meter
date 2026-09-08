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

## FOSS constraints

- Capacitor Android wrapper only; no Play Billing; no GMS / Play Services plugin.
- Motion sensing is on-device via WebView `DeviceMotion`.
- `INTERNET` is only for optional Donate (PayPal.me opens in the system browser).
- Required hardware feature: accelerometer (`android.hardware.sensor.accelerometer`).

## Build from source

Need Node 20+, JDK 17+, and Android SDK (compileSdk / API 34).

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

## Submit to F-Droid (next steps for maintainer)

1. Fork https://gitlab.com/fdroid/fdroiddata
2. Add metadata YAML under `metadata/com.tawattthot.punchspeed.yml` (or use `fdroid import`)
3. Set `Repo`, `RepoType: git`, `License: MIT`, `Donate: https://paypal.me/joeyboy215`
4. Point `Builds` at a tagged release (e.g. `v1.0.0`) with npm + Gradle prebuild for Capacitor
5. Open a merge request to fdroiddata; wait for the build server / review

Do **not** submit to Google Play Console unless you deliberately want Play later — this packaging path is F-Droid-first.
