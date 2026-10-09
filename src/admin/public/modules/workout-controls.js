// Workout owns all editing/logging UI. Shell provides only navigation and common API helpers.
export function initWorkout({ $, api, notice, load }) {
  let state, selectedSession, selectedExercise, editingProgram, editingExercise, draft;
  let requestBusy = false,
    loadedUser = '',
    view = 'overview';
  const root = $('workoutContent');
  const uid = () => $('workoutUser').value.trim() || state?.userId;
  const requestId = () => crypto.randomUUID();
  const node = (tag, text, className) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  const panel = (title) => {
    const e = node('section');
    e.append(node('h2', title));
    root.append(e);
    return e;
  };
  const button = (label, fn, quiet = true) => {
    const e = node('button', label, quiet ? 'quiet' : '');
    e.type = 'button';
    e.onclick = () => run(fn);
    return e;
  };
  const field = (parent, label, value = '', type = 'text', required = false) => {
    const e = node('label', label),
      input = node(type === 'textarea' ? 'textarea' : 'input');
    input.setAttribute('aria-label', label);
    if (type !== 'textarea') input.type = type;
    if (type === 'checkbox') input.checked = !!value;
    else input.value = value ?? '';
    input.required = required;
    e.append(input);
    parent.append(e);
    return input;
  };
  const select = (parent, label, options, value) => {
    const e = node('label', label),
      input = node('select');
    input.setAttribute('aria-label', label);
    for (const [v, t] of options) {
      const option = node('option', t);
      option.value = v;
      input.append(option);
    }
    input.value = value ?? options[0]?.[0];
    e.append(input);
    parent.append(e);
    if (options.some(([id]) => state?.exercises.some(e => e.id === id))) {
      const filters = node('div');
      parent.append(filters);
      const search = field(filters, 'Search ' + label + ' by name or alias');
      const category = select(filters, 'Category for ' + label, [['', 'All categories'], ...[...new Set(state.exercises.map(e => e.category).filter(Boolean))].sort().map(v => [v, v])]);
      const equipment = select(filters, 'Equipment for ' + label, [['', 'All equipment'], ...[...new Set(state.exercises.map(e => e.equipment).filter(Boolean))].sort().map(v => [v, v])]);
      const filter = () => {
        const normalize = v => v.toLowerCase().replace(/[^a-z0-9]/g, '');
        const selected = input.value;
        input.replaceChildren();
        for (const [id, label] of options) {
          const exercise = state.exercises.find(ex => ex.id === id);
          if (exercise && id !== selected &&
            ((!([exercise.name, ...exercise.aliases, exercise.variation].some(v => normalize(v).includes(normalize(search.value))))) ||
             (category.value && exercise.category !== category.value) || (equipment.value && exercise.equipment !== equipment.value))) continue;
          const option = node('option', label); option.value = id; input.append(option);
        }
        input.value = selected;
      };
      search.oninput = category.onchange = equipment.onchange = filter;
    }
    return input;
  };
  const link = (parent, label, path) => {
    const a = node('a', label);
    a.href = path;
    parent.append(a);
  };
  const empty = (parent, text) => parent.append(node('p', text, 'muted'));
  const ex = (id) => state.exercises.find((e) => e.id === id);
  const format = (r) =>
    r.kind === 'custom'
      ? r.display
      : r.kind === 'bodyweight'
        ? 'BW'
        : r.kind === 'none'
          ? 'No external resistance'
          : `${r.kind === 'pair' ? '2 × ' : r.kind === 'added' ? 'BW + ' : r.kind === 'assisted' ? 'BW − ' : ''}${r.value} ${r.unit}${r.kind === 'per-side' ? '/side' : r.kind === 'stack' ? ' stack' : ''}`;
  const defaultPrescription = () => ({
    sets: 3,
    minReps: 8,
    maxReps: 12,
    resistance: { kind: 'total', value: 0, unit: state.preferences.unit, display: '' },
    rule: { type: 'double', increment: 5, loads: [], chainId: '' },
    note: '',
  });
  async function refresh() {
    state = await api('workout/state' + (uid() ? '?userId=' + encodeURIComponent(uid()) : ''));
    $('workoutUser').value = state.userId;
    loadedUser = state.userId;
    render();
  }
  async function run(fn) {
    if (requestBusy) return;
    requestBusy = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } catch (error) {
      notice(error.message, 'error');
      if (!state) {
        root.replaceChildren();
        const p = panel('Workout unavailable');
        empty(p, error.message);
      }
    } finally {
      root.removeAttribute('aria-busy');
      requestBusy = false;
    }
  }
  async function save(route, body) {
    const result = await api('workout/' + route, { userId: uid(), ...body });
    await refresh();
    await load();
    notice('Workout changes saved.');
    return result;
  }
  function resistanceEditor(parent, r, label = 'Resistance') {
    const box = node('fieldset');
    box.append(node('legend', label));
    parent.append(box);
    const kind = select(
      box,
      'Resistance type',
      [
        'total',
        'pair',
        'per-side',
        'stack',
        'bodyweight',
        'added',
        'assisted',
        'none',
        'custom',
      ].map((k) => [k, k]),
      r.kind,
    );
    const value = field(box, 'Load (per implement / side when selected)', r.value, 'number', true);
    value.min = 0;
    value.max = 5000;
    value.step = 'any';
    const unit = select(
      box,
      'Units',
      [
        ['lb', 'lb'],
        ['kg', 'kg'],
      ],
      r.unit,
    );
    const display = field(box, 'Custom display (custom type only)', r.display);
    return () => ({
      kind: kind.value,
      value: Number(value.value),
      unit: unit.value,
      display: display.value,
    });
  }
  function prescriptionEditor(parent, p) {
    const columns = node('div', undefined, 'columns');
    parent.append(columns);
    const sets = field(columns, 'Target sets', p.sets, 'number', true),
      min = field(columns, 'Minimum reps', p.minReps, 'number', true),
      max = field(columns, 'Maximum reps', p.maxReps, 'number', true);
    sets.min = 1;
    sets.max = 20;
    min.min = 1;
    min.max = 200;
    max.min = 1;
    max.max = 200;
    const readResistance = resistanceEditor(parent, p.resistance);
    const type = select(
      parent,
      'Progression type',
      [
        ['double', 'Double progression'],
        ['chain', 'Ordered variation chain'],
        ['manual', 'Manual difficulty'],
      ],
      p.rule.type,
    );
    const increment = field(parent, 'Load increment', p.rule.increment, 'number', true);
    increment.min = 0.01;
    increment.step = 'any';
    const loads = field(
      parent,
      'Available loads (optional, increasing comma-separated values)',
      p.rule.loads.join(', '),
    );
    const chain = select(
      parent,
      'Progression chain',
      [['', 'None'], ...state.chains.map((c) => [c.id, c.name])],
      p.rule.chainId,
    );
    const note = field(parent, 'Prescription note', p.note, 'textarea');
    return () => ({
      sets: Number(sets.value),
      minReps: Number(min.value),
      maxReps: Number(max.value),
      resistance: readResistance(),
      rule: {
        type: type.value,
        increment: Number(increment.value),
        loads: loads.value.trim() ? loads.value.split(',').map((v) => Number(v.trim())) : [],
        chainId: chain.value,
      },
      note: note.value,
    });
  }
  function stats(parent, s) {
    parent.append(
      node(
        'p',
        `${s.name} · ${s.state} · ${new Date(s.startedAt).toLocaleString()}${s.finishedAt ? ' · ' + Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000) + ' minutes' : ''}${s.questionable ? ' · Questionable' : ''}`,
      ),
    );
    if (s.note) parent.append(node('p', s.note));
  }
  function overview() {
    const p = panel('Workout overview');
    if (state.active) {
      stats(p, state.active);
      link(p, 'Continue active workout', '/workout/active');
    } else empty(p, 'No active workout.');
    empty(p, `Next planned workout: ${state.next?.name || 'Select or create a program.'}`);
    const last = state.sessions.find((s) => s.state === 'completed');
    if (last) {
      p.append(node('h3', 'Most recent'));
      stats(p, last);
    }
    const actions = node('div', undefined, 'actions');
    p.append(actions);
    actions.append(
      button(
        'Start planned workout',
        () =>
          save('start', {
            programId: state.next?.programId,
            templateId: state.next?.templateId,
            requestId: requestId(),
          }),
        false,
      ),
      button('Start free workout', () => save('start', { free: true, requestId: requestId() })),
    );
    const recent = panel('Recent recommendations');
    const sessions = state.sessions.filter((s) => s.state === 'completed').slice(0, 3);
    if (!sessions.length) empty(recent, 'Recommendations appear after you finish a workout.');
    for (const s of sessions)
      for (const r of s.recommendations.slice(0, 5))
        recent.append(
          node('p', `${s.exercises.find((e) => e.id === r.id)?.name}: ${r.outcome} — ${r.reason}`),
        );
    const links = node('div', undefined, 'actions');
    recent.append(links);
    for (const [label, path] of [
      ['Programs', 'programs'],
      ['Exercise library', 'exercises'],
      ['History', 'history'],
    ])
      link(links, label, '/workout/' + path);
  }
  function exercises() {
    const list = panel('Exercise library');
    list.append(
      button('New exercise', () => {
        editingExercise = null;
        renderExerciseForm();
      }),
    );
    if (!state.exercises.length)
      empty(list, 'Create an exercise to begin. Variations have separate stable IDs and history.');
    const search = field(list, 'Search exercises by name or alias');
    const category = select(list, 'Exercise category', [['', 'All categories'], ...[...new Set(state.exercises.map(e => e.category).filter(Boolean))].sort().map(v => [v,v])]);
    const equipment = select(list, 'Exercise equipment', [['', 'All equipment'], ...[...new Set(state.exercises.map(e => e.equipment).filter(Boolean))].sort().map(v => [v,v])]);
    const status = select(list, 'Exercise status', [['active','Active'],['archived','Archived'],['all','All']], 'active');
    const results = node('div'); list.append(results);
    let page = 0;
    const draw = () => {
      results.replaceChildren();
      const normalize = v => v.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matches = state.exercises.filter(e => (status.value === 'all' || e.active === (status.value === 'active')) &&
        (!category.value || e.category === category.value) && (!equipment.value || e.equipment === equipment.value) &&
        [e.name,...e.aliases,e.variation].some(v => normalize(v).includes(normalize(search.value)))).sort((a,b) => a.name.localeCompare(b.name));
      results.append(node('p', matches.length + ' exercises · page ' + (page + 1)));
      for (const e of matches.slice(page * 25, (page + 1) * 25)) {
      const row = node('div', undefined, 'workout-list-row');
      row.append(
        node(
          'span',
          `${e.name}${e.variation ? ' · ' + e.variation : ''}${e.active ? '' : ' · Archived'}`,
        ),
        button('Edit ' + e.name, () => {
          editingExercise = e;
          renderExerciseForm();
        }),
        button('History', () => {
          selectedExercise = e.id;
          history();
        }),
      );
      results.append(row);
      }
      if (page) results.append(button('Previous exercises', () => { page--; draw(); }));
      if ((page + 1) * 25 < matches.length) results.append(button('More exercises', () => { page++; draw(); }));
    };
    search.oninput = category.onchange = equipment.onchange = status.onchange = () => { page = 0; draw(); };
    draw();
    renderExerciseForm();
    chainEditor();
  }
  function renderExerciseForm() {
    $('exerciseEditor')?.remove();
    const p = panel(editingExercise ? 'Edit exercise' : 'Create exercise');
    p.id = 'exerciseEditor';
    const form = node('form');
    p.append(form);
    const e = editingExercise ?? {
      name: '',
      aliases: [],
      variation: '',
      equipment: '',
      category: '',
      notes: '',
      active: true,
      defaults: defaultPrescription(),
    };
    const name = field(form, 'Exercise name', e.name, 'text', true),
      aliases = field(form, 'Aliases (comma separated)', e.aliases.join(', ')),
      variation = field(form, 'Variation / machine settings', e.variation),
      equipment = field(form, 'Equipment', e.equipment),
      category = field(form, 'Muscle group / category', e.category),
      notes = field(form, 'Exercise notes', e.notes, 'textarea'),
      active = field(form, 'Active exercise', e.active, 'checkbox');
    const read = prescriptionEditor(form, e.defaults);
    const submit = node('button', 'Save exercise');
    form.append(submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      run(async () => {
        await save('exercises', {
          record: {
            id: e.id,
            name: name.value,
            aliases: aliases.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            variation: variation.value,
            equipment: equipment.value,
            category: category.value,
            notes: notes.value,
            active: active.checked,
            defaults: read(),
          },
          expectedRevision: e.revision,
        });
        editingExercise = null;
        render();
      });
    };
    if (e.id) {
      form.append(
        button('Archive exercise', async () => {
          if (confirm('Archive this exercise? Historical records will remain.')) {
            await save('exercises', {
              record: { ...e, active: false },
              expectedRevision: e.revision,
            });
            editingExercise = null;
            render();
          }
        }),
      );
    }
  }
  function chainEditor() {
    const p = panel('Ordered progression chains');
    empty(
      p,
      'Choose distinct variations in difficulty order. Create exercises first, then a chain, then assign the chain in exercise defaults or prescriptions.',
    );
    for (const c of state.chains) {
      const details = node('details');
      details.append(node('summary', c.name));
      p.append(details);
      editChain(details, c);
    }
    const details = node('details');
    details.append(node('summary', 'Create chain'));
    p.append(details);
    editChain(details, { name: '', exerciseIds: [] });
  }
  function editChain(parent, c) {
    const name = field(parent, 'Chain name', c.name);
    const choices = node('div');
    parent.append(choices);
    const ids = [...c.exerciseIds];
    const picker = select(
      parent,
      'Add variation',
      [
        ['', 'Choose exercise'],
        ...state.exercises.filter((e) => e.active).map((e) => [e.id, e.name]),
      ],
      '',
    );
    const renderChoices = () => {
      choices.replaceChildren();
      ids.forEach((id, index) => {
        const row = node('div', undefined, 'workout-list-row');
        row.append(
          node('span', ex(id)?.name || id),
          button('Up', () => {
            if (index) {
              [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
              renderChoices();
            }
          }),
          button('Down', () => {
            if (index < ids.length - 1) {
              [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
              renderChoices();
            }
          }),
          button('Remove variation', () => {
            ids.splice(index, 1);
            renderChoices();
          }),
        );
        choices.append(row);
      });
    };
    parent.append(
      button('Add variation', () => {
        if (picker.value && !ids.includes(picker.value)) {
          ids.push(picker.value);
          renderChoices();
        }
      }),
      button('Save chain', () =>
        save('chains', {
          record: { id: c.id, name: name.value, exerciseIds: ids },
          expectedRevision: c.revision,
        }),
      ),
    );
    renderChoices();
  }
  function programs() {
    const p = panel('Programs');
    const selection = node(
      'p',
      state.savedNext
        ? 'Currently selected next workout: ' +
            state.savedNext.programName +
            ' → ' +
            state.savedNext.name
        : 'Currently selected next workout: None — use Set as Next below.',
    );
    selection.id = 'workoutNextSelection';
    p.append(selection);
    if (!state.programs.length)
      empty(p, 'Programs contain one or more named planned workouts. Create exercises first.');
    p.append(
      button('New program', () => {
        editingProgram = null;
        draft = { name: '', active: true, templates: [{ name: 'Workout A', exercises: [] }] };
        renderProgramEditor();
      }),
    );
    for (const program of state.programs) {
      const box = node('div', undefined, 'response');
      box.append(
        node('h3', `${program.name} · ${program.active ? 'Active' : 'Inactive'}`),
        button('Edit ' + program.name, () => {
          editingProgram = program;
          draft = structuredClone(program);
          renderProgramEditor();
        }),
      );
      for (const t of program.templates) {
        const selected =
          state.savedNext?.programId === program.id && state.savedNext?.templateId === t.id;
        empty(
          box,
          t.name +
            ' · ' +
            t.exercises.length +
            ' exercises' +
            (selected ? ' · Selected next workout' : ''),
        );
        const setNext = button(selected ? 'Selected as Next' : 'Set ' + t.name + ' as Next', () =>
          save('next', {
            programId: program.id,
            templateId: t.id,
            expectedRevision: program.revision,
          }),
        );
        setNext.disabled = selected || !program.active;
        box.append(setNext);
      }
      p.append(box);
    }
    if (!draft)
      draft = { name: '', active: true, templates: [{ name: 'Workout A', exercises: [] }] };
    renderProgramEditor();
  }
  function renderProgramEditor() {
    $('programEditor')?.remove();
    const p = panel(editingProgram ? 'Edit program' : 'Create program');
    p.id = 'programEditor';
    const form = node('form');
    p.append(form);
    const name = field(form, 'Program name', draft.name, 'text', true),
      active = field(form, 'Active program', draft.active, 'checkbox');
    const reads = [];
    const templates = node('div');
    form.append(templates);
    const capture = () => {
      draft.name = name.value;
      draft.active = active.checked;
      draft.templates = reads.map((r) => r());
    };
    draft.templates.forEach((t, ti) => {
      const box = node('fieldset');
      box.append(node('legend', 'Planned workout ' + (ti + 1)));
      templates.append(box);
      const tn = field(box, 'Planned workout name', t.name, 'text', true),
        entries = [];
      t.exercises.forEach((slot, ei) => {
        const details = node('details');
        details.open = t.exercises.length <= 3;
        details.append(
          node('summary', `${ei + 1}. ${ex(slot.exerciseId)?.name || 'Missing exercise'}`),
        );
        box.append(details);
        const chosen = select(
          details,
          'Exercise',
          [...state.exercises.map((e) => [e.id, e.name + (e.active ? '' : ' (archived)')])],
          slot.exerciseId,
        );
        const read = prescriptionEditor(details, slot);
        details.append(
          button('Move up', () => {
            capture();
            if (ei) {
              [draft.templates[ti].exercises[ei - 1], draft.templates[ti].exercises[ei]] = [
                draft.templates[ti].exercises[ei],
                draft.templates[ti].exercises[ei - 1],
              ];
              renderProgramEditor();
            }
          }),
          button('Move down', () => {
            capture();
            if (ei < t.exercises.length - 1) {
              [draft.templates[ti].exercises[ei + 1], draft.templates[ti].exercises[ei]] = [
                draft.templates[ti].exercises[ei],
                draft.templates[ti].exercises[ei + 1],
              ];
              renderProgramEditor();
            }
          }),
          button('Remove from plan', () => {
            if (confirm('Remove this exercise from the plan?')) {
              capture();
              draft.templates[ti].exercises.splice(ei, 1);
              renderProgramEditor();
            }
          }),
        );
        entries.push(() => ({ ...read(), slotId: slot.slotId, exerciseId: chosen.value }));
      });
      const picker = select(
        box,
        'Exercise to add',
        [
          ['', 'Choose exercise'],
          ...state.exercises.filter((e) => e.active).map((e) => [e.id, e.name]),
        ],
        '',
      );
      box.append(
        button('Add exercise to plan', () => {
          capture();
          const exercise = ex(picker.value);
          if (exercise) {
            draft.templates[ti].exercises.push({
              exerciseId: exercise.id,
              ...structuredClone(exercise.defaults),
            });
            renderProgramEditor();
          }
        }),
        button('Remove planned workout', () => {
          if (confirm('Remove this planned workout?')) {
            capture();
            draft.templates.splice(ti, 1);
            renderProgramEditor();
          }
        }),
      );
      reads.push(() => ({ id: t.id, name: tn.value, exercises: entries.map((r) => r()) }));
    });
    form.append(
      button('Add planned workout', () => {
        capture();
        draft.templates.push({ name: 'New workout', exercises: [] });
        renderProgramEditor();
      }),
    );
    const submit = node('button', 'Save program');
    form.append(submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      run(async () => {
        capture();
        await save('programs', { record: draft, expectedRevision: editingProgram?.revision });
        editingProgram = null;
        draft = null;
        render();
      });
    };
  }
  function history() {
    if (view !== 'history') {
      locationNavigate('/workout/history');
      return;
    }
    root.replaceChildren();
    const p = panel('Workout history');
    const filter = select(
      p,
      'Exercise history',
      [
        ['', 'All exercises'],
        ...state.exercises.map((e) => [e.id, e.name + (e.active ? '' : ' (archived)')]),
      ],
      selectedExercise || '',
    );
    filter.onchange = () => {
      selectedExercise = filter.value;
      history();
    };
    const list = state.sessions.filter(
      (s) =>
        s.state !== 'active' &&
        (!selectedExercise || s.exercises.some((e) => e.exerciseId === selectedExercise)),
    );
    if (!list.length) empty(p, 'No matching workouts.');
    for (const s of list) {
      const row = node('div', undefined, 'workout-list-row');
      row.append(
        node('span', `${s.startedAt.slice(0, 10)} · ${s.name} · ${s.state}`),
        button('View session', () => {
          selectedSession = s.id;
          history();
        }),
      );
      p.append(row);
    }
    if (selectedExercise) {
      const trend = panel('Exercise performance timeline');
      empty(
        trend,
        'Actual reps by set. Resistance representations stay separate; warmups are labeled. Questionable data is shown, never treated as proof of progression.',
      );
      const maximum = Math.max(
        1,
        ...list.flatMap((s) =>
          s.exercises
            .filter((e) => e.exerciseId === selectedExercise)
            .flatMap((e) => e.sets.map((s) => s.reps)),
        ),
      );
      for (const session of [...list].reverse())
        for (const entry of session.exercises.filter((e) => e.exerciseId === selectedExercise))
          for (const set of entry.sets) {
            const label = node(
              'label',
              session.startedAt.slice(0, 10) +
                ' · ' +
                format(set.resistance) +
                ' × ' +
                set.reps +
                ' · ' +
                set.type +
                (set.questionable || entry.questionable || session.questionable ? ' · ?' : ''),
            );
            const meter = node('meter');
            meter.min = 0;
            meter.max = maximum;
            meter.value = set.reps;
            label.append(meter);
            trend.append(label);
          }
    }
    const session = state.sessions.find((s) => s.id === selectedSession) || list[0];
    if (session) sessionDetail(session, true);
  }
  function setTable(parent, entry) {
    const wrap = node('div', undefined, 'table-scroll'),
      table = node('table');
    wrap.append(table);
    parent.append(wrap);
    const head = node('tr');
    for (const text of ['Set', 'Resistance', 'Reps', 'Type', 'Notes'])
      head.append(node('th', text));
    table.append(head);
    if (!entry.sets.length) empty(parent, 'No sets logged.');
    for (const set of entry.sets) {
      const tr = node('tr');
      for (const value of [
        set.order,
        format(set.resistance),
        set.reps,
        set.type,
        `${set.questionable ? 'Questionable · ' : ''}${set.note}${set.rpe != null ? ' · RPE ' + set.rpe : ''}${set.rir != null ? ' · RIR ' + set.rir : ''}`,
      ])
        tr.append(node('td', String(value)));
      table.append(tr);
    }
  }
  function sessionDetail(s, correctable = false) {
    const p = panel('Session detail');
    stats(p, s);
    if (correctable && s.state === 'completed') annotationEditor(p, s, null);
    for (const entry of s.exercises) {
      const details = node('details');
      details.open = true;
      details.append(node('summary', entry.name + (entry.questionable ? ' · Questionable' : '')));
      p.append(details);
      empty(
        details,
        entry.planned
          ? `Planned: ${entry.planned.sets} × ${entry.planned.minReps}–${entry.planned.maxReps} · ${format(entry.planned.resistance)}`
          : 'Unplanned exercise',
      );
      empty(
        details,
        [entry.variation, entry.notes, entry.planned?.note, entry.note].filter(Boolean).join(' · '),
      );
      setTable(details, entry);
      const r = s.recommendations.find((r) => r.id === entry.id);
      if (r) {
        empty(details, `${r.outcome}: ${r.reason}`);
        decisionControls(details, s, entry, r);
      }
      if (correctable && s.state === 'completed') {
        annotationEditor(details, s, entry);
        if (entry.sets.length) correctionEditor(details, s, entry);
      }
    }
    for (const d of s.decisions)
      empty(
        p,
        `${d.at} · ${d.choice}${d.valid === false ? ' · Invalidated by correction; program change retained' : ''}${d.after ? ' · ' + format(d.after.resistance) : ''}`,
      );
    for (const c of s.corrections) empty(p, `Correction ${c.at}: ${c.note}`);
  }
  function decisionControls(parent, s, entry, r) {
    if (s.decisions.some((d) => d.entryId === entry.id && d.valid !== false)) return;
    const program = state.programs.find((p) => p.id === s.programId);
    parent.append(
      button('Keep Current', () =>
        save('decision', {
          sessionId: s.id,
          entryId: entry.id,
          choice: 'keep',
          expectedRevision: s.revision,
          requestId: requestId(),
        }),
      ),
    );
    if (!program || !entry.slotId) return;
    const slot = program.templates
      .find((t) => t.id === s.templateId)
      ?.exercises.find((e) => e.slotId === entry.slotId);
    empty(
      parent,
      `Current program revision: ${program.revision}. Current prescription: ${slot ? (ex(slot.exerciseId)?.name || slot.exerciseId) + ' · ' + slot.sets + ' × ' + slot.minReps + '–' + slot.maxReps + ' · ' + format(slot.resistance) : 'Slot removed'}. Applying a change updates future prescriptions only.`,
    );
    if (r.outcome === 'PROGRESS' && r.proposed)
      parent.append(
        button('Accept Progression', async () => {
          if (
            confirm(
              `Apply the recommendation to ${program.name}? Current revision ${program.revision}.`,
            )
          )
            await save('decision', {
              sessionId: s.id,
              entryId: entry.id,
              choice: 'accept',
              expectedRevision: s.revision,
              expectedProgramRevision: program.revision,
              requestId: requestId(),
            });
        }),
      );
    const details = node('details');
    details.append(node('summary', 'Set Manually'));
    parent.append(details);
    const exerciseId = select(
      details,
      'Next prescribed exercise',
      state.exercises.filter((e) => e.active).map((e) => [e.id, e.name]),
      entry.exerciseId,
    );
    const read = resistanceEditor(
      details,
      entry.planned?.resistance ?? entry.workingResistance,
      'Next prescribed resistance',
    );
    details.append(
      button('Apply manual prescription', async () => {
        if (confirm('Apply this manual change to the current program?'))
          await save('decision', {
            sessionId: s.id,
            entryId: entry.id,
            choice: 'manual',
            manual: { exerciseId: exerciseId.value, resistance: read() },
            expectedRevision: s.revision,
            expectedProgramRevision: program.revision,
            requestId: requestId(),
          });
      }),
    );
  }
  function annotationEditor(parent, s, entry) {
    const details = node('details');
    details.append(
      node(
        'summary',
        entry ? 'Correct exercise notes / uncertainty' : 'Correct session notes / uncertainty',
      ),
    );
    parent.append(details);
    const target = entry || s,
      note = field(details, 'History note', target.note, 'textarea'),
      uncertain = field(details, 'Questionable history result', target.questionable, 'checkbox');
    details.append(
      button('Save history annotation', async () => {
        if (confirm('Update this historical result and invalidate prior progression decisions?'))
          await save('correct', {
            sessionId: s.id,
            entryId: entry?.id,
            scope: entry ? 'exercise' : 'session',
            patch: { note: note.value, questionable: uncertain.checked },
            expectedRevision: s.revision,
            requestId: requestId(),
            confirmed: true,
          });
      }),
    );
  }
  function correctionEditor(parent, s, entry) {
    const details = node('details');
    details.append(node('summary', 'Correct a historical set'));
    parent.append(details);
    empty(
      details,
      'Correction recalculates recommendations and invalidates prior decisions. Previously applied program changes remain for deliberate manual review.',
    );
    const selectSet = select(
        details,
        'Set to correct',
        entry.sets.map((set) => [set.id, `Set ${set.order}`]),
        entry.sets[0].id,
      ),
      editor = node('div');
    details.append(editor);
    const fill = () => {
      editor.replaceChildren();
      const set = entry.sets.find((set) => set.id === selectSet.value);
      const read = setEditor(editor, set);
      editor.append(
        button('Save history correction', async () => {
          if (confirm('Correct this historical set and invalidate prior progression decisions?'))
            await save('correct', {
              sessionId: s.id,
              entryId: entry.id,
              setId: set.id,
              patch: read(),
              expectedRevision: s.revision,
              requestId: requestId(),
              confirmed: true,
            });
        }),
      );
    };
    selectSet.onchange = fill;
    fill();
  }
  function setEditor(parent, set) {
    const reps = field(parent, 'Reps', set.reps, 'number', true);
    reps.min = 1;
    reps.max = 1000;
    const read = resistanceEditor(parent, set.resistance);
    const type = select(
      parent,
      'Set type',
      ['normal', 'warmup', 'amrap', 'dropset', 'partials'].map((t) => [t, t]),
      set.type,
    );
    const note = field(parent, 'Set note', set.note, 'textarea'),
      questionable = field(parent, 'Questionable set', set.questionable, 'checkbox'),
      rpe = field(parent, 'RPE (optional)', set.rpe ?? '', 'number'),
      rir = field(parent, 'RIR (optional)', set.rir ?? '', 'number');
    rpe.step = 'any';
    rir.step = 'any';
    return () => ({
      reps: Number(reps.value),
      resistance: read(),
      type: type.value,
      note: note.value,
      questionable: questionable.checked,
      rpe: rpe.value === '' ? null : Number(rpe.value),
      rir: rir.value === '' ? null : Number(rir.value),
    });
  }
  async function action(s, action, data = {}) {
    const payload = {
      sessionId: s.id,
      action,
      expectedRevision: s.revision,
      requestId: requestId(),
      ...data,
    };
    if (['delete-set', 'skip', 'finish', 'abandon'].includes(action)) {
      const targetId =
        action === 'delete-set' ? data.setId : action === 'skip' ? data.entryId : null;
      const c = await api('workout/confirm', {
        userId: uid(),
        sessionId: s.id,
        action,
        targetId,
        expectedRevision: s.revision,
      });
      if (
        !confirm(
          `Confirm ${action}? ${s.exercises.reduce((n, e) => n + e.sets.filter((s) => s.type !== 'warmup').length, 0)} working sets logged.`,
        )
      )
        return;
      payload.confirmationToken = c.token;
    }
    await save('action', payload);
  }
  function active() {
    const s = state.active;
    if (!s) {
      const p = panel('Active workout');
      empty(p, 'No active workout. Start planned or free from Overview.');
      return;
    }
    const p = panel('Active workout');
    stats(p, s);
    const picker = select(
      p,
      'Exercise to add',
      [
        ['', 'Choose exercise'],
        ...state.exercises.filter((e) => e.active).map((e) => [e.id, e.name]),
      ],
      '',
    );
    p.append(button('Add exercise', () => action(s, 'add-exercise', { exerciseId: picker.value })));
    const e = s.exercises[s.currentIndex];
    if (e) {
      p.append(node('h3', e.name));
      empty(
        p,
        e.planned
          ? `Target ${e.planned.sets} × ${e.planned.minReps}–${e.planned.maxReps} · ${format(e.planned.resistance)}`
          : 'Unplanned exercise',
      );
      empty(p, `Working resistance: ${format(e.workingResistance)}`);
      if (e.previous) {
        empty(p, 'Previous: ' + e.previous.date.slice(0, 10));
        for (const prior of e.previous.exercises) setTable(p, prior);
      }
      setTable(p, e);
      const form = node('form');
      p.append(form);
      const reps = field(form, 'Reps to log', '', 'number', true);
      reps.min = 1;
      reps.max = 1000;
      form.append(node('button', 'Log Set'));
      form.onsubmit = (event) => {
        event.preventDefault();
        run(() => action(s, 'log', { reps: Number(reps.value) }));
      };
      p.append(
        button('Repeat Last', () => action(s, 'repeat')),
        button('Previous Exercise', () =>
          action(s, 'navigate', { index: Math.max(0, s.currentIndex - 1) }),
        ),
        button('Next Exercise', () =>
          action(s, 'navigate', { index: Math.min(s.exercises.length - 1, s.currentIndex + 1) }),
        ),
        button('Skip Exercise', () => action(s, 'skip', { entryId: e.id })),
      );
      const weight = node('details');
      weight.append(node('summary', 'Change Weight'));
      p.append(weight);
      const readWeight = resistanceEditor(weight, e.workingResistance);
      weight.append(
        button('Use this working resistance', () =>
          action(s, 'weight', { resistance: readWeight() }),
        ),
      );
      const edit = node('details');
      edit.append(node('summary', 'Edit / delete a set'));
      p.append(edit);
      const chosen = select(
        edit,
        'Set to edit',
        [['', 'Choose a set'], ...e.sets.map((set) => [set.id, 'Set ' + set.order])],
        '',
      );
      const editor = node('div');
      edit.append(editor);
      chosen.onchange = () => {
        editor.replaceChildren();
        const set = e.sets.find((set) => set.id === chosen.value);
        if (!set) return;
        const read = setEditor(editor, set);
        editor.append(
          button('Save set edit', () => action(s, 'edit-set', { setId: set.id, ...read() })),
          button('Delete Set', () => action(s, 'delete-set', { setId: set.id })),
        );
      };
      const note = field(p, 'Active exercise note', e.note, 'textarea'),
        uncertain = field(p, 'Questionable exercise', e.questionable, 'checkbox');
      p.append(
        button('Save exercise note', () =>
          action(s, 'exercise-note', { note: note.value, questionable: uncertain.checked }),
        ),
      );
    }
    const note = field(p, 'Session note', s.note, 'textarea'),
      uncertain = field(p, 'Questionable session', s.questionable, 'checkbox');
    p.append(
      button('Save session note', () =>
        action(s, 'session-note', { note: note.value, questionable: uncertain.checked }),
      ),
      button('Finish Workout', () => action(s, 'finish')),
      button('Abandon Workout', () => action(s, 'abandon')),
    );
  }
  function progression() {
    const p = panel('Progression');
    empty(
      p,
      'All prescribed working sets reaching the top of the range earn a recommendation. A late fatigue drop can maintain; clearly low performance triggers review. Mixed loads, uncertainty and unplanned work are handled explicitly. Programs change only when you accept or set a prescription manually.',
    );
    for (const s of state.sessions.filter((s) => s.state === 'completed')) {
      const details = node('details');
      details.append(node('summary', s.startedAt.slice(0, 10) + ' · ' + s.name));
      p.append(details);
      for (const entry of s.exercises) {
        const r = s.recommendations.find((r) => r.id === entry.id);
        if (r) {
          empty(details, `${entry.name}: ${r.outcome} — ${r.reason}`);
          decisionControls(details, s, entry, r);
        }
      }
    }
  }
  function settings() {
    const p = panel('Workout settings'),
      form = node('form');
    p.append(form);
    const units = select(
        form,
        'Default units for new exercises',
        [
          ['lb', 'lb'],
          ['kg', 'kg'],
        ],
        state.preferences.unit,
      ),
      allowed = field(
        form,
        'Allowed Discord workout user IDs (one per line)',
        state.preferences.allowedUserIds.join('\n'),
        'textarea',
      );
    empty(
      form,
      'Workout is available in configured servers and this bot’s DM. Server workout messages are visible to the channel; only the owning allowed user can control them. Each user has separate programs and sessions. This local authenticated admin can manage the selected user. Changing units does not convert existing loads.',
    );
    form.append(node('button', 'Save Workout settings'));
    form.onsubmit = (event) => {
      event.preventDefault();
      run(() =>
        save('preferences', {
          preferences: {
            unit: units.value,
            allowedUserIds: allowed.value.split(/[\s,]+/).filter(Boolean),
          },
        }),
      );
    };
  }
  function render() {
    root.replaceChildren();
    if (!state) return;
    (
      ({ overview, programs, exercises, history, progression, active, settings })[view] || overview
    )();
    for (const a of $('workoutTabs').querySelectorAll('a')) {
      if (a.pathname === location.pathname) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
  function locationNavigate(path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  for (const name of [
    'Overview',
    'Programs',
    'Exercises',
    'History',
    'Progression',
    'Active',
    'Settings',
  ])
    link(
      $('workoutTabs'),
      name,
      name === 'Overview' ? '/workout' : '/workout/' + name.toLowerCase(),
    );
  $('workoutRefresh').onclick = () =>
    run(async () => {
      editingExercise = null;
      editingProgram = null;
      draft = null;
      selectedSession = null;
      selectedExercise = null;
      await refresh();
    });
  document.addEventListener('admin:navigate', (event) => {
    if (event.detail.module?.id !== 'workout') return;
    view = event.detail.path.split('/')[2] || 'overview';
    run(async () => {
      if (!state || loadedUser !== uid()) await refresh();
      else render();
    });
  });
}
