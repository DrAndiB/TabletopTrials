# Tabletop Trials for Android

The Android app is the web game from the repository root, packed into a native app with
[Capacitor](https://capacitorjs.com/) 8. There is one game codebase: anything that changes in `js/`, `css/`,
`index.html` and the other game folders reaches the website and the app alike.

- **App ID:** `lu.andreasbraun.tabletoptrials` (cannot change once the app is on Google Play)
- **Version:** `version` in `app/package.json` is the version name. The version code is the GitHub Actions run
  number, so every build counts up.

## What the app adds

- Full screen: system bars hidden (a swipe from the edge shows them briefly), screen kept on, drawing extends into
  the camera cutout (`MainActivity.java`).
- Phone mode by default: one touch player plays with gestures on the whole screen (`js/gestures.js`), with a
  vibration for every stroke (the app holds the `VIBRATE` permission that `navigator.vibrate` needs in a WebView).
- Screen orientation: the option "Screen: Auto / Portrait / Landscape" (shown only in the app). The game calls the
  app's own plugin (`OrientationPlugin.java`, through `Capacitor.nativePromise`), which saves the choice so the next
  start opens in it. Auto by default: the screen follows the phone and its rotation lock. On Android 16, tablets and
  unfolded foldables ignore a locked orientation and always rotate freely (a system rule for large screens).
- Back button: pauses during an event and goes one step back in the menus; on the title screen the app goes to the
  background (`window.__ttBack` in `js/main.js`).
- In the app the game hides its fullscreen button (`.in-app` in `css/game.css`).
- Icon, round icon, adaptive icon, splash screens and the 512 px store icon (`app/store/icon-512.png`), all drawn by
  `_dev/tools/app_icons.py` from the favicon design. Run it again after changing the design.

## Getting the app onto a phone

Every push to `main` or `phone-mode` that touches the game or `app/` builds the app on GitHub
(`.github/workflows/android.yml`) and replaces the **android-preview** pre-release:
https://github.com/DrAndiB/TabletopTrials/releases/tag/android-preview

Open that page on the phone, tap the `.apk` file and allow the browser to install apps when Android asks.
Preview builds are signed with a fixed preview key (`android/preview.keystore`, password in `android/app/build.gradle`),
so a new preview installs over the previous one and keeps records and settings. That key is public on purpose: it
is only for previews, never for Google Play.

## Building on a Windows PC (optional)

Needs Node.js and Android Studio (which brings the Android SDK and a JDK). In PowerShell, from `app\`:

```powershell
npm ci
npm run sync          # copies the game into app\www and from there into the Android project
npx cap open android  # opens Android Studio; Run ▶ installs on a connected phone
```

## Google Play: what is still to do

1. A Google Play developer account (the same one as for Tabletop Turbo, once it exists).
2. An upload key (keep a backup outside GitHub) added as repository secrets. The build script already reads
   `TT_UPLOAD_KEYSTORE`, `TT_UPLOAD_STORE_PASSWORD`, `TT_UPLOAD_KEY_ALIAS` and `TT_UPLOAD_KEY_PASSWORD`; the workflow
   then needs a `bundleRelease` step for the `.aab`.
3. Store listing: the 512 px icon is in `app/store/`; also needed are a 1024×500 feature graphic, screenshots,
   a privacy policy URL (the game collects nothing: settings and records stay on the device), the content rating
   questionnaire and the target age group (a children's audience brings Google's Families policy into play).
