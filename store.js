/* store.js — RepLog data layer (localStorage, single device, no server).
 *
 * Program model:
 *   - Pull-ups: ONE global auto-progression done every workout.
 *       level = { sets, reps }; success advances: sets 10->20, then reps+1 & sets->10.
 *   - Two day templates: 'push' and 'leg', each a customizable accessory list.
 *   - Accessory: { id, name, day, bodyweight, amrap, sets, reps, weight }
 *       Reps/sets are locked per exercise (default 3x8); weight is bumped manually.
 *
 * Session shapes:
 *   pullSet = { done, reps }
 *   accSet  = { done, reps }
 *   entry   = { exerciseId, name, unit, bodyweight, amrap, targetReps, weight, sets:[accSet] }
 *   session = { id, date, startedAt, finishedAt, day, pullups:{targetSets,targetReps,sets:[pullSet]}, entries:[entry] }
 *   Sessions are stored newest-first.
 */
const DB = (() => {
  const K = {
    settings: 'replog.settings',
    program: 'replog.pullups',
    exercises: 'replog.exercises',
    sessions: 'replog.sessions',
    active: 'replog.active',
    seeded: 'replog.seeded',
  };

  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nowISO = () => new Date().toISOString();

  /* ---- settings ---- */
  const defaultSettings = { unit: 'lb' };
  const getSettings = () => Object.assign({}, defaultSettings, read(K.settings, {}));
  const saveSettings = (s) => write(K.settings, s);

  /* ---- pull-up program (global) ---- */
  const defaultProgram = { sets: 10, reps: 3 };
  const getProgram = () => Object.assign({}, defaultProgram, read(K.program, {}));
  const saveProgram = (p) => write(K.program, { sets: p.sets, reps: p.reps });
  // The level after a SUCCESSFUL workout.
  const nextLevel = ({ sets, reps }) => (sets < 20 ? { sets: sets + 1, reps } : { sets: 10, reps: reps + 1 });
  const prevLevel = ({ sets, reps }) => (sets > 10 ? { sets: sets - 1, reps } : { sets: 20, reps: Math.max(1, reps - 1) });

  /* ---- accessory exercises ---- */
  const getExercises = () => read(K.exercises, []);
  const saveExercises = (list) => write(K.exercises, list);
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
  const newExercise = (day) => ({ id: uid(), name: '', day, bodyweight: false, amrap: false, sets: 3, reps: 8, weight: 0 });

  /* ---- first-run seed (corrected push/leg mapping) ---- */
  function seedIfEmpty() {
    if (read(K.seeded, false)) return;
    write(K.seeded, true);
    if (getExercises().length) return;
    const w = (name, day, weight) => ({ id: uid(), name, day, bodyweight: false, amrap: false, sets: 3, reps: 8, weight });
    const situps = (day) => ({ id: uid(), name: 'Sit-ups', day, bodyweight: true, amrap: false, sets: 3, reps: 10, weight: 0 });
    const calf = (day) => ({ id: uid(), name: 'Calf raise', day, bodyweight: true, amrap: true, sets: 3, reps: 0, weight: 0 });
    const seed = [
      // Push day = chest / shoulders / tricep
      w('Push press', 'push', 120),
      w('Incline dumbbell flies', 'push', 40),
      w('Shoulder raise', 'push', 20),
      situps('push'),
      w('Shoulder press', 'push', 40),
      w('Tricep pulldown', 'push', 80),
      // Leg day
      w('Dumbbell deadlift', 'leg', 55),
      w('Leg extension', 'leg', 90),
      w('Leg curl', 'leg', 80),
      situps('leg'),
      w('Leg press', 'leg', 160),
      calf('leg'),
    ];
    saveExercises(seed);
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
    const unit = getSettings().unit;
    const session = {
      id: uid(), date: nowISO(), startedAt: nowISO(), finishedAt: null, day,
      pullups: {
        targetSets: prog.sets, targetReps: prog.reps,
        sets: Array.from({ length: prog.sets }, () => ({ done: false, reps: prog.reps })),
      },
      entries: getExercisesByDay(day).map(e => ({
        exerciseId: e.id, name: e.name, unit, bodyweight: !!e.bodyweight, amrap: !!e.amrap,
        targetReps: e.reps, weight: e.bodyweight ? null : e.weight,
        sets: Array.from({ length: e.sets }, () => ({ done: false, reps: e.amrap ? 0 : e.reps })),
      })),
    };
    setActive(session);
    return session;
  }

  const pullupsComplete = (s) => s.pullups.sets.length > 0 && s.pullups.sets.every(x => x.done);

  /* Finish: advance pull-ups on success, persist accessory weights, archive session. */
  function finishActive() {
    const a = getActive();
    if (!a) return null;
    a.finishedAt = nowISO();

    if (pullupsComplete(a)) saveProgram(nextLevel({ sets: a.pullups.targetSets, reps: a.pullups.targetReps }));

    // Carry whatever weight was used this session back as the new working weight.
    const list = getExercises();
    let changed = false;
    a.entries.forEach(en => {
      const ex = list.find(x => x.id === en.exerciseId);
      if (ex && !ex.bodyweight && typeof en.weight === 'number' && ex.weight !== en.weight) { ex.weight = en.weight; changed = true; }
    });
    if (changed) saveExercises(list);

    const hasWork = a.pullups.sets.some(x => x.done) || a.entries.some(e => e.sets.some(x => x.done));
    if (hasWork) { const ss = getSessions(); ss.unshift(a); saveSessions(ss); }
    setActive(null);
    return hasWork ? a : null;
  }

  /* ---- progress lookups ---- */
  function lastPerformance(exerciseId) {
    for (const s of getSessions()) {
      const e = s.entries.find(x => x.exerciseId === exerciseId && x.sets.some(z => z.done));
      if (e) return { date: s.date, entry: e };
    }
    return null;
  }
  function lastPullups() {
    for (const s of getSessions()) if (s.pullups && s.pullups.sets.some(x => x.done))
      return { date: s.date, sets: s.pullups.targetSets, reps: s.pullups.targetReps, done: s.pullups.sets.filter(x => x.done).length };
    return null;
  }

  /* ---- backup ---- */
  const exportAll = () => ({ app: 'RepLog', version: 2, exportedAt: nowISO(),
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
    getExercises, getExercisesByDay, getExercise, upsertExercise, deleteExercise, newExercise, seedIfEmpty,
    getSessions, deleteSession,
    getActive, setActive, discardActive, startSession, finishActive, pullupsComplete,
    lastPerformance, lastPullups,
    exportAll, importAll, clearAll,
  };
})();
