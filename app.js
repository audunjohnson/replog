/* app.js — RepLog UI. Vanilla JS, no framework, no build step. */
(() => {
  'use strict';

  const content = document.getElementById('content');
  const tabbar  = document.getElementById('tabbar');
  let view = 'workout';

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtDate(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d);  that.setHours(0, 0, 0, 0);
    const days = Math.round((today - that) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Display one set, e.g. "60kg × 10", "BW × 8", "BW+10kg × 6".
  function fmtSet(set, unit) {
    const reps = set.doneReps || set.targetReps || 0;
    if (unit === 'bw') return (set.weight ? `BW+${set.weight}kg` : 'BW') + ` × ${reps}`;
    return (set.weight !== '' && set.weight != null ? `${set.weight}${unit}` : '—') + ` × ${reps}`;
  }
  const fmtSets = (sets, unit) => sets.map(s => fmtSet(s, unit)).join(',  ');

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  /* small beep via WebAudio (rest-timer end) */
  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      o.start(); o.stop(audioCtx.currentTime + 0.42);
    } catch {}
  }

  /* ---------------- rest timer (persistent bar) ---------------- */
  const restBar = document.getElementById('rest-bar');
  const restTime = document.getElementById('rest-time');
  const restLabel = document.getElementById('rest-label');
  let rest = null; // { remaining, interval }

  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

  function renderRest() {
    if (!rest) { restBar.hidden = true; return; }
    restBar.hidden = false;
    restTime.textContent = mmss(rest.remaining);
    restBar.classList.toggle('done', rest.remaining <= 0);
    restLabel.textContent = rest.remaining <= 0 ? 'Ready' : 'Rest';
  }
  function startRest(seconds) {
    stopRest();
    rest = { remaining: seconds, interval: setInterval(tickRest, 1000) };
    renderRest();
  }
  function tickRest() {
    if (!rest) return;
    rest.remaining -= 1;
    if (rest.remaining === 0) { beep(); haptic([120, 60, 120]); }
    if (rest.remaining <= -2) { stopRest(); return; }
    renderRest();
  }
  function stopRest() { if (rest) clearInterval(rest.interval); rest = null; renderRest(); }
  function adjustRest(delta) {
    if (!rest) return;
    rest.remaining = Math.max(0, rest.remaining + delta);
    renderRest();
  }
  document.getElementById('rest-skip').onclick  = stopRest;
  document.getElementById('rest-plus').onclick  = () => adjustRest(15);
  document.getElementById('rest-minus').onclick = () => adjustRest(-15);

  /* ---------------- top-level render ---------------- */
  function render() {
    [...tabbar.children].forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    if (view === 'workout')   content.innerHTML = renderWorkout();
    if (view === 'history')   content.innerHTML = renderHistory();
    if (view === 'exercises') content.innerHTML = renderExercises();
    if (view === 'settings')  content.innerHTML = renderSettings();
    content.scrollTop = 0;
  }

  /* ---------------- WORKOUT view ---------------- */
  function renderWorkout() {
    const active = DB.getActive();
    if (!active) {
      const last = DB.getSessions()[0];
      const lastHtml = last ? `
        <div class="card muted-card">
          <div class="card-title">Last workout · ${esc(fmtDate(last.date))}</div>
          ${last.entries.filter(e => e.sets.some(s => s.completed)).map(e =>
            `<div class="row-line"><b>${esc(e.exerciseName)}</b><span>${esc(fmtSets(e.sets.filter(s => s.completed), e.unit))}</span></div>`
          ).join('') || '<div class="dim">No sets logged.</div>'}
        </div>` : '';
      return `
        <header class="hdr"><h1>RepLog</h1></header>
        <div class="start-wrap">
          <button class="big-btn" data-action="start-workout">＋ Start workout</button>
          ${lastHtml}
        </div>`;
    }

    const entriesHtml = active.entries.map((e, i) => renderEntry(e, i)).join('');
    const elapsed = active.startedAt ? Math.round((Date.now() - new Date(active.startedAt)) / 60000) : 0;
    const doneSets = active.entries.reduce((n, e) => n + e.sets.filter(s => s.completed).length, 0);

    return `
      <header class="hdr">
        <h1>Workout</h1>
        <div class="hdr-sub">${esc(fmtDate(active.date))} · ${elapsed} min · ${plural(doneSets, 'set')}</div>
      </header>
      <div class="entries">
        ${entriesHtml || '<div class="dim center">No exercises yet. Add one to begin.</div>'}
      </div>
      <button class="add-ex-btn" data-action="open-add-exercise">＋ Add exercise</button>
      <div class="finish-row">
        <button class="ghost-btn danger" data-action="discard-workout">Discard</button>
        <button class="big-btn finish" data-action="finish-workout">Finish workout</button>
      </div>`;
  }

  function renderEntry(entry, idx) {
    const unit = entry.unit;
    const activeSetIdx = entry.sets.findIndex(s => !s.completed);
    const last = DB.lastPerformance(entry.exerciseId);
    const lastLine = last
      ? `<div class="last-line">Last · ${esc(fmtDate(last.date))}: ${esc(fmtSets(last.entry.sets.filter(s => s.completed), unit))}</div>`
      : `<div class="last-line dim">No history yet</div>`;

    const setsHtml = entry.sets.map((s, si) => {
      if (s.completed) {
        return `<div class="set-row done" data-action="uncomplete-set" data-e="${idx}" data-s="${si}">
            <span class="set-num">${si + 1}</span>
            <span class="set-sum">${esc(fmtSet(s, unit))}</span>
            <span class="set-check">✓</span>
          </div>`;
      }
      if (si === activeSetIdx) return renderActiveSet(s, idx, si, unit);
      // upcoming (not yet active)
      return `<div class="set-row upcoming">
          <span class="set-num">${si + 1}</span>
          <span class="set-sum dim">target ${s.targetReps} reps</span>
          <button class="x-btn" data-action="remove-set" data-e="${idx}" data-s="${si}" aria-label="Remove set">✕</button>
        </div>`;
    }).join('');

    return `
      <div class="card entry" data-e="${idx}">
        <div class="entry-head">
          <div class="entry-title">${esc(entry.exerciseName)}</div>
          <button class="x-btn" data-action="remove-entry" data-e="${idx}" aria-label="Remove exercise">✕</button>
        </div>
        ${lastLine}
        <div class="sets">${setsHtml}</div>
        <button class="add-set-btn" data-action="add-set" data-e="${idx}">＋ Add set</button>
      </div>`;
  }

  function renderActiveSet(s, e, si, unit) {
    const target = s.targetReps || 0;
    const pct = target ? Math.min(100, Math.round((s.doneReps / target) * 100)) : 0;
    const weightLabel = unit === 'bw' ? 'Added kg' : `Weight (${unit})`;
    return `
      <div class="active-set" data-e="${e}" data-s="${si}">
        <div class="active-controls">
          <label class="field">
            <span>${esc(weightLabel)}</span>
            <input type="number" inputmode="decimal" step="0.5" min="0" class="weight-in"
                   data-action="set-weight" data-e="${e}" data-s="${si}"
                   value="${s.weight === '' || s.weight == null ? '' : s.weight}"
                   placeholder="${unit === 'bw' ? 'BW' : '0'}">
          </label>
          <label class="field">
            <span>Target reps</span>
            <input type="number" inputmode="numeric" step="1" min="0" class="target-in"
                   data-action="set-target" data-e="${e}" data-s="${si}" value="${target}">
          </label>
        </div>
        <button class="rep-counter" data-action="rep-inc" data-e="${e}" data-s="${si}"
                style="--pct:${pct}">
          <span class="rep-now">${s.doneReps}</span>
          <span class="rep-of">of ${target} reps</span>
          <span class="rep-tap">tap to count</span>
        </button>
        <div class="rep-actions">
          <button class="rep-minus" data-action="rep-dec" data-e="${e}" data-s="${si}">−1</button>
          <button class="done-set" data-action="complete-set" data-e="${e}" data-s="${si}">Done set ✓</button>
        </div>
      </div>`;
  }

  /* ---------------- HISTORY view ---------------- */
  let openSession = null;
  function renderHistory() {
    const sessions = DB.getSessions();
    if (!sessions.length)
      return `<header class="hdr"><h1>History</h1></header>
              <div class="dim center pad">No finished workouts yet.</div>`;
    const items = sessions.map(s => {
      const sets = s.entries.reduce((n, e) => n + e.sets.filter(x => x.completed).length, 0);
      const vol = s.entries.reduce((v, e) => v + e.sets.reduce((a, x) =>
        a + (x.completed ? (Number(x.weight) || 0) * (x.doneReps || 0) : 0), 0), 0);
      const open = openSession === s.id;
      const body = open ? `<div class="sess-body">${
        s.entries.filter(e => e.sets.some(x => x.completed)).map(e =>
          `<div class="row-line"><b>${esc(e.exerciseName)}</b><span>${esc(fmtSets(e.sets.filter(x => x.completed), e.unit))}</span></div>`
        ).join('')
      }<button class="ghost-btn danger small" data-action="delete-session" data-id="${s.id}">Delete</button></div>` : '';
      return `<div class="card sess ${open ? 'open' : ''}">
          <div class="sess-head" data-action="toggle-session" data-id="${s.id}">
            <div><div class="card-title">${esc(fmtDate(s.date))}</div>
              <div class="dim small">${plural(sets, 'set')} · ${Math.round(vol)} volume</div></div>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </div>${body}
        </div>`;
    }).join('');
    return `<header class="hdr"><h1>History</h1></header><div class="list">${items}</div>`;
  }

  /* ---------------- EXERCISES view ---------------- */
  let openExercise = null;
  function renderExercises() {
    const list = DB.getExercises();
    const rows = list.map(ex => {
      const best = DB.bestWeight(ex.id);
      const open = openExercise === ex.id;
      let body = '';
      if (open) {
        const hist = DB.exerciseHistory(ex.id);
        body = `<div class="sess-body">
          ${best != null ? `<div class="dim small">Best set: ${best}${ex.unit === 'bw' ? 'kg added' : ex.unit}</div>` : ''}
          ${hist.length ? hist.map(h =>
            `<div class="row-line"><b>${esc(fmtDate(h.date))}</b><span>${esc(fmtSets(h.sets, ex.unit))}</span></div>`).join('')
            : '<div class="dim">No history yet.</div>'}
          <button class="ghost-btn danger small" data-action="delete-exercise" data-id="${ex.id}">Delete exercise</button>
        </div>`;
      }
      return `<div class="card sess ${open ? 'open' : ''}">
          <div class="sess-head" data-action="toggle-exercise" data-id="${ex.id}">
            <div><div class="card-title">${esc(ex.name)}</div>
              <div class="dim small">${ex.unit === 'bw' ? 'bodyweight' : ex.unit}${best != null ? ' · best ' + best + (ex.unit === 'bw' ? 'kg' : ex.unit) : ''}</div></div>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </div>${body}
        </div>`;
    }).join('');
    return `
      <header class="hdr"><h1>Exercises</h1></header>
      <div class="add-ex-form">
        <input id="new-ex-name" type="text" placeholder="New exercise name" autocomplete="off">
        <select id="new-ex-unit">
          <option value="kg">kg</option><option value="lb">lb</option><option value="bw">bodyweight</option>
        </select>
        <button class="ghost-btn" data-action="add-exercise">Add</button>
      </div>
      <div class="list">${rows || '<div class="dim center pad">No exercises. Add one above.</div>'}</div>`;
  }

  /* ---------------- SETTINGS / BACKUP view ---------------- */
  function renderSettings() {
    const s = DB.getSettings();
    return `
      <header class="hdr"><h1>Backup &amp; Settings</h1></header>
      <div class="card">
        <div class="card-title">Defaults</div>
        <label class="field row-field"><span>Default unit</span>
          <select id="set-unit" data-action="save-unit">
            <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
            <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option>
          </select></label>
        <label class="field row-field"><span>Rest timer (seconds)</span>
          <input type="number" id="set-rest" data-action="save-rest" min="0" step="5" value="${s.restSeconds}"></label>
      </div>
      <div class="card">
        <div class="card-title">Backup</div>
        <div class="dim small">All your data lives only on this device. Export regularly to keep a copy.</div>
        <div class="btn-col">
          <button class="ghost-btn" data-action="export">⬇ Export data (.json)</button>
          <button class="ghost-btn" data-action="import">⬆ Import data</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
      </div>
      <div class="card">
        <div class="card-title danger">Danger zone</div>
        <button class="ghost-btn danger" data-action="clear">Erase all data</button>
      </div>
      <div class="dim center small pad">RepLog · offline-first · v1</div>`;
  }

  /* ---------------- exercise picker (modal) ---------------- */
  function openPicker() {
    const list = DB.getExercises();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="sheet">
        <div class="sheet-head"><b>Add exercise</b>
          <button class="x-btn" data-close aria-label="Close">✕</button></div>
        <input id="pick-search" type="text" placeholder="Search or type a new name" autocomplete="off">
        <div class="pick-list">
          ${list.map(e => `<button class="pick-item" data-id="${e.id}">${esc(e.name)}
              <span class="dim small">${e.unit === 'bw' ? 'BW' : e.unit}</span></button>`).join('')}
        </div>
        <button class="ghost-btn" id="pick-add-new" hidden></button>
      </div>`;
    document.body.appendChild(ov);
    const search = ov.querySelector('#pick-search');
    const addNew = ov.querySelector('#pick-add-new');
    const close = () => ov.remove();

    ov.addEventListener('click', (ev) => {
      if (ev.target === ov || ev.target.hasAttribute('data-close')) return close();
      const item = ev.target.closest('.pick-item');
      if (item) { addEntryFromExercise(item.dataset.id); close(); }
    });
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      ov.querySelectorAll('.pick-item').forEach(b =>
        b.hidden = q && !b.textContent.toLowerCase().includes(q));
      const exact = list.some(e => e.name.toLowerCase() === q);
      if (q && !exact) { addNew.hidden = false; addNew.textContent = `＋ Create “${search.value.trim()}”`; }
      else addNew.hidden = true;
    });
    addNew.addEventListener('click', () => {
      const ex = DB.addExercise(search.value, DB.getSettings().unit);
      if (ex) { addEntryFromExercise(ex.id); close(); }
    });
    setTimeout(() => search.focus(), 50);
  }

  function addEntryFromExercise(exerciseId) {
    const ex = DB.getExercises().find(e => e.id === exerciseId);
    if (!ex) return;
    const active = DB.getActive() || DB.startSession();
    const last = DB.lastPerformance(exerciseId);
    let sets;
    if (last) {
      sets = last.entry.sets.filter(s => s.completed).map(s =>
        ({ targetReps: s.doneReps || s.targetReps || 10, weight: s.weight, doneReps: 0, completed: false }));
    }
    if (!sets || !sets.length) sets = [{ targetReps: 10, weight: '', doneReps: 0, completed: false }];
    active.entries.push({ exerciseId: ex.id, exerciseName: ex.name, unit: ex.unit, sets });
    DB.setActive(active);
    render();
  }

  /* ---------------- mutations on active session ---------------- */
  const withActive = (fn) => { const a = DB.getActive(); if (!a) return; fn(a); DB.setActive(a); };

  function replaceCard(idx) {
    const a = DB.getActive();
    const card = content.querySelector(`.card.entry[data-e="${idx}"]`);
    if (a && card) card.outerHTML = renderEntry(a.entries[idx], idx);
  }

  /* ---------------- event delegation ---------------- */
  content.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    const ei = t.dataset.e != null ? +t.dataset.e : null;
    const si = t.dataset.s != null ? +t.dataset.s : null;

    switch (a) {
      case 'start-workout': DB.startSession(); render(); break;
      case 'open-add-exercise': openPicker(); break;

      case 'rep-inc':
        withActive(s => s.entries[ei].sets[si].doneReps += 1);
        haptic(8); replaceCard(ei); break;
      case 'rep-dec':
        withActive(s => { const x = s.entries[ei].sets[si]; x.doneReps = Math.max(0, x.doneReps - 1); });
        replaceCard(ei); break;

      case 'complete-set':
        withActive(s => {
          const x = s.entries[ei].sets[si];
          if (!x.doneReps) x.doneReps = x.targetReps || 0;
          x.completed = true;
        });
        haptic(20);
        startRest(DB.getSettings().restSeconds);
        render(); break;

      case 'uncomplete-set':
        withActive(s => { s.entries[ei].sets[si].completed = false; });
        render(); break;

      case 'add-set':
        withActive(s => {
          const sets = s.entries[ei].sets;
          const tmpl = sets[sets.length - 1] || { targetReps: 10, weight: '' };
          sets.push({ targetReps: tmpl.targetReps || 10, weight: tmpl.weight, doneReps: 0, completed: false });
        });
        render(); break;
      case 'remove-set':
        withActive(s => s.entries[ei].sets.splice(si, 1));
        render(); break;
      case 'remove-entry':
        withActive(s => s.entries.splice(ei, 1));
        render(); break;

      case 'finish-workout': {
        const saved = DB.finishActive();
        stopRest();
        view = saved ? 'history' : 'workout';
        if (saved) openSession = saved.id;
        render();
        break;
      }
      case 'discard-workout':
        if (confirm('Discard this workout? Nothing will be saved.')) { DB.discardActive(); stopRest(); render(); }
        break;

      /* history */
      case 'toggle-session': openSession = openSession === t.dataset.id ? null : t.dataset.id; render(); break;
      case 'delete-session':
        if (confirm('Delete this workout from history?')) { DB.deleteSession(t.dataset.id); render(); }
        break;

      /* exercises */
      case 'toggle-exercise': openExercise = openExercise === t.dataset.id ? null : t.dataset.id; render(); break;
      case 'add-exercise': {
        const name = document.getElementById('new-ex-name').value;
        const unit = document.getElementById('new-ex-unit').value;
        if (DB.addExercise(name, unit)) render();
        break;
      }
      case 'delete-exercise':
        if (confirm('Delete this exercise? Its past history stays in finished workouts.')) {
          DB.deleteExercise(t.dataset.id); openExercise = null; render();
        }
        break;

      /* settings */
      case 'export': doExport(); break;
      case 'import': document.getElementById('import-file').click(); break;
      case 'clear':
        if (confirm('Erase ALL data on this device? This cannot be undone.') &&
            confirm('Really erase everything?')) { DB.clearAll(); DB.seedIfEmpty(); openSession = openExercise = null; view = 'workout'; render(); }
        break;
    }
  });

  /* inputs that commit on change */
  content.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const ei = t.dataset.e != null ? +t.dataset.e : null;
    const si = t.dataset.s != null ? +t.dataset.s : null;
    switch (t.dataset.action) {
      case 'set-weight':
        withActive(s => { s.entries[ei].sets[si].weight = t.value === '' ? '' : Number(t.value); }); break;
      case 'set-target':
        withActive(s => { s.entries[ei].sets[si].targetReps = Math.max(0, parseInt(t.value, 10) || 0); });
        replaceCard(ei); break;
      case 'save-unit': { const s = DB.getSettings(); s.unit = t.value; DB.saveSettings(s); break; }
      case 'save-rest': { const s = DB.getSettings(); s.restSeconds = Math.max(0, parseInt(t.value, 10) || 0); DB.saveSettings(s); break; }
      case 'import-file': break;
    }
  });

  // Import: the file input is (re)created whenever the Settings view renders, so listen at
  // the document level rather than binding to an element that doesn't exist at boot.
  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'import-file' || !ev.target.files.length) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { DB.importAll(JSON.parse(reader.result)); openSession = openExercise = null; render();
            alert('Data imported.'); }
      catch (e) { alert('Import failed: ' + e.message); }
    };
    reader.readAsText(ev.target.files[0]);
  });

  function doExport() {
    const blob = new Blob([JSON.stringify(DB.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `replog-backup-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- tab bar ---------------- */
  tabbar.addEventListener('click', (ev) => {
    const b = ev.target.closest('.tab');
    if (!b) return;
    view = b.dataset.tab;
    render();
  });

  /* ---------------- boot ---------------- */
  DB.seedIfEmpty();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () =>
      navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
