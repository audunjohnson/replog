# Augie Swole — personal workout tracker

A single-user, offline-first **Progressive Web App** for tracking workouts on your iPhone.
No accounts, no server — every set you log is stored locally on your device.

## What it does

Built around a three-day split: **Leg Day**, **Push Day** (chest/shoulders/tricep) and
**Pull Day** (back/bicep). Every set is logged with its own weight and the reps you did.

- **Days** — each day has an *ordered, customizable* list of exercises; a workout runs the
  whole list. Sets default to 3 with a target rep count (default 3×8; sit-ups 3×10; calf
  raise 3×20).
- **Every-day exercises** (Face pull, Pikes by default) — one shared exercise added to the
  end of every day's workout. Editing it in Program, or its "Next time" weight in any
  workout, updates it on all days.
- **Workout screen** — each exercise shows one row per set. Weight is editable per set
  (changing a set's weight carries to later unlogged sets); record the reps you actually
  did with −/+ or by typing (the first + fills in the target). Add or remove sets on the
  fly. **Next time** sets the weight the exercise starts at next workout — it follows your
  heaviest logged set unless you change it. While a workout is active the screen stays
  awake (wake lock).
- **Stats tab** — per-exercise charts: heaviest set over time (bodyweight: total reps).
- **Galaxy tab** — a slowly rotating sphere of stars; every rep in History adds one star,
  older workouts and their pull-ups included (capped at 10,000). A preview mode steps
  through the 0→10,000 journey.
- **History tab** — browse every finished workout.
- **Program tab** — add/edit/remove/reorder exercises per day and in the Every day list.
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
| `store.js` | Data layer (localStorage): exercises, per-set sessions, schema migration |
| `app.js` | Views: workout (per-set exercise cards), stats, galaxy, history, program editor |
| `manifest.webmanifest` | PWA manifest |
| `sw.js` | Service worker (offline cache) — bump `CACHE` after edits |
| `gen_icons.py` | Regenerates the app icons (needs Pillow) |

> After editing any cached file, bump the `CACHE` version in `sw.js` so installed copies
> fetch the update.
