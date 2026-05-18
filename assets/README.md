# Android asset sources

This folder holds source images for `@capacitor/assets` to generate all the
icon and splash variants the Android project needs.

Required files (Capacitor assets convention):

| File | Purpose | Source |
|---|---|---|
| `icon.png` | App icon master — square, 1024x1024 minimum, no transparency | Copy of `/public/icons/icon-512.png` upscaled, or your real master |
| `icon-foreground.png` | Adaptive-icon foreground layer — your logo with transparent background, 1024x1024 | Same logo, transparent background |
| `icon-background.png` | Adaptive-icon background layer — solid color or pattern, 1024x1024 | Your brand background, e.g. theme color #1a1a2e |
| `splash.png` | Splash screen image, 2732x2732 (gets cropped to device) | Your logo centered on theme bg |

After dropping these in, generate the Android icons + splash with:

```bash
pnpm exec capacitor-assets generate --android
```

The generator writes into `android/app/src/main/res/mipmap-*` and `drawable-*`
folders. Re-run after every icon source change.

For our first build we don't need to do this — Capacitor's default icons
work fine to validate the WebView loads. We'll generate proper branded
icons in Phase 7 (polish).
