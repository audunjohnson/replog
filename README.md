# RepLog — personal workout tracker

A single-user, offline-first **Progressive Web App** for tracking workouts on your iPhone.
No accounts, no server — every set you log is stored locally on your device.

## What it does

- **During a workout** — a big tap-to-count **rep counter** ("rep 7 of 10"), per-set
  weight tracking, and an automatic **rest timer** (beeps + vibrates when time's up).
- **Between workouts** — every set is saved. When you add an exercise it shows
  *"Last · Tuesday: 60kg × 10, 60kg × 10, 60kg × 8"* and pre-fills your last weights so
  you can pick up where you left off and progress over time.
- **History** — browse past workouts; tap any exercise to see its full progress and best set.
- **Backup** — export all data to a `.json` file and re-import it anytime.

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

In Safari: tap **Share → Add to Home Screen**. RepLog then launches full-screen with its
own icon and works offline.

## Backing up your data

Data lives only in this device's browser storage. Open **Backup → Export** periodically to
save a `.json` copy. To move to a new phone, **Import** that file there.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | App shell + PWA/iOS meta tags |
| `styles.css` | Dark, mobile-first styling |
| `store.js` | Data layer (localStorage) |
| `app.js` | Views, rep counter, rest timer, history |
| `manifest.webmanifest` | PWA manifest |
| `sw.js` | Service worker (offline cache) — bump `CACHE` after edits |
| `gen_icons.py` | Regenerates the app icons (needs Pillow) |

> After editing any cached file, bump the `CACHE` version in `sw.js` so installed copies
> fetch the update.
