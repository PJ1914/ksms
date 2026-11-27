# Yapaaram brand assets

- `icon-source.png`: the original icon artwork (1254×1254), supplied by the owner. Every other file is made from it.
- `icon.png`: app icon, 1024×1024, cream background, no transparency.
- `adaptive-icon.png`: Android adaptive icon foreground, transparent, artwork inside the central safe zone.
  The background colour is `#F4F8F1` (set in `app.json`).
- `monochrome-icon.png`: Android 13+ themed icon, one colour on transparent.
- `splash-icon.png`: artwork on transparent, for the splash screen (not wired up yet).
- `favicon.png`: 48×48 for the web build.
- `icon-preview.png`: the icon at 192/96/48 px in circle and squircle masks.

To regenerate after changing `icon-source.png` (needs Python with Pillow):

```
python assets/brand/make-icons.py assets/brand/icon-source.png assets/brand
```

## Opening animation layers

`intro-awning.png`, `intro-body.png` (with the ₹ area filled in) and `intro-rupee.png` are the icon split
into layers on one shared canvas, used by `src/components/IntroSplash.tsx`. Regenerate with:

```
python assets/brand/make-intro-layers.py assets/brand/icon-source.png assets/brand
```

`splash-icon.png` is the artwork edge to edge. The native splash (`expo-splash-screen` in `app.json`) shows it
160 dp wide on cream, the same size the intro starts at, so the hand-over does not jump.
