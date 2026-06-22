/* store.js — RepLog data layer.
 * Everything is persisted in localStorage on this device. No server, no accounts.
 * Shapes:
 *   exercise = { id, name, unit }                 unit: 'kg' | 'lb' | 'bw'
 *   set      = { targetReps, weight, doneReps, completed }
 *   entry    = { exerciseId, exerciseName, unit, sets: [set] }
 *   session  = { id, date, startedAt, finishedAt, entries: [entry] }
 *   Sessions are stored newest-first.
 */
const DB = (() => {
  const K = {
    exercises: 'replog.exercises',
    sessions:  'replog.sessions',
    active:    'replog.active',
    settings:  'replog.settings',
    seeded:    'replog.seeded',
  };

  const read = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---- settings ---- */
  const defaultSettings = { unit: 'kg', restSeconds: 90 };
  const getSettings = () => Object.assign({}, defaultSettings, read(K.settings, {}));
  const saveSettings = (s) => write(K.settings, s);

  /* ---- exercise library ---- */
  const getExercises = () => read(K.exercises, []);
  const saveExercises = (list) => write(K.exercises, list);
  function addExercise(name, unit) {
    name = (name || '').trim();
    if (!name) return null;
    const list = getExercises();
    const existing = list.find(e => e.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const ex = { id: uid(), name, unit: unit || getSettings().unit };
    list.push(ex);
    list.sort((a, b) => a.name.localeCompare(b.name));
    saveExercises(list);
    return ex;
  }
  const deleteExercise = (id) => saveExercises(getExercises().filter(e => e.id !== id));

  /* Seed a small starter library on very first run (user can delete any). */
  function seedIfEmpty() {
    if (read(K.seeded, false)) return;
    write(K.seeded, true);
    if (getExercises().length === 0) {
      ['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pull-Up']
        .forEach(n => addExercise(n, n === 'Pull-Up' ? 'bw' : getSettings().unit));
    }
  }

  /* ---- sessions (history) ---- */
  const getSessions = () => read(K.sessions, []);
  const saveSessions = (list) => write(K.sessions, list);
  const deleteSession = (id) => saveSessions(getSessions().filter(s => s.id !== id));

  /* ---- active (in-progress) session ---- */
  const getActive = () => read(K.active, null);
  const setActive = (s) => { if (s) write(K.active, s); else localStorage.removeItem(K.active); };

  function startSession() {
    const now = new Date();
    const s = { id: uid(), date: now.toISOString(), startedAt: now.toISOString(),
                finishedAt: null, entries: [] };
    setActive(s);
    return s;
  }

  /* Finish: move active into history (only if it has at least one completed set). */
  function finishActive() {
    const a = getActive();
    if (!a) return null;
    a.finishedAt = new Date().toISOString();
    const hasWork = a.entries.some(e => e.sets.some(s => s.completed));
    if (hasWork) {
      const sessions = getSessions();
      sessions.unshift(a);
      saveSessions(sessions);
    }
    setActive(null);
    return hasWork ? a : null;
  }
  const discardActive = () => setActive(null);

  /* ---- progress lookups ---- */
  // Most recent finished performance of an exercise: { date, entry } or null.
  function lastPerformance(exerciseId) {
    for (const s of getSessions()) {
      const entry = s.entries.find(e => e.exerciseId === exerciseId && e.sets.some(x => x.completed));
      if (entry) return { date: s.date, entry };
    }
    return null;
  }
  // Full history of an exercise, newest-first: [{ date, sets }]
  function exerciseHistory(exerciseId) {
    const out = [];
    for (const s of getSessions()) {
      const entry = s.entries.find(e => e.exerciseId === exerciseId);
      if (entry) out.push({ date: s.date, sets: entry.sets.filter(x => x.completed) });
    }
    return out.filter(h => h.sets.length);
  }
  // Best single-set weight ever lifted (a simple PR), or null.
  function bestWeight(exerciseId) {
    let best = null;
    for (const s of getSessions()) {
      const entry = s.entries.find(e => e.exerciseId === exerciseId);
      if (!entry) continue;
      for (const set of entry.sets) {
        if (set.completed && typeof set.weight === 'number' && (best == null || set.weight > best))
          best = set.weight;
      }
    }
    return best;
  }

  /* ---- backup ---- */
  function exportAll() {
    return { app: 'RepLog', version: 1, exportedAt: new Date().toISOString(),
             exercises: getExercises(), sessions: getSessions(),
             settings: getSettings(), active: getActive() };
  }
  function importAll(data) {
    if (!data || data.app !== 'RepLog') throw new Error('Not a RepLog backup file.');
    if (Array.isArray(data.exercises)) saveExercises(data.exercises);
    if (Array.isArray(data.sessions))  saveSessions(data.sessions);
    if (data.settings) saveSettings(data.settings);
    setActive(data.active || null);
    write(K.seeded, true);
  }
  function clearAll() { Object.values(K).forEach(k => localStorage.removeItem(k)); }

  return {
    uid, getSettings, saveSettings,
    getExercises, addExercise, deleteExercise, seedIfEmpty,
    getSessions, deleteSession,
    getActive, setActive, startSession, finishActive, discardActive,
    lastPerformance, exerciseHistory, bestWeight,
    exportAll, importAll, clearAll,
  };
})();
