/* store.js — RepLog data layer (localStorage, single device, no server).
 *
 * Program:
 *   - Pull-ups: ONE global auto-progression done every workout.
 *       level = { sets, reps }; a fully-completed workout advances: sets 10->20,
 *       then reps+1 and sets->10.
 *   - Two day templates: 'push' and 'leg', each an ordered, customizable list.
 *       Number of accessories actually done = floor(pullupSets / 3) (the first N in
 *       order), so there is always something to do between pull-up sets, no more.
 *   - Accessory = { id, name, day, bodyweight, sets, reps, weight }. Sets/reps are
 *       configurable (default 3x8); weight is bumped manually.
 *
 * Session (everything counted by SETS, not reps):
 *   entry   = { exerciseId, name, unit, bodyweight, targetSets, targetReps, weight, done }
 *   session = { id, date, startedAt, finishedAt, day, pullups:{targetSets,targetReps,done}, entries:[entry] }
 *   `done` = number of completed sets. Stored newest-first.
 */
const DB = (() => {
  const K = {
    settings: 'replog.settings', program: 'replog.pullups', exercises: 'replog.exercises',
    sessions: 'replog.sessions', active: 'replog.active', seeded: 'replog.seeded',
  };
  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();

  /* ---- settings ---- */
  const defaultSettings = { unit: 'lb' };
  const getSettings = () => Object.assign({}, defaultSettings, read(K.settings, {}));
  const saveSettings = (s) => write(K.settings, s);

  /* ---- pull-up program ---- */
  const defaultProgram = { sets: 10, reps: 3 };
  const getProgram = () => Object.assign({}, defaultProgram, read(K.program, {}));
  const saveProgram = (p) => write(K.program, { sets: p.sets, reps: p.reps });
  const nextLevel = ({ sets, reps }) => (sets < 20 ? { sets: sets + 1, reps } : { sets: 10, reps: reps + 1 });
  const prevLevel = ({ sets, reps }) => (sets > 10 ? { sets: sets - 1, reps } : { sets: 20, reps: Math.max(1, reps - 1) });

  /* ---- accessory exercises ---- */
  const getExercises = () => read(K.exercises, []);
  const saveExercises = (l) => write(K.exercises, l);
  const getExercisesByDay = (day) => getExercises().filter(e => e.day === day);
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

  // How many accessories to do for a given pull-up set count, and which ones (first N in order).
  const exerciseCountForSets = (sets) => Math.max(0, Math.floor((sets || 0) / 3));
  function plannedExercises(day, sets) {
    const list = getExercisesByDay(day);
    const target = sets == null ? getProgram().sets : sets;
    return list.slice(0, Math.min(exerciseCountForSets(target), list.length));
  }

  /* ---- first-run seed (corrected push/leg mapping, user's order, sit-ups 4th) ---- */
  function seedIfEmpty() {
    if (read(K.seeded, false)) return;
    write(K.seeded, true);
    if (getExercises().length) return;
    const w = (name, day, weight) => ({ id: uid(), name, day, bodyweight: false, sets: 3, reps: 8, weight });
    const bw = (name, day, reps) => ({ id: uid(), name, day, bodyweight: true, sets: 3, reps, weight: 0 });
    saveExercises([
      // Push day = chest / shoulders / tricep
      w('Push press', 'push', 120),
      w('Incline dumbbell flies', 'push', 40),
      w('Shoulder raise', 'push', 20),
      bw('Sit-ups', 'push', 10),
      w('Shoulder press', 'push', 40),
      w('Tricep pulldown', 'push', 80),
      // Leg day
      w('Dumbbell deadlift', 'leg', 55),
      w('Leg extension', 'leg', 90),
      w('Leg curl', 'leg', 80),
      bw('Sit-ups', 'leg', 10),
      w('Leg press', 'leg', 160),
      bw('Calf raise', 'leg', 20),
    ]);
  }

  /* ---- sessions ---- */
  const getSessions = () => read(K.sessions, []);
  const saveSessions = (l) => write(K.sessions, l);
  const deleteSession = (id) => saveSessions(getSessions().filter(s => s.id !== id));

  /* ---- active session ---- */
  const getActive = () => read(K.active, null);
  const setActive = (s) => { if (s) write(K.active, s); else localStorage.removeItem(K.active); };
  const discardActive = () => setActive(null);

  function startSession(day) {
    const prog = getProgram();
    const u = getSettings().unit;
    const session = {
      id: uid(), date: nowISO(), startedAt: nowISO(), finishedAt: null, day,
      pullups: { targetSets: prog.sets, targetReps: prog.reps, done: 0 },
      entries: plannedExercises(day, prog.sets).map(e => ({
        exerciseId: e.id, name: e.name, unit: u, bodyweight: !!e.bodyweight,
        targetSets: e.sets, targetReps: e.reps, weight: e.bodyweight ? null : e.weight, done: 0,
      })),
    };
    setActive(session);
    return session;
  }

  const pullupsComplete = (s) => s.pullups.targetSets > 0 && s.pullups.done >= s.pullups.targetSets;

  function finishActive() {
    const a = getActive();
    if (!a) return null;
    a.finishedAt = nowISO();
    if (pullupsComplete(a)) saveProgram(nextLevel({ sets: a.pullups.targetSets, reps: a.pullups.targetReps }));

    // Carry the weight used this session back as the new working weight.
    const list = getExercises();
    let changed = false;
    a.entries.forEach(en => {
      const ex = list.find(x => x.id === en.exerciseId);
      if (ex && !ex.bodyweight && typeof en.weight === 'number' && ex.weight !== en.weight) { ex.weight = en.weight; changed = true; }
    });
    if (changed) saveExercises(list);

    const hasWork = a.pullups.done > 0 || a.entries.some(e => e.done > 0);
    if (hasWork) { const ss = getSessions(); ss.unshift(a); saveSessions(ss); }
    setActive(null);
    return hasWork ? a : null;
  }

  /* ---- progress lookups ---- */
  function lastPerformance(exerciseId) {
    for (const s of getSessions()) {
      const e = s.entries.find(x => x.exerciseId === exerciseId && x.done > 0);
      if (e) return { date: s.date, entry: e };
    }
    return null;
  }
  // Oldest -> newest series for charts.
  function exerciseSeries(exerciseId) {
    const out = [];
    for (const s of getSessions()) {
      const e = s.entries.find(x => x.exerciseId === exerciseId && x.done > 0);
      if (e) out.push({ date: s.date, weight: e.bodyweight ? null : e.weight, done: e.done, reps: e.targetReps, bodyweight: e.bodyweight });
    }
    return out.reverse();
  }
  function pullupSeries() {
    const out = [];
    for (const s of getSessions()) if (s.pullups && s.pullups.done > 0)
      out.push({ date: s.date, sets: s.pullups.done, reps: s.pullups.targetReps, total: s.pullups.done * s.pullups.targetReps });
    return out.reverse();
  }

  /* ---- backup ---- */
  const exportAll = () => ({ app: 'RepLog', version: 3, exportedAt: nowISO(),
    settings: getSettings(), program: getProgram(), exercises: getExercises(), sessions: getSessions(), active: getActive() });
  function importAll(data) {
    if (!data || data.app !== 'RepLog') throw new Error('Not a RepLog backup file.');
    if (data.settings) saveSettings(data.settings);
    if (data.program) saveProgram(data.program);
    if (Array.isArray(data.exercises)) saveExercises(data.exercises);
    if (Array.isArray(data.sessions)) saveSessions(data.sessions);
    setActive(data.active || null);
    write(K.seeded, true);
  }
  const clearAll = () => Object.values(K).forEach(k => localStorage.removeItem(k));

  return {
    uid, getSettings, saveSettings,
    getProgram, saveProgram, nextLevel, prevLevel,
    getExercises, getExercisesByDay, getExercise, upsertExercise, deleteExercise, newExercise,
    exerciseCountForSets, plannedExercises, seedIfEmpty,
    getSessions, deleteSession,
    getActive, setActive, discardActive, startSession, finishActive, pullupsComplete,
    lastPerformance, exerciseSeries, pullupSeries,
    exportAll, importAll, clearAll,
  };
})();
