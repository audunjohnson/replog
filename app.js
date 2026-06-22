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
  const round = (n) => Math.round(n * 10) / 10;
  // Bump increment: 2.5 below 25, 5 at/above 25.
  const weightStep = (w) => ((Number(w) || 0) < 25 ? 2.5 : 5);

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

  function lastAccText(exerciseId) {
    const last = DB.lastPerformance(exerciseId);
    if (!last) return '<span class="dim">No history yet</span>';
    const e = last.entry;
    const w = e.bodyweight ? '' : `${e.weight}${e.unit} · `;
    return `Last · ${esc(fmtDate(last.date))}: ${w}${e.done} × ${e.targetReps}`;
  }

  function accSessionSummary(e) {
    const w = e.bodyweight ? '' : `${e.weight}${e.unit} · `;
    return `${w}${e.done} × ${e.targetReps}`;
  }

  /* ---------------- top-level render ---------------- */
  function render() {
    [...tabbar.children].forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    if (view === 'workout') content.innerHTML = renderWorkout();
    if (view === 'stats') content.innerHTML = renderStats();
    if (view === 'history') content.innerHTML = renderHistory();
    if (view === 'program') content.innerHTML = renderProgram();
    if (view === 'backup') content.innerHTML = renderBackup();
    content.scrollTop = 0;
  }

  const withActive = (fn) => { const a = DB.getActive(); if (!a) return; fn(a); DB.setActive(a); };
  function replacePull() { const a = DB.getActive(); const el = content.querySelector('.pull-sticky'); if (a && el) el.outerHTML = renderPullCounter(a); }
  function replaceAcc(i) { const a = DB.getActive(); const el = content.querySelector(`.card.entry[data-e="${i}"]`); if (a && el) el.outerHTML = renderAccCard(a.entries[i], i); }

  /* ---------------- WORKOUT view ---------------- */
  function renderWorkout() {
    const active = DB.getActive();
    if (!active) return renderStart();

    const elapsed = active.startedAt ? Math.round((Date.now() - new Date(active.startedAt)) / 60000) : 0;
    return `
      <header class="hdr">
        <h1>${esc(dayName(active.day))}</h1>
        <div class="hdr-sub">${esc(fmtDate(active.date))} · ${elapsed} min · ${plural(active.entries.length, 'exercise')}</div>
      </header>
      ${renderPullCounter(active)}
      <div class="entries">${active.entries.map((e, i) => renderAccCard(e, i)).join('')
        || '<div class="dim center pad">No accessories today.</div>'}</div>
      <div class="finish-row">
        <button class="ghost-btn danger" data-action="discard">Discard</button>
        <button class="big-btn finish" data-action="finish">Finish workout</button>
      </div>`;
  }

  function renderStart() {
    const p = DB.getProgram();
    const n = DB.exerciseCountForSets(p.sets);
    const dayBtn = (day, cls) => {
      const names = DB.plannedExercises(day).map(e => e.name);
      return `
        <button class="big-btn ${cls}" data-action="start" data-day="${day}">Start ${esc(dayName(day))}</button>
        <div class="day-caption">${plural(names.length, 'exercise')} today: ${names.map(esc).join(', ') || '—'}</div>`;
    };
    const last = DB.getSessions()[0];
    const lastHtml = last ? `
      <div class="card muted-card">
        <div class="card-title">Last · ${esc(fmtDate(last.date))} · ${esc(dayName(last.day))}</div>
        <div class="row-line"><b>Pull-ups</b><span>${last.pullups.done} × ${last.pullups.targetReps}</span></div>
        ${last.entries.filter(e => e.done > 0).map(e =>
          `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
      </div>` : '';
    return `
      <header class="hdr"><h1>RepLog</h1>
        <div class="hdr-sub">Next pull-ups: <b style="color:var(--accent)">${p.sets} × ${p.reps}</b> · ${n} ${n === 1 ? 'accessory' : 'accessories'}</div>
      </header>
      <div class="start-wrap">
        <div class="day-block">${dayBtn('push', '')}</div>
        <div class="day-block">${dayBtn('leg', 'alt')}</div>
        ${lastHtml}
      </div>`;
  }

  // Sticky pull-up set counter (top of the workout screen).
  function renderPullCounter(s) {
    const p = s.pullups;
    const pct = p.targetSets ? Math.min(100, Math.round((p.done / p.targetSets) * 100)) : 0;
    const all = p.targetSets > 0 && p.done >= p.targetSets;
    const next = DB.nextLevel(Object.assign({}, DB.getProgram(), { sets: p.targetSets, reps: p.targetReps }));
    return `
      <div class="pull-sticky">
        <div class="card counter-card pull ${all ? 'done' : ''}">
          <div class="cc-head"><b>Pull-ups</b><span class="target-pill">${p.targetSets} × ${p.targetReps}</span></div>
          <div class="cc-body">
            <button class="cc-btn minus" data-action="pull-dec" aria-label="Undo a set">−</button>
            <div class="cc-count"><span class="cc-num">${p.done}</span><span class="cc-of">/ ${p.targetSets} sets</span></div>
            <button class="cc-btn plus" data-action="pull-inc">+1 set</button>
          </div>
          <div class="cc-bar"><div class="cc-fill" style="width:${pct}%"></div></div>
          ${all ? `<div class="advance">✓ all sets done · next workout ${next.sets} × ${next.reps}</div>` : ''}
        </div>
      </div>`;
  }

  function renderAccCard(e, idx) {
    const all = e.done >= e.targetSets;
    const pct = e.targetSets ? Math.min(100, Math.round((e.done / e.targetSets) * 100)) : 0;
    const nextW = (typeof e.nextWeight === 'number') ? e.nextWeight : e.weight;
    const wStep = weightStep(nextW);
    const weightCtrl = e.bodyweight
      ? `<div class="bw-tag">bodyweight · ${e.targetReps} reps</div>`
      : `<div class="weight-block">
           <div class="weight-now">This workout: <b>${e.weight}${unit()}</b></div>
           <div class="weight-ctrl">
             <span class="wc-label">Next time</span>
             <button class="step" data-action="acc-weight-bump" data-e="${idx}" data-d="-1">−${wStep}</button>
             <input class="weight-in" type="number" inputmode="decimal" step="2.5" min="0" data-action="acc-weight" data-e="${idx}" value="${nextW}">
             <span class="wc-unit">${unit()}</span>
             <button class="step" data-action="acc-weight-bump" data-e="${idx}" data-d="1">+${wStep}</button>
           </div>
         </div>`;
    return `
      <div class="card entry counter-card ${all ? 'done' : ''}" data-e="${idx}">
        <div class="cc-head"><div class="entry-title">${esc(e.name)}</div><span class="target-pill">${e.targetSets} × ${e.targetReps}</span></div>
        <div class="last-line">${lastAccText(e.exerciseId)}</div>
        ${weightCtrl}
        <div class="cc-body">
          <button class="cc-btn minus" data-action="acc-dec" data-e="${idx}" aria-label="Undo a set">−</button>
          <div class="cc-count"><span class="cc-num">${e.done}</span><span class="cc-of">/ ${e.targetSets} sets</span></div>
          <button class="cc-btn plus" data-action="acc-inc" data-e="${idx}">+1 set</button>
        </div>
        <div class="cc-bar"><div class="cc-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  /* ---------------- STATS view (charts) ---------------- */
  function sparkline(values) {
    if (values.length < 2)
      return `<div class="dim small spark-empty">Not enough data yet — finish ${values.length ? 'another' : 'a couple of'} workout${values.length ? '' : 's'} to see a trend.</div>`;
    const W = 320, H = 72, pad = 8;
    const min = Math.min(...values), max = Math.max(...values), range = (max - min) || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (W - 2 * pad);
      const y = H - pad - ((v - min) / range) * (H - 2 * pad);
      return [x, y];
    });
    const line = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${pad},${H - pad} ${line} ${(W - pad)},${H - pad}`;
    const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6"/>`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}"><polygon class="spark-area" points="${area}"/><polyline class="spark-line" points="${line}"/>${dots}</svg>`;
  }

  function statCard(name, values, suffix, subtitle) {
    const latest = values.length ? values[values.length - 1] : null;
    const first = values.length ? values[0] : null;
    const delta = (latest != null && first != null) ? round(latest - first) : 0;
    const deltaTxt = values.length > 1 && delta !== 0 ? ` · ${delta > 0 ? '+' : ''}${delta}${suffix} since start` : '';
    return `
      <div class="card stat-card">
        <div class="stat-head"><b>${esc(name)}</b><span class="stat-latest">${latest != null ? latest + suffix : '—'}</span></div>
        ${subtitle ? `<div class="dim small stat-sub">${esc(subtitle)}</div>` : ''}
        ${sparkline(values)}
        <div class="dim small">${plural(values.length, 'workout')}${deltaTxt}</div>
      </div>`;
  }

  function renderStats() {
    const pu = DB.pullupSeries();
    const cards = [];
    const p = DB.getProgram();
    cards.push(statCard('Pull-ups', pu.map(d => d.total), ' reps', `Total reps per workout · now at ${p.sets} × ${p.reps}`));
    ['push', 'leg'].forEach(day => {
      DB.getExercisesByDay(day).forEach(ex => {
        const s = DB.exerciseSeries(ex.id);
        if (!s.length) return;
        if (ex.bodyweight) cards.push(statCard(ex.name, s.map(d => d.done * d.reps), ' reps', `${dayName(day)} · total reps per workout`));
        else cards.push(statCard(ex.name, s.map(d => d.weight), unit(), `${dayName(day)} · working weight`));
      });
    });
    const any = pu.length || DB.getSessions().length;
    return `
      <header class="hdr"><h1>Stats</h1></header>
      ${any ? cards.join('') : '<div class="dim center pad">No workouts logged yet. Your charts appear here.</div>'}`;
  }

  /* ---------------- HISTORY view ---------------- */
  let openSession = null;
  function renderHistory() {
    const sessions = DB.getSessions();
    if (!sessions.length)
      return `<header class="hdr"><h1>History</h1></header><div class="dim center pad">No finished workouts yet.</div>`;
    const items = sessions.map(s => {
      const open = openSession === s.id;
      const pull = `${s.pullups.done} × ${s.pullups.targetReps}`;
      const nEx = s.entries.filter(e => e.done > 0).length;
      const body = open ? `<div class="sess-body">
          <div class="row-line"><b>Pull-ups</b><span>${pull}${DB.pullupsComplete(s) ? ' ✓' : ''}</span></div>
          ${s.entries.filter(e => e.done > 0).map(e =>
            `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
          <button class="ghost-btn danger small" data-action="delete-session" data-id="${s.id}">Delete</button>
        </div>` : '';
      return `<div class="card sess ${open ? 'open' : ''}">
          <div class="sess-head" data-action="toggle-session" data-id="${s.id}">
            <div><div class="card-title">${esc(dayName(s.day))} · ${esc(fmtDate(s.date))}</div>
              <div class="dim small">Pull-ups ${pull} · ${plural(nEx, 'exercise')}</div></div>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </div>${body}</div>`;
    }).join('');
    return `<header class="hdr"><h1>History</h1></header><div class="list">${items}</div>`;
  }

  /* ---------------- PROGRAM view ---------------- */
  function renderProgram() {
    const p = DB.getProgram();
    const n = DB.exerciseCountForSets(p.sets);
    const dayList = (day) => `<div class="prog-list" data-day="${day}">${
      DB.getExercisesByDay(day).map((e, i) => `
      <div class="prog-row ${i < n ? '' : 'prog-dim'}" data-id="${e.id}">
        <span class="drag-handle" aria-label="Drag to reorder">≡</span>
        <div class="prog-info"><b>${esc(e.name) || '(unnamed)'}</b>
          <span class="dim small">${e.bodyweight ? `${e.sets} × ${e.reps} · bodyweight` : `${e.sets} × ${e.reps} @ ${e.weight}${unit()}`}${i < n ? '' : ' · skipped at current level'}</span></div>
        <button class="x-btn" data-action="edit-ex" data-id="${e.id}">Edit</button>
      </div>`).join('') || '<div class="dim small">No exercises.</div>'
    }</div>`;
    return `
      <header class="hdr"><h1>Program</h1></header>
      <div class="card">
        <div class="card-title">Pull-ups</div>
        <div class="dim small">Each completed workout adds ${p.setStep} set up to ${p.maxSets}, then +${p.repStep} rep and back to ${p.minSets}. You do the first ⌊sets ÷ 3⌋ = <b>${n}</b> accessories each workout.</div>
        <div class="stepper-row"><span>Current sets</span>
          <button class="step" data-action="prog-sets-dec">−</button><b class="stepval">${p.sets}</b><button class="step" data-action="prog-sets-inc">+</button></div>
        <div class="stepper-row"><span>Current reps</span>
          <button class="step" data-action="prog-reps-dec">−</button><b class="stepval">${p.reps}</b><button class="step" data-action="prog-reps-inc">+</button></div>
        <div class="cfg-block">
          <div class="cfg-title">Progression rule</div>
          <label class="field row-field"><span>Min sets</span><input type="number" min="1" step="1" data-action="cfg-minSets" value="${p.minSets}"></label>
          <label class="field row-field"><span>Max sets</span><input type="number" min="1" step="1" data-action="cfg-maxSets" value="${p.maxSets}"></label>
          <label class="field row-field"><span>Rep increment</span><input type="number" min="1" step="1" data-action="cfg-repStep" value="${p.repStep}"></label>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Push day <span class="dim small">chest · shoulders · tricep</span></div>
        ${dayList('push')}
        <button class="add-row-btn" data-action="add-ex" data-day="push">＋ Add push exercise</button>
      </div>
      <div class="card">
        <div class="card-title">Leg day</div>
        ${dayList('leg')}
        <button class="add-row-btn" data-action="add-ex" data-day="leg">＋ Add leg exercise</button>
      </div>
      <div class="dim center small">Drag ≡ to reorder. Order = priority; the first ${n} are done on a ${p.sets}-set day.</div>`;
  }

  /* ---------------- exercise editor (modal) ---------------- */
  let editing = null;
  function openEditor(ex) {
    editing = JSON.parse(JSON.stringify(ex));
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'editor-ov';
    ov.appendChild(buildEditor());
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => { if (ev.target === ov) closeEditor(); });
    setTimeout(() => { const n = ov.querySelector('#ed-name'); n && n.focus(); }, 50);
  }
  function closeEditor() { const ov = document.getElementById('editor-ov'); if (ov) ov.remove(); editing = null; }
  function buildEditor() {
    const e = editing;
    const exists = !!DB.getExercise(e.id);
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
      <div class="sheet-head"><b>${exists ? 'Edit exercise' : 'New exercise'}</b><button class="x-btn" data-ed="close">✕</button></div>
      <label class="field"><span>Name</span><input id="ed-name" type="text" value="${esc(e.name)}" placeholder="Exercise name" autocomplete="off"></label>
      <label class="field"><span>Day</span><select id="ed-day">
        <option value="push" ${e.day === 'push' ? 'selected' : ''}>Push day</option>
        <option value="leg" ${e.day === 'leg' ? 'selected' : ''}>Leg day</option></select></label>
      <label class="field"><span>Type</span><select id="ed-type">
        <option value="weight" ${!e.bodyweight ? 'selected' : ''}>Weighted</option>
        <option value="bw" ${e.bodyweight ? 'selected' : ''}>Bodyweight</option></select></label>
      <div class="ed-grid">
        <label class="field"><span>Sets</span><input id="ed-sets" type="number" min="1" step="1" value="${e.sets}"></label>
        <label class="field"><span>Reps</span><input id="ed-reps" type="number" min="1" step="1" value="${e.reps}"></label>
        <label class="field" id="ed-weight-wrap" ${e.bodyweight ? 'hidden' : ''}><span>Weight (${unit()})</span><input id="ed-weight" type="number" min="0" step="2.5" value="${e.weight}"></label>
      </div>
      <div class="btn-col">
        <button class="big-btn" data-ed="save">Save</button>
        ${exists ? '<button class="ghost-btn danger" data-ed="delete">Delete exercise</button>' : ''}
      </div>`;
    sheet.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-ed]'); if (!act) return;
      if (act.dataset.ed === 'close') return closeEditor();
      if (act.dataset.ed === 'delete') { if (confirm('Delete this exercise? Past history is kept.')) { DB.deleteExercise(e.id); closeEditor(); render(); } return; }
      if (act.dataset.ed === 'save') saveEditor(sheet);
    });
    sheet.addEventListener('change', (ev) => {
      if (ev.target.id === 'ed-type') sheet.querySelector('#ed-weight-wrap').hidden = (ev.target.value !== 'weight');
    });
    return sheet;
  }
  function saveEditor(sheet) {
    const bodyweight = sheet.querySelector('#ed-type').value !== 'weight';
    const ex = {
      id: editing.id, name: sheet.querySelector('#ed-name').value.trim(), day: sheet.querySelector('#ed-day').value,
      bodyweight,
      sets: Math.max(1, parseInt(sheet.querySelector('#ed-sets').value, 10) || 1),
      reps: Math.max(1, parseInt(sheet.querySelector('#ed-reps').value, 10) || 1),
      weight: bodyweight ? 0 : Math.max(0, Number(sheet.querySelector('#ed-weight').value) || 0),
    };
    if (!ex.name) { alert('Please enter a name.'); return; }
    DB.upsertExercise(ex); closeEditor(); render();
  }

  /* ---------------- BACKUP view ---------------- */
  function renderBackup() {
    const s = DB.getSettings();
    return `
      <header class="hdr"><h1>Backup &amp; Settings</h1></header>
      <div class="card">
        <div class="card-title">Units</div>
        <label class="field row-field"><span>Weight unit</span><select id="set-unit" data-action="save-unit">
          <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option>
          <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option></select></label>
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
      <div class="card"><div class="card-title danger">Danger zone</div>
        <button class="ghost-btn danger" data-action="clear">Erase all data</button></div>
      <div class="dim center small pad">RepLog · offline-first · v3</div>`;
  }

  /* ---------------- clicks ---------------- */
  content.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]'); if (!t) return;
    const a = t.dataset.action;
    const e = t.dataset.e != null ? +t.dataset.e : null;

    switch (a) {
      case 'start': DB.startSession(t.dataset.day); render(); break;

      case 'pull-inc': withActive(x => { if (x.pullups.done < x.pullups.targetSets) x.pullups.done += 1; }); haptic(10); replacePull(); break;
      case 'pull-dec': withActive(x => { x.pullups.done = Math.max(0, x.pullups.done - 1); }); replacePull(); break;

      case 'acc-inc': withActive(x => { const en = x.entries[e]; if (en.done < en.targetSets) en.done += 1; }); haptic(10); replaceAcc(e); break;
      case 'acc-dec': withActive(x => { const en = x.entries[e]; en.done = Math.max(0, en.done - 1); }); replaceAcc(e); break;
      case 'acc-weight-bump': withActive(x => { const en = x.entries[e]; const cur = (typeof en.nextWeight === 'number') ? en.nextWeight : (Number(en.weight) || 0); en.nextWeight = Math.max(0, round(cur + (+t.dataset.d) * weightStep(cur))); }); replaceAcc(e); break;

      case 'finish': {
        const prog = DB.getProgram();
        const saved = DB.finishActive();
        if (saved) {
          const np = DB.getProgram();
          const advanced = (np.sets !== prog.sets || np.reps !== prog.reps);
          openSession = saved.id; view = 'history'; render();
          if (advanced) setTimeout(() => alert(`Pull-ups complete! Next workout: ${np.sets} × ${np.reps}.`), 60);
        } else render();
        break;
      }
      case 'discard': if (confirm('Discard this workout? Nothing will be saved.')) { DB.discardActive(); render(); } break;

      case 'toggle-session': openSession = openSession === t.dataset.id ? null : t.dataset.id; render(); break;
      case 'delete-session': if (confirm('Delete this workout from history?')) { DB.deleteSession(t.dataset.id); render(); } break;

      case 'prog-sets-dec': adjustProg('sets', -1); break;
      case 'prog-sets-inc': adjustProg('sets', 1); break;
      case 'prog-reps-dec': adjustProg('reps', -1); break;
      case 'prog-reps-inc': adjustProg('reps', 1); break;
      case 'add-ex': openEditor(DB.newExercise(t.dataset.day)); break;
      case 'edit-ex': { const ex = DB.getExercise(t.dataset.id); if (ex) openEditor(ex); break; }

      case 'export': doExport(); break;
      case 'import': document.getElementById('import-file').click(); break;
      case 'clear': if (confirm('Erase ALL data on this device? This cannot be undone.') && confirm('Really erase everything?')) { DB.clearAll(); DB.seedIfEmpty(); openSession = null; view = 'workout'; render(); } break;
    }
  });

  function adjustProg(field, delta) { const p = DB.getProgram(); p[field] = Math.max(1, p[field] + delta); DB.saveProgram(p); render(); }

  /* ---------------- changes ---------------- */
  content.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-action]'); if (!t) return;
    const act = t.dataset.action;
    if (act === 'acc-weight') withActive(x => { x.entries[+t.dataset.e].nextWeight = t.value === '' ? 0 : Number(t.value); });
    else if (act === 'save-unit') { const s = DB.getSettings(); s.unit = t.value; DB.saveSettings(s); }
    else if (act === 'cfg-minSets' || act === 'cfg-maxSets' || act === 'cfg-repStep') {
      const prog = DB.getProgram(); prog[act.slice(4)] = Math.max(1, parseInt(t.value, 10) || 1); DB.saveProgram(prog); render();
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'import-file' || !ev.target.files.length) return;
    const reader = new FileReader();
    reader.onload = () => { try { DB.importAll(JSON.parse(reader.result)); openSession = null; render(); alert('Data imported.'); } catch (err) { alert('Import failed: ' + err.message); } };
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

  /* ---------------- drag-to-reorder (Program tab) ---------------- */
  let drag = null;
  function dragAfter(list, y) {
    let best = { offset: -Infinity, el: null };
    for (const row of list.querySelectorAll('.prog-row:not(.dragging)')) {
      const box = row.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > best.offset) best = { offset, el: row };
    }
    return best.el;
  }
  content.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('.drag-handle'); if (!handle) return;
    const row = handle.closest('.prog-row'); const list = row && row.parentElement;
    if (!row || !list) return;
    ev.preventDefault();
    drag = { row, list };
    row.classList.add('dragging');
    try { handle.setPointerCapture(ev.pointerId); } catch {}
  });
  content.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    ev.preventDefault();
    const after = dragAfter(drag.list, ev.clientY);
    if (after == null) drag.list.appendChild(drag.row);
    else drag.list.insertBefore(drag.row, after);
  });
  function endDrag() {
    if (!drag) return;
    const { row, list } = drag; drag = null;
    row.classList.remove('dragging');
    DB.reorderDay(list.dataset.day, [...list.querySelectorAll('.prog-row')].map(r => r.dataset.id));
    render();
  }
  content.addEventListener('pointerup', endDrag);
  content.addEventListener('pointercancel', endDrag);

  /* ---------------- tabs + boot ---------------- */
  tabbar.addEventListener('click', (ev) => { const b = ev.target.closest('.tab'); if (!b) return; view = b.dataset.tab; render(); });

  DB.seedIfEmpty();
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
