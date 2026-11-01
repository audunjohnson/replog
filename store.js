/* store.js — Augie Swole data layer (localStorage, single device, no server).
 * NOTE: storage keys keep the historical `replog.*` prefix so existing saved
 * data survives the rename — do not change them.
 *
 * Program:
 *   - Three day templates: 'leg', 'push' and 'pull', each an ordered, customizable
 *       list. Every exercise on the chosen day is done, in order.
 *   - Every-day exercises (day 'all') are one shared record appended to every day's
 *       workout, so any edit to one — in Program or via a workout's "Next time" —
 *       applies on all days.
 *   - Exercise = { id, name, day, bodyweight, sets, reps, weight }. Sets default to 3;
 *       reps is the target; weight is the working weight each workout starts from.
 *
 * Session (logged per set):
 *   set     = { weight, reps }   weight null for bodyweight; reps null until logged
 *   entry   = { exerciseId, name, unit, bodyweight, targetReps, weight, nextWeight, sets:[set] }
 *   session = { id, date, startedAt, finishedAt, day, entries:[entry] }
 *   Stored newest-first. Legacy sessions (schema < 5) instead carry `pullups` and
 *   entries with a `done` set count — read them through sessionEntries()/doneSets().
 */
const DB = (() => {
  const K = {
    settings: 'replog.settings', exercises: 'replog.exercises', sessions: 'replog.sessions',
    active: 'replog.active', seeded: 'replog.seeded', schema: 'replog.schema',
    pullups: 'replog.pullups', // legacy pull-up program; dropped by migrate()
  };
  const SCHEMA = 6;
  const DAYS = ['leg', 'push', 'pull'];
  const ALL = 'all'; // every-day exercises
  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();

  /* ---- settings ---- */
  const defaultSettings = { unit: 'lb' };
  const getSettings = () => Object.assign({}, defaultSettings, read(K.settings, {}));
  const saveSettings = (s) => write(K.settings, s);

  /* ---- exercises ---- */
  const getExercises = () => read(K.exercises, []);
  const saveExercises = (l) => write(K.exercises, l);
  const getExercisesByDay = (day) => getExercises().filter(e => e.day === day);
  // What a workout on `day` runs: that day's list, then the every-day exercises.
  const getWorkoutExercises = (day) => getExercisesByDay(day).concat(getExercisesByDay(ALL));
  const getExercise = (id) => getExercises().find(e => e.id === id) || null;
  function upsertExercise(ex) {
    const list = getExercises();
    const i = list.findIndex(e => e.id === ex.id);
    if (i >= 0) list[i] = ex; else list.push(ex);
    saveExercises(list);
    return ex;
  }
  const deleteExercise = (id) => saveExercises(getExercises().filter(e => e.id !== id));
  const newExercise = (day) => ({ id: uid(), name: '', day, bodyweight: false, sets: 3, reps: 8, weight: 0 });

  // Reorder a day's exercises to match `ids`, leaving the other days' items in place.
  function reorderDay(day, ids) {
    const all = getExercises();
    const byId = new Map(all.filter(e => e.day === day).map(e => [e.id, e]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    byId.forEach(e => { if (!ordered.includes(e)) ordered.push(e); });
    let k = 0;
    saveExercises(all.map(e => (e.day === day ? ordered[k++] : e)));
  }

  /* ---- first-run seed (user's push/leg order, sit-ups 4th) ---- */
  const w = (name, day, weight) => ({ id: uid(), name, day, bodyweight: false, sets: 3, reps: 8, weight });
  const bw = (name, day, reps) => ({ id: uid(), name, day, bodyweight: true, sets: 3, reps, weight: 0 });
  // Pull day = back / bicep. Starting weights are placeholders — edit them in Program.
  const pullDefaults = () => [
    w('Lat pulldown', 'pull', 100),
    w('Seated cable row', 'pull', 90),
    w('Dumbbell row', 'pull', 40),
    bw('Sit-ups', 'pull', 10),
    w('Bicep curl', 'pull', 25),
  ];
  const facePull = () => w('Face pull', ALL, 40);
  const pikes = () => bw('Pikes', ALL, 10);
  function seedIfEmpty() {
    if (!read(K.seeded, false)) {
      write(K.seeded, true);
      if (!getExercises().length) {
        saveExercises([
          // Leg day
          w('Dumbbell deadlift', 'leg', 55),
          w('Leg extension', 'leg', 90),
          w('Leg curl', 'leg', 80),
          bw('Sit-ups', 'leg', 10),
          w('Leg press', 'leg', 160),
          bw('Calf raise', 'leg', 20),
          // Push day = chest / shoulders / tricep
          w('Push press', 'push', 120),
          w('Incline dumbbell flies', 'push', 40),
          w('Shoulder raise', 'push', 20),
          bw('Sit-ups', 'push', 10),
          w('Shoulder press', 'push', 40),
          w('Tricep pulldown', 'push', 80),
          ...pullDefaults(),
          // Every day
          facePull(),
          pikes(),
        ]);
        write(K.schema, SCHEMA);
      }
    }
    migrate();
  }

  function migrate() {
    const v = read(K.schema, 0);
    if (v >= SCHEMA) return;
    // Schema 5: the pull-up auto-progression is gone; Leg/Push/Pull days log every set.
    // Finished legacy sessions stay as-is (doneSets() reads them); an in-progress legacy
    // workout is converted so it can be continued.
    if (v < 5) {
      localStorage.removeItem(K.pullups);
      if (!getExercisesByDay('pull').length) saveExercises(getExercises().concat(pullDefaults()));
      const a = getActive();
      if (a && a.entries.some(e => !Array.isArray(e.sets))) {
        delete a.pullups;
        a.entries = a.entries.map(e => Array.isArray(e.sets) ? e : {
          exerciseId: e.exerciseId, name: e.name, unit: e.unit, bodyweight: !!e.bodyweight, targetReps: e.targetReps,
          weight: e.weight, nextWeight: (typeof e.nextWeight === 'number' && e.nextWeight !== e.weight) ? e.nextWeight : null,
          sets: Array.from({ length: e.targetSets || 3 }, (_, i) => ({ weight: e.weight, reps: i < e.done ? e.targetReps : null })),
        });
        setActive(a);
      }
    }
    // Schema 6: Face pull and Pikes become every-day exercises.
    if (v < 6) { makeEveryDay('facepull', facePull); makeEveryDay('pike', pikes); }
    write(K.schema, SCHEMA);
  }

  // Turn the exercise named like `key` into one every-day record (adding `fallback()` if
  // none exists). Copies on several days merge into the first; their history is
  // re-pointed at it so "Last" and Stats keep the whole record.
  const nameKey = (n) => String(n).toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
  function makeEveryDay(key, fallback) {
    const list = getExercises();
    const matches = list.filter(e => nameKey(e.name) === key);
    if (!matches.length) { saveExercises(list.concat(fallback())); return; }
    const keep = matches[0];
    const drop = new Set(matches.slice(1).map(e => e.id));
    keep.day = ALL;
    saveExercises(list.filter(e => !drop.has(e.id)));
    if (!drop.size) return;
    const repoint = (entries) => entries.forEach(e => { if (drop.has(e.exerciseId)) e.exerciseId = keep.id; });
    const ss = getSessions(); ss.forEach(s => repoint(s.entries)); saveSessions(ss);
    const a = getActive(); if (a) { repoint(a.entries); setActive(a); }
  }

  /* ---- sessions ---- */
  const getSessions = () => read(K.sessions, []);
  const saveSessions = (l) => write(K.sessions, l);
  const deleteSession = (id) => saveSessions(getSessions().filter(s => s.id !== id));

  // Logged sets of an entry. Legacy entries stored only a `done` set count at one
  // weight × targetReps, so expand those into equivalent sets.
  const doneSets = (e) => Array.isArray(e.sets)
    ? e.sets.filter(s => s.reps > 0)
    : Array.from({ length: e.done || 0 }, () => ({ weight: e.weight, reps: e.targetReps }));
  const repsOf = (e) => doneSets(e).reduce((n, s) => n + s.reps, 0);
  // A session's entries for display and totals. Legacy sessions also carried a pull-up
  // block; surface it as a bodyweight entry so its reps count like any other.
  const sessionEntries = (s) => (s.pullups && s.pullups.done > 0)
    ? [{ exerciseId: null, name: 'Pull-ups', unit: '', bodyweight: true, targetReps: s.pullups.targetReps, done: s.pullups.done }, ...s.entries]
    : s.entries;
  const topWeight = (e) => {
    const ws = doneSets(e).map(s => s.weight).filter(x => typeof x === 'number');
    return ws.length ? Math.max(...ws) : null;
  };
  // Weight the exercise starts at next workout: the "Next time" value if one was set,
  // else the heaviest set logged, else unchanged.
  const nextWeightOf = (e) => {
    if (typeof e.nextWeight === 'number') return e.nextWeight;
    const t = topWeight(e);
    return t != null ? t : e.weight;
  };

  /* ---- active session ---- */
  const getActive = () => read(K.active, null);
  const setActive = (s) => { if (s) write(K.active, s); else localStorage.removeItem(K.active); };
  const discardActive = () => setActive(null);

  function startSession(day) {
    const u = getSettings().unit;
    const session = {
      id: uid(), date: nowISO(), startedAt: nowISO(), finishedAt: null, day,
      entries: getWorkoutExercises(day).map(e => {
        const wt = e.bodyweight ? null : e.weight;
        return {
          exerciseId: e.id, name: e.name, unit: u, bodyweight: !!e.bodyweight, targetReps: e.reps,
          weight: wt, nextWeight: null,
          sets: Array.from({ length: e.sets || 3 }, () => ({ weight: wt, reps: null })),
        };
      }),
    };
    setActive(session);
    return session;
  }

  function finishActive() {
    const a = getActive();
    if (!a) return null;
    if (!a.entries.some(e => doneSets(e).length)) { setActive(null); return null; }

    a.finishedAt = nowISO();
    // Carry each exercise's next-workout weight forward, then keep only the logged sets.
    const list = getExercises();
    let changed = false;
    a.entries.forEach(en => {
      const ex = list.find(x => x.id === en.exerciseId);
      const nw = nextWeightOf(en);
      if (ex && !ex.bodyweight && typeof nw === 'number' && ex.weight !== nw) { ex.weight = nw; changed = true; }
      en.sets = doneSets(en);
    });
    if (changed) saveExercises(list);

    const ss = getSessions(); ss.unshift(a); saveSessions(ss);
    setActive(null);
    return a;
  }

  /* ---- progress lookups ---- */
  function lastPerformance(exerciseId) {
    for (const s of getSessions()) {
      const e = s.entries.find(x => x.exerciseId === exerciseId && doneSets(x).length);
      if (e) return { date: s.date, entry: e };
    }
    return null;
  }
  // Oldest -> newest series for charts.
  function exerciseSeries(exerciseId) {
    const out = [];
    for (const s of getSessions()) {
      const e = s.entries.find(x => x.exerciseId === exerciseId && doneSets(x).length);
      if (e) out.push({ date: s.date, weight: e.bodyweight ? null : topWeight(e), reps: repsOf(e), bodyweight: e.bodyweight });
    }
    return out.reverse();
  }
  // Galaxy stars: every rep in History, legacy workouts (and their pull-ups) included.
  function totalReps() {
    let n = 0;
    for (const s of getSessions()) for (const e of sessionEntries(s)) n += repsOf(e);
    return n;
  }

  /* ---- backup ---- */
  const exportAll = () => ({ app: 'Augie Swole', version: SCHEMA, exportedAt: nowISO(),
    settings: getSettings(), exercises: getExercises(), sessions: getSessions(), active: getActive() });
  function importAll(data) {
    // Accept both the current name and the historical 'RepLog' sentinel so old backups still import.
    if (!data || (data.app !== 'Augie Swole' && data.app !== 'RepLog')) throw new Error('Not an Augie Swole backup file.');
    if (data.settings) saveSettings(data.settings);
    if (Array.isArray(data.exercises)) saveExercises(data.exercises);
    if (Array.isArray(data.sessions)) saveSessions(data.sessions);
    setActive(data.active || null);
    write(K.seeded, true);
    // Older backups predate later schema steps: upgrade them the same way as stored data.
    write(K.schema, Math.min(Number(data.version) || 0, SCHEMA));
    migrate();
  }
  const clearAll = () => Object.values(K).forEach(k => localStorage.removeItem(k));

  return {
    DAYS, ALL, uid, getSettings, saveSettings,
    getExercises, getExercisesByDay, getWorkoutExercises, getExercise, upsertExercise, deleteExercise, newExercise, reorderDay,
    seedIfEmpty,
    getSessions, deleteSession, doneSets, repsOf, sessionEntries, nextWeightOf,
    getActive, setActive, discardActive, startSession, finishActive,
    lastPerformance, exerciseSeries, totalReps,
    exportAll, importAll, clearAll,
  };
})();
