/* app.js — RepLog UI. Vanilla JS, no framework, no build step. */
(() => {
  'use strict';

  const content = document.getElementById('content');
  const tabbar = document.getElementById('tabbar');
  let view = 'workout';

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dayName = (d) => (d === 'push' ? 'Push day' : 'Leg day');
  const haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const unit = () => DB.getSettings().unit;

  function fmtDate(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const days = Math.round((today - that) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // Short target descriptor for an accessory.
  function targetText(e) {
    if (e.amrap) return `${e.sets} × AMRAP · bodyweight`;
    if (e.bodyweight) return `${e.sets} × ${e.reps} · bodyweight`;
    return `${e.sets} × ${e.reps} @ ${e.weight}${unit()}`;
  }

  function lastAccText(exerciseId, e) {
    const last = DB.lastPerformance(exerciseId);
    if (!last) return '<span class="dim">No history yet</span>';
    const done = last.entry.sets.filter(s => s.done);
    if (last.entry.amrap) return `Last · ${esc(fmtDate(last.date))}: ${done.map(s => s.reps).join(', ') || '—'} reps`;
    if (last.entry.bodyweight) return `Last · ${esc(fmtDate(last.date))}: ${done.length} × ${last.entry.targetReps}`;
    return `Last · ${esc(fmtDate(last.date))}: ${last.entry.weight}${last.entry.unit} · ${done.length} × ${last.entry.targetReps}`;
  }

  /* ---------------- top-level render ---------------- */
  function render() {
    [...tabbar.children].forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    if (view === 'workout') content.innerHTML = renderWorkout();
    if (view === 'history') content.innerHTML = renderHistory();
    if (view === 'program') content.innerHTML = renderProgram();
    if (view === 'backup') content.innerHTML = renderBackup();
    content.scrollTop = 0;
  }

  // In-place card swaps so the page doesn't scroll-jump while logging.
  const withActive = (fn) => { const a = DB.getActive(); if (!a) return; fn(a); DB.setActive(a); };
  function replacePull() { const a = DB.getActive(); const el = content.querySelector('.pull-card'); if (a && el) el.outerHTML = renderPullCard(a); }
  function replaceAcc(i) { const a = DB.getActive(); const el = content.querySelector(`.card.entry[data-e="${i}"]`); if (a && el) el.outerHTML = renderAccCard(a.entries[i], i); }

  /* ---------------- WORKOUT view ---------------- */
  function renderWorkout() {
    const active = DB.getActive();
    if (!active) {
      const p = DB.getProgram();
      const last = DB.getSessions()[0];
      const lastHtml = last ? `
        <div class="card muted-card">
          <div class="card-title">Last · ${esc(fmtDate(last.date))} · ${esc(dayName(last.day))}</div>
          <div class="row-line"><b>Pull-ups</b><span>${last.pullups.sets.filter(s => s.done).length} × ${last.pullups.targetReps}</span></div>
          ${last.entries.filter(e => e.sets.some(s => s.done)).map(e =>
            `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
        </div>` : '';
      return `
        <header class="hdr"><h1>RepLog</h1>
          <div class="hdr-sub">Next pull-ups: <b style="color:var(--accent)">${p.sets} × ${p.reps}</b></div>
        </header>
        <div class="start-wrap">
          <button class="big-btn" data-action="start" data-day="push">Start Push day</button>
          <button class="big-btn alt" data-action="start" data-day="leg">Start Leg day</button>
          ${lastHtml}
        </div>`;
    }

    const elapsed = active.startedAt ? Math.round((Date.now() - new Date(active.startedAt)) / 60000) : 0;
    return `
      <header class="hdr">
        <h1>${esc(dayName(active.day))}</h1>
        <div class="hdr-sub">${esc(fmtDate(active.date))} · ${elapsed} min</div>
      </header>
      ${renderPullCard(active)}
      <div class="entries">${active.entries.map((e, i) => renderAccCard(e, i)).join('')}</div>
      <div class="finish-row">
        <button class="ghost-btn danger" data-action="discard">Discard</button>
        <button class="big-btn finish" data-action="finish">Finish workout</button>
      </div>`;
  }

  function renderPullCard(s) {
    const p = s.pullups;
    const done = p.sets.filter(x => x.done).length;
    const all = done === p.sets.length;
    const next = DB.nextLevel({ sets: p.targetSets, reps: p.targetReps });
    const chips = p.sets.map((x, i) =>
      `<button class="chip ${x.done ? 'on' : ''}" data-action="pull-toggle" data-i="${i}">${p.targetReps}</button>`).join('');
    return `
      <div class="card pull-card">
        <div class="entry-head">
          <div class="entry-title">Pull-ups</div>
          <div class="target-pill">target ${p.targetSets} × ${p.targetReps}</div>
        </div>
        <div class="count-line">${done} / ${p.targetSets} sets
          ${all ? `<span class="advance">✓ next: ${next.sets} × ${next.reps}</span>` : ''}</div>
        <div class="chips">${chips}</div>
      </div>`;
  }

  function renderAccCard(e, idx) {
    const done = e.sets.filter(s => s.done).length;
    let setsHtml;
    if (e.amrap) {
      setsHtml = e.sets.map((s, si) => `
        <div class="amrap-set ${s.done ? 'on' : ''}">
          <span class="amrap-label">Set ${si + 1}</span>
          <button class="step" data-action="acc-rep-dec" data-e="${idx}" data-s="${si}">−</button>
          <button class="amrap-count" data-action="acc-rep-inc" data-e="${idx}" data-s="${si}">${s.reps}</button>
          <span class="amrap-unit">reps</span>
        </div>`).join('');
    } else {
      setsHtml = `<div class="chips">${e.sets.map((s, si) =>
        `<button class="chip ${s.done ? 'on' : ''}" data-action="acc-toggle" data-e="${idx}" data-s="${si}">${e.targetReps}</button>`).join('')}</div>`;
    }
    const weightRow = e.bodyweight ? '' : `
      <label class="field weight-field">
        <span>Weight (${unit()})</span>
        <input type="number" inputmode="decimal" step="2.5" min="0" class="weight-in"
               data-action="acc-weight" data-e="${idx}" value="${e.weight}">
      </label>`;
    return `
      <div class="card entry" data-e="${idx}">
        <div class="entry-head">
          <div class="entry-title">${esc(e.name)}</div>
          <div class="target-pill">${e.amrap ? `${e.sets.length} × AMRAP` : `${e.sets.length} × ${e.targetReps}`}</div>
        </div>
        <div class="last-line">${lastAccText(e.exerciseId, e)} · <span class="count-line">${done}/${e.sets.length} done</span></div>
        ${weightRow}
        ${setsHtml}
      </div>`;
  }

  function accSessionSummary(e) {
    const done = e.sets.filter(s => s.done);
    if (e.amrap) return `${done.map(s => s.reps).join(', ') || '—'} reps`;
    if (e.bodyweight) return `${done.length} × ${e.targetReps}`;
    return `${e.weight}${e.unit} · ${done.length} × ${e.targetReps}`;
  }

  /* ---------------- HISTORY view ---------------- */
  let openSession = null;
  function renderHistory() {
    const sessions = DB.getSessions();
    if (!sessions.length)
      return `<header class="hdr"><h1>History</h1></header><div class="dim center pad">No finished workouts yet.</div>`;
    const items = sessions.map(s => {
      const open = openSession === s.id;
      const pull = `${s.pullups.sets.filter(x => x.done).length} × ${s.pullups.targetReps}`;
      const body = open ? `<div class="sess-body">
          <div class="row-line"><b>Pull-ups</b><span>${pull}${DB.pullupsComplete(s) ? ' ✓' : ''}</span></div>
          ${s.entries.filter(e => e.sets.some(x => x.done)).map(e =>
            `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
          <button class="ghost-btn danger small" data-action="delete-session" data-id="${s.id}">Delete</button>
        </div>` : '';
      return `<div class="card sess ${open ? 'open' : ''}">
          <div class="sess-head" data-action="toggle-session" data-id="${s.id}">
            <div><div class="card-title">${esc(dayName(s.day))} · ${esc(fmtDate(s.date))}</div>
              <div class="dim small">Pull-ups ${pull} · ${plural(s.entries.filter(e => e.sets.some(x => x.done)).length, 'exercise')}</div></div>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </div>${body}</div>`;
    }).join('');
    return `<header class="hdr"><h1>History</h1></header><div class="list">${items}</div>`;
  }

  /* ---------------- PROGRAM view ---------------- */
  function renderProgram() {
    const p = DB.getProgram();
    const dayList = (day) => DB.getExercisesByDay(day).map(e => `
      <div class="prog-row">
        <div class="prog-info"><b>${esc(e.name) || '<span class="dim">(unnamed)</span>'}</b>
          <span class="dim small">${esc(targetText(e))}</span></div>
        <button class="x-btn" data-action="edit-ex" data-id="${e.id}">Edit</button>
      </div>`).join('') || '<div class="dim small">No exercises.</div>';

    return `
      <header class="hdr"><h1>Program</h1></header>
      <div class="card">
        <div class="card-title">Pull-ups</div>
        <div class="dim small">Auto-advances 1 set per successful workout (10→20), then +1 rep back to 10.</div>
        <div class="stepper-row">
          <span>Sets</span>
          <button class="step" data-action="prog-sets-dec">−</button>
          <b class="stepval">${p.sets}</b>
          <button class="step" data-action="prog-sets-inc">+</button>
        </div>
        <div class="stepper-row">
          <span>Reps</span>
          <button class="step" data-action="prog-reps-dec">−</button>
          <b class="stepval">${p.reps}</b>
          <button class="step" data-action="prog-reps-inc">+</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Push day <span class="dim small">chest · shoulders · tricep</span></div>
        ${dayList('push')}
        <button class="add-set-btn" data-action="add-ex" data-day="push">＋ Add push exercise</button>
      </div>

      <div class="card">
        <div class="card-title">Leg day</div>
        ${dayList('leg')}
        <button class="add-set-btn" data-action="add-ex" data-day="leg">＋ Add leg exercise</button>
      </div>`;
  }

  /* ---------------- exercise editor (modal) ---------------- */
  let editing = null; // exercise object being edited (may be new)
  function openEditor(ex) {
    editing = JSON.parse(JSON.stringify(ex));
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'editor-ov';
    ov.appendChild(buildEditor());
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => { if (ev.target === ov) closeEditor(); });
    setTimeout(() => { const n = ov.querySelector('#ed-name'); n && n.focus(); }, 50);
  }
  function closeEditor() { const ov = document.getElementById('editor-ov'); if (ov) ov.remove(); editing = null; }
  function buildEditor() {
    const e = editing;
    const type = e.amrap ? 'amrap' : (e.bodyweight ? 'bw' : 'weight');
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
      <div class="sheet-head"><b>${DB.getExercise(e.id) ? 'Edit exercise' : 'New exercise'}</b>
        <button class="x-btn" data-ed="close">✕</button></div>
      <label class="field"><span>Name</span>
        <input id="ed-name" type="text" value="${esc(e.name)}" placeholder="Exercise name" autocomplete="off"></label>
      <label class="field"><span>Day</span>
        <select id="ed-day">
          <option value="push" ${e.day === 'push' ? 'selected' : ''}>Push day</option>
          <option value="leg" ${e.day === 'leg' ? 'selected' : ''}>Leg day</option>
        </select></label>
      <label class="field"><span>Type</span>
        <select id="ed-type">
          <option value="weight" ${type === 'weight' ? 'selected' : ''}>Weighted</option>
          <option value="bw" ${type === 'bw' ? 'selected' : ''}>Bodyweight (fixed reps)</option>
          <option value="amrap" ${type === 'amrap' ? 'selected' : ''}>Bodyweight (build reps / AMRAP)</option>
        </select></label>
      <div class="ed-grid">
        <label class="field"><span>Sets</span>
          <input id="ed-sets" type="number" min="1" step="1" value="${e.sets}"></label>
        <label class="field" id="ed-reps-wrap" ${type === 'amrap' ? 'hidden' : ''}><span>Reps</span>
          <input id="ed-reps" type="number" min="1" step="1" value="${e.reps}"></label>
        <label class="field" id="ed-weight-wrap" ${type !== 'weight' ? 'hidden' : ''}><span>Weight (${unit()})</span>
          <input id="ed-weight" type="number" min="0" step="2.5" value="${e.weight}"></label>
      </div>
      <div class="btn-col">
        <button class="big-btn" data-ed="save">Save</button>
        ${DB.getExercise(e.id) ? '<button class="ghost-btn danger" data-ed="delete">Delete exercise</button>' : ''}
      </div>`;
    sheet.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-ed]');
      if (!act) return;
      if (act.dataset.ed === 'close') return closeEditor();
      if (act.dataset.ed === 'delete') {
        if (confirm('Delete this exercise? Past history is kept.')) { DB.deleteExercise(e.id); closeEditor(); render(); }
        return;
      }
      if (act.dataset.ed === 'save') saveEditor(sheet);
    });
    sheet.addEventListener('change', (ev) => {
      if (ev.target.id === 'ed-type') {
        const t = ev.target.value;
        sheet.querySelector('#ed-reps-wrap').hidden = (t === 'amrap');
        sheet.querySelector('#ed-weight-wrap').hidden = (t !== 'weight');
      }
    });
    return sheet;
  }
  function saveEditor(sheet) {
    const t = sheet.querySelector('#ed-type').value;
    const ex = {
      id: editing.id,
      name: sheet.querySelector('#ed-name').value.trim(),
      day: sheet.querySelector('#ed-day').value,
      bodyweight: t !== 'weight',
      amrap: t === 'amrap',
      sets: Math.max(1, parseInt(sheet.querySelector('#ed-sets').value, 10) || 1),
      reps: t === 'amrap' ? 0 : Math.max(1, parseInt(sheet.querySelector('#ed-reps').value, 10) || 1),
      weight: t === 'weight' ? Math.max(0, Number(sheet.querySelector('#ed-weight').value) || 0) : 0,
    };
    if (!ex.name) { alert('Please enter a name.'); return; }
    DB.upsertExercise(ex);
    closeEditor();
    render();
  }

  /* ---------------- BACKUP view ---------------- */
  function renderBackup() {
    const s = DB.getSettings();
    return `
      <header class="hdr"><h1>Backup &amp; Settings</h1></header>
      <div class="card">
        <div class="card-title">Units</div>
        <label class="field row-field"><span>Weight unit</span>
          <select id="set-unit" data-action="save-unit">
            <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option>
            <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option>
          </select></label>
      </div>
      <div class="card">
        <div class="card-title">Backup</div>
        <div class="dim small">All data lives only on this device. Export regularly to keep a copy.</div>
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
      <div class="dim center small pad">RepLog · offline-first · v2</div>`;
  }

  /* ---------------- event delegation: clicks ---------------- */
  content.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    const e = t.dataset.e != null ? +t.dataset.e : null;
    const s = t.dataset.s != null ? +t.dataset.s : null;
    const i = t.dataset.i != null ? +t.dataset.i : null;

    switch (a) {
      case 'start': DB.startSession(t.dataset.day); render(); break;

      case 'pull-toggle':
        withActive(x => { const set = x.pullups.sets[i]; set.done = !set.done; });
        haptic(8); replacePull(); break;

      case 'acc-toggle':
        withActive(x => { const set = x.entries[e].sets[s]; set.done = !set.done; });
        haptic(8); replaceAcc(e); break;
      case 'acc-rep-inc':
        withActive(x => { const set = x.entries[e].sets[s]; set.reps += 1; set.done = set.reps > 0; });
        haptic(8); replaceAcc(e); break;
      case 'acc-rep-dec':
        withActive(x => { const set = x.entries[e].sets[s]; set.reps = Math.max(0, set.reps - 1); set.done = set.reps > 0; });
        replaceAcc(e); break;

      case 'finish': {
        const prog = DB.getProgram();
        const saved = DB.finishActive();
        if (saved) {
          const np = DB.getProgram();
          const advanced = (np.sets !== prog.sets || np.reps !== prog.reps);
          openSession = saved.id; view = 'history';
          render();
          if (advanced) setTimeout(() => alert(`Pull-ups complete! Next workout: ${np.sets} × ${np.reps}.`), 60);
        } else { render(); }
        break;
      }
      case 'discard':
        if (confirm('Discard this workout? Nothing will be saved.')) { DB.discardActive(); render(); }
        break;

      case 'toggle-session': openSession = openSession === t.dataset.id ? null : t.dataset.id; render(); break;
      case 'delete-session':
        if (confirm('Delete this workout from history?')) { DB.deleteSession(t.dataset.id); render(); } break;

      /* program */
      case 'prog-sets-dec': adjustProg('sets', -1); break;
      case 'prog-sets-inc': adjustProg('sets', 1); break;
      case 'prog-reps-dec': adjustProg('reps', -1); break;
      case 'prog-reps-inc': adjustProg('reps', 1); break;
      case 'add-ex': openEditor(DB.newExercise(t.dataset.day)); break;
      case 'edit-ex': { const ex = DB.getExercise(t.dataset.id); if (ex) openEditor(ex); break; }

      /* backup */
      case 'export': doExport(); break;
      case 'import': document.getElementById('import-file').click(); break;
      case 'clear':
        if (confirm('Erase ALL data on this device? This cannot be undone.') && confirm('Really erase everything?')) {
          DB.clearAll(); DB.seedIfEmpty(); openSession = null; view = 'workout'; render();
        }
        break;
    }
  });

  function adjustProg(field, delta) {
    const p = DB.getProgram();
    p[field] = Math.max(1, p[field] + delta);
    DB.saveProgram(p);
    render();
  }

  /* ---------------- event delegation: changes ---------------- */
  content.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'acc-weight') {
      const e = +t.dataset.e;
      withActive(x => { x.entries[e].weight = t.value === '' ? 0 : Number(t.value); });
    } else if (t.dataset.action === 'save-unit') {
      const s = DB.getSettings(); s.unit = t.value; DB.saveSettings(s);
    }
  });

  // Import (file input is recreated on each Backup render).
  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'import-file' || !ev.target.files.length) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { DB.importAll(JSON.parse(reader.result)); openSession = null; render(); alert('Data imported.'); }
      catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(ev.target.files[0]);
  });

  function doExport() {
    const blob = new Blob([JSON.stringify(DB.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `replog-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- tab bar ---------------- */
  tabbar.addEventListener('click', (ev) => {
    const b = ev.target.closest('.tab');
    if (!b) return;
    view = b.dataset.tab; render();
  });

  /* ---------------- boot ---------------- */
  DB.seedIfEmpty();
  render();
  if ('serviceWorker' in navigator)
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
