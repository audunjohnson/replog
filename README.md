# Augie Swole — personal workout tracker

A single-user, offline-first **Progressive Web App** for tracking workouts on your iPhone.
No accounts, no server — every set you log is stored locally on your device.

## What it does

Built around a specific two-day program: **Push day** (chest/shoulders/tricep) and
**Leg day**, each paired with pull-ups. Everything is counted by **sets**, not reps.

- **Pull-ups** — one continuous auto-progression done every workout, pinned to the top of
  the workout screen as a set counter. Start at 10 sets × 3 reps; complete all sets and the
  next workout advances one set (up to 20), then resets to 10 sets at +1 rep, and so on.
- **Accessories** — each day has an *ordered, customizable* list. The number you actually do
  each workout is **⌊pull-up sets ÷ 3⌋** (the first N in order), so there's always one to do
  between pull-up sets and never more than needed. Sets/reps are configurable (default 3×8;
  sit-ups 3×10; calf raise 3×20). Weight bumps by ±5 (or type a custom value) and carries
  forward between workouts.
- **Workout screen** — pull-up counter on top, push/leg exercise counters below; tap **+1
  set** as you go, interleaving freely.
- **Stats tab** — per-exercise charts of weight/reps over time, plus pull-up volume.
- **History tab** — browse every finished workout.
- **Program tab** — edit the pull-up level and add/edit/remove exercises per day (order = priority).
- **Backup tab** — export all data to a `.json` file and re-import it anytime.

> No rest timer — by design.

## Run it locally (Windows)

A service worker needs `http://localhost` (not `file://`), so serve the folder:

```sh
# from this folder
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser. (Any static file server works.)

## Install on your iPhone

The app must be served over **HTTPS** for Safari to install it. Two easy options:

1. **Free static host** — push this folder to a host like GitHub Pages, Netlify, or
   Cloudflare Pages (all give you an HTTPS URL). Open that URL in **Safari** on your iPhone.
2. **Same Wi-Fi, quick test** — serve locally (above) and use a tunneling tool that gives
   an HTTPS URL, or just use "Add to Home Screen" over HTTP for a non-offline trial.

In Safari: tap **Share → Add to Home Screen**. Augie Swole then launches full-screen with its
own icon and works offline.

## Backing up your data

Data lives only in this device's browser storage. Open **Backup → Export** periodically to
save a `.json` copy. To move to a new phone, **Import** that file there.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | App shell + PWA/iOS meta tags |
| `styles.css` | Dark, mobile-first styling |
| `store.js` | Data layer (localStorage): pull-up program, exercises, sessions |
| `app.js` | Views: workout (pull-up grid + accessory cards), history, program editor |
| `manifest.webmanifest` | PWA manifest |
| `sw.js` | Service worker (offline cache) — bump `CACHE` after edits |
| `gen_icons.py` | Regenerates the app icons (needs Pillow) |

> After editing any cached file, bump the `CACHE` version in `sw.js` so installed copies
> fetch the update.
