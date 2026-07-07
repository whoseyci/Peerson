import type { App } from '../app';
import type { Task } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';

export function renderTasksView(app: App) {
  const s = app.state;
  const todo = s.tasks.filter(t => t.status === 'todo');
  const done = s.tasks.filter(t => t.status === 'done');

  return `
    <div class="header">
      <h1><i class="ph ph-check-circle"></i> Aufgaben</h1>
      <button class="icon-btn" onclick="openAddTaskModal()" title="Neue Aufgabe"><i class="ph ph-plus"></i></button>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Offen</div><span class="badge">${todo.length}</span></div>
      ${todo.length ? todo.map(t => {
        const recLabel = t.recurrence === 'daily' ? 'Täglich' : t.recurrence === 'weekly' ? 'Wöchentlich' : t.recurrence === 'monthly' ? 'Monatlich' : t.recurrence === 'irregular' ? 'Nach Bedarf' : '';
        const rotLabel = (t.recurrence !== 'irregular' && t.rotation_users && t.rotation_users.length > 1) ? ' (Rotation)' : '';
        const taskId = escapeJsAttr(t.id);
        const title = escapeHtml(t.title);
        const assignee = t.assigned_to ? escapeHtml(app.getMemberName(t.assigned_to)) : (t.recurrence === 'irregular' ? 'Frei · wer Zeit hat' : escapeHtml(app.getMemberName(t.assigned_to)));
        const subDone = Array.isArray(t.subtasks) ? t.subtasks.filter((s: any) => s.done).length : 0;
        const subTotal = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
        const subBadge = subTotal > 0 ? `<span class="chip ${subDone === subTotal ? 'good' : 'warn'}" style="margin-left:6px; font-weight:700;"><i class="ph ph-check-square"></i> ${subDone}/${subTotal}</span>` : '';
        return `
        <div class="card">
          <div class="card-content" style="align-items: flex-start;" onclick="openEditTaskModal('${taskId}')">
            <button class="shopping-check" style="margin-top: 2px;" onclick="event.stopPropagation(); toggleTask('${taskId}')" aria-label="${title} erledigen"></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name">${title}${subBadge}</div></div>
              ${t.description ? `<div class="task-meta">${escapeHtml(t.description)}</div>` : ''}
              <div class="task-meta">
                <span class="task-assignee"><i class="ph ph-user"></i> ${assignee}${rotLabel}</span>
                ${t.due_date ? `<span>· ${new Date(t.due_date).toLocaleDateString('de-DE')}</span>` : ''}
                ${recLabel ? `<span style="color:var(--accent); font-weight:600;">· <i class="ph ph-arrows-clockwise"></i> ${recLabel}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="event.stopPropagation(); deleteTask('${taskId}')" aria-label="${title} löschen"><i class="ph ph-trash"></i></button>
          </div>
        </div>`;
      }).join('') : `<div class="empty-state">Alles erledigt!</div>`}
    </div>

    ${done.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">Erledigt</div></div>
      ${done.map(t => {
        const taskId = escapeJsAttr(t.id);
        const title = escapeHtml(t.title);
        const subDone = Array.isArray(t.subtasks) ? t.subtasks.filter((s: any) => s.done).length : 0;
        const subTotal = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
        const subBadge = subTotal > 0 ? `<span class="chip good" style="margin-left:6px; font-weight:700;"><i class="ph ph-check-square"></i> ${subDone}/${subTotal}</span>` : '';
        return `
        <div class="card" style="opacity: 0.6;">
          <div class="card-content" style="align-items: flex-start;" onclick="openEditTaskModal('${taskId}')">
            <button class="shopping-check checked" style="margin-top: 2px;" onclick="event.stopPropagation(); toggleTask('${taskId}')" aria-label="${title} wieder öffnen"><i class="ph-bold ph-check"></i></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name" style="text-decoration: line-through;">${title}${subBadge}</div></div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="event.stopPropagation(); deleteTask('${taskId}')" aria-label="${title} löschen"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `}).join('')}
    </div>` : ''}
  `;
}

export async function openAddTaskModal() {
  const app = (window as any).app;
  taskSubtasksDraft = [];
  const members = app.state.members;
  const memberOptions = members.map((m: any) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  const rotCheckboxes = members.map((m: any) => `
    <label class="checkbox-label" style="font-size:0.85rem; padding:4px 0;">
      <input type="checkbox" class="rot-check" value="${escapeAttr(m.id)}" checked>
      <span>${escapeHtml(m.name)}</span>
    </label>
  `).join('');

  app.showModal('taskModal', `
    <div class="modal-header"><div class="modal-title">Neue Aufgabe</div><button class="close-btn" onclick="window.app.closeModal('taskModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>Titel</label><input type="text" id="taskTitle" placeholder="Was ist zu tun?"></div>
      <div class="form-group"><label>Beschreibung</label><textarea id="taskDesc" rows="2" placeholder="Details..."></textarea></div>
      <div class="form-group"><label>Zugewiesen an</label><select id="taskAssignee"><option value="">Niemand</option>${memberOptions}</select></div>
      <div class="form-group"><label>Fällig am</label><input type="date" id="taskDue"></div>
      <div class="form-group">
        <label>Wiederholung</label>
        <select id="taskRecurrence" onchange="document.getElementById('rotSection').style.display = this.value === 'daily' || this.value === 'weekly' || this.value === 'monthly' ? 'block' : 'none'; document.getElementById('irregularHint').style.display = this.value === 'irregular' ? 'block' : 'none';">
          <option value="">Einmalig</option>
          <option value="daily">Täglich</option>
          <option value="weekly">Wöchentlich</option>
          <option value="monthly">Monatlich</option>
          <option value="irregular">Nach Bedarf (unregelmäßig, für alle offen)</option>
        </select>
      </div>
      <div id="irregularHint" class="form-group" style="display:none; font-size:12.5px; color:var(--text-soft); background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <i class="ph ph-info"></i> Für Aufgaben ohne festen Rhythmus (z. B. Wäsche waschen) -- bleibt unzugewiesen und offen für alle, wird nach Erledigung nicht neu zugeteilt, sondern springt einfach wieder auf "offen" zurück, sobald es wieder nötig ist.
      </div>
      <div id="rotSection" class="form-group" style="display:none; background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <label style="margin-bottom:6px;">Team-Rotation (Wer wechselt sich ab?)</label>
        <div style="display:flex; flex-direction:column; gap:4px;">${rotCheckboxes}</div>
      </div>
      <div class="form-group" style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="margin:0">Checkliste (Unteraufgaben)</label>
          <button class="btn btn-small btn-secondary" type="button" onclick="addTaskSubtaskRow()"><i class="ph ph-plus"></i> Schritt hinzufügen</button>
        </div>
        <div id="taskSubtasksContainer" style="background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">${renderTaskSubtasksRows()}</div>
      </div>
      <button class="btn mt-2" onclick="saveTask()"><i class="ph-bold ph-check"></i> Aufgabe erstellen</button>
    </div>
  `);
}

export async function openEditTaskModal(id: string) {
  const app = (window as any).app;
  const t = app.state.tasks.find((x: any) => x.id === id);
  if (!t) return;
  taskSubtasksDraft = (Array.isArray(t.subtasks) ? t.subtasks : []).map((s: any) => ({ id: s.id || crypto.randomUUID(), text: s.text || '', done: !!s.done }));

  const members = app.state.members;
  const memberOptions = members.map((m: any) => `<option value="${escapeAttr(m.id)}" ${t.assigned_to === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
  const rotUsers = Array.isArray(t.rotation_users) ? t.rotation_users : [];
  const rotCheckboxes = members.map((m: any) => `
    <label class="checkbox-label" style="font-size:0.85rem; padding:4px 0;">
      <input type="checkbox" class="rot-check" value="${escapeAttr(m.id)}" ${rotUsers.includes(m.id) || !rotUsers.length ? 'checked' : ''}>
      <span>${escapeHtml(m.name)}</span>
    </label>
  `).join('');

  app.showModal('taskModal', `
    <div class="modal-header"><div class="modal-title">Aufgabe bearbeiten</div><button class="close-btn" onclick="window.app.closeModal('taskModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>Titel</label><input type="text" id="taskTitle" value="${escapeAttr(t.title)}"></div>
      <div class="form-group"><label>Beschreibung</label><textarea id="taskDesc" rows="2">${escapeHtml(t.description || '')}</textarea></div>
      <div class="form-group"><label>Zugewiesen an</label><select id="taskAssignee"><option value="">Niemand</option>${memberOptions}</select></div>
      <div class="form-group"><label>Fällig am</label><input type="date" id="taskDue" value="${t.due_date || ''}"></div>
      <div class="form-group">
        <label>Wiederholung</label>
        <select id="taskRecurrence" onchange="document.getElementById('rotSection').style.display = this.value === 'daily' || this.value === 'weekly' || this.value === 'monthly' ? 'block' : 'none'; document.getElementById('irregularHint').style.display = this.value === 'irregular' ? 'block' : 'none';">
          <option value="" ${!t.recurrence ? 'selected' : ''}>Einmalig</option>
          <option value="daily" ${t.recurrence === 'daily' ? 'selected' : ''}>Täglich</option>
          <option value="weekly" ${t.recurrence === 'weekly' ? 'selected' : ''}>Wöchentlich</option>
          <option value="monthly" ${t.recurrence === 'monthly' ? 'selected' : ''}>Monatlich</option>
          <option value="irregular" ${t.recurrence === 'irregular' ? 'selected' : ''}>Nach Bedarf (unregelmäßig, für alle offen)</option>
        </select>
      </div>
      <div id="irregularHint" class="form-group" style="display:${t.recurrence === 'irregular' ? 'block' : 'none'}; font-size:12.5px; color:var(--text-soft); background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <i class="ph ph-info"></i> Für Aufgaben ohne festen Rhythmus (z. B. Wäsche waschen) -- bleibt unzugewiesen und offen für alle, wird nach Erledigung nicht neu zugeteilt, sondern springt einfach wieder auf "offen" zurück, sobald es wieder nötig ist.
      </div>
      <div id="rotSection" class="form-group" style="display:${(t.recurrence && t.recurrence !== 'irregular') ? 'block' : 'none'}; background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <label style="margin-bottom:6px;">Team-Rotation (Wer wechselt sich ab?)</label>
        <div style="display:flex; flex-direction:column; gap:4px;">${rotCheckboxes}</div>
      </div>
      <div class="form-group" style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="margin:0">Checkliste (Unteraufgaben)</label>
          <button class="btn btn-small btn-secondary" type="button" onclick="addTaskSubtaskRow()"><i class="ph ph-plus"></i> Schritt hinzufügen</button>
        </div>
        <div id="taskSubtasksContainer" style="background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">${renderTaskSubtasksRows()}</div>
      </div>
      <button class="btn mt-2" onclick="updateExistingTask('${escapeJsAttr(t.id)}')"><i class="ph-bold ph-check"></i> Änderungen speichern</button>
    </div>
  `);
}

export async function saveTask() {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const title = (document.getElementById('taskTitle') as HTMLInputElement)?.value.trim();
    if (!title) return app.toast('Titel erforderlich');
    const recurrence = (document.getElementById('taskRecurrence') as HTMLSelectElement)?.value || null;
    // "Irregular" tasks (no fixed rhythm, e.g. laundry) deliberately have no
    // rotation -- they're open to whoever's available, not handed round a
    // fixed roster -- and start unassigned so they show up as genuinely
    // "up for grabs" rather than looking like someone's already on it.
    const isIrregular = recurrence === 'irregular';
    const rotChecks = Array.from(document.querySelectorAll('.rot-check:checked')) as HTMLInputElement[];
    const rotation_users = (recurrence && !isIrregular) ? rotChecks.map(c => c.value) : null;

    const cleanedSubtasks = taskSubtasksDraft.filter((s: any) => s.text.trim()).map((s: any) => ({ id: s.id, text: s.text.trim(), done: !!s.done }));
    const subtasks = cleanedSubtasks.length > 0 ? cleanedSubtasks : null;

    const task = await api.tasks.create({
      household_id: app.state.householdId,
      title,
      description: (document.getElementById('taskDesc') as HTMLTextAreaElement)?.value || null,
      assigned_to: isIrregular ? null : ((document.getElementById('taskAssignee') as HTMLSelectElement)?.value || null),
      due_date: isIrregular ? null : ((document.getElementById('taskDue') as HTMLInputElement)?.value || null),
      recurrence,
      rotation_users,
      subtasks
    });
    app.state.tasks.push(task.task);
    app.closeModal('taskModal');
    app.render();
    app.toast('Aufgabe erstellt');
  } catch (e) {
    app.toast('Fehler beim Erstellen');
  }
}

export async function updateExistingTask(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const title = (document.getElementById('taskTitle') as HTMLInputElement)?.value.trim();
    if (!title) return app.toast('Titel erforderlich');
    const recurrence = (document.getElementById('taskRecurrence') as HTMLSelectElement)?.value || null;
    const isIrregular = recurrence === 'irregular';
    const rotChecks = Array.from(document.querySelectorAll('.rot-check:checked')) as HTMLInputElement[];
    const rotation_users = (recurrence && !isIrregular) ? rotChecks.map(c => c.value) : null;

    const cleanedSubtasks = taskSubtasksDraft.filter((s: any) => s.text.trim()).map((s: any) => ({ id: s.id, text: s.text.trim(), done: !!s.done }));
    const subtasks = cleanedSubtasks.length > 0 ? cleanedSubtasks : null;
    const allDone = cleanedSubtasks.length > 0 && cleanedSubtasks.every((s: any) => s.done);
    const t = app.state.tasks.find((x: any) => x.id === id);

    let status = t ? t.status : 'todo';
    let assigned_to = isIrregular ? null : ((document.getElementById('taskAssignee') as HTMLSelectElement)?.value || null);
    let due_date = isIrregular ? null : ((document.getElementById('taskDue') as HTMLInputElement)?.value || null);
    let completed_by = null;

    if (cleanedSubtasks.length > 0) {
      if (allDone && t && t.status !== 'done') {
        if (isIrregular) {
          // No fixed rhythm and no rotation to hand off to -- just reset
          // the checklist and drop straight back to "open, unassigned"
          // rather than rotating an assignee or advancing a due date
          // that doesn't exist for this task type.
          cleanedSubtasks.forEach((s: any) => s.done = false);
          assigned_to = null;
          due_date = null;
          status = 'todo';
          completed_by = app.state.userId;
          app.toast('Erledigt! Aufgabe ist wieder offen, sobald sie erneut nötig ist.');
        } else if (recurrence) {
          // Recurring task with all subtasks checked! Reset subtasks and advance!
          cleanedSubtasks.forEach((s: any) => s.done = false);
          if (Array.isArray(rotation_users) && rotation_users.length > 0) {
            const currIdx = rotation_users.indexOf(assigned_to || '');
            const nextIdx = (currIdx + 1) % rotation_users.length;
            assigned_to = rotation_users[nextIdx];
          }
          if (due_date) {
            const d = new Date(due_date);
            if (recurrence === 'daily') d.setDate(d.getDate() + 1);
            else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
            else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
            due_date = d.toISOString().split('T')[0];
          }
          status = 'todo';
          completed_by = app.state.userId;
          app.toast('Wiederholende Aufgabe für nächste Runde fällig gestellt! (Checkliste zurückgesetzt)');
        } else {
          status = 'done';
          completed_by = app.state.userId;
        }
      } else if (!allDone && t && t.status === 'done') {
        status = 'todo';
      }
    }

    const data: any = {
      title,
      description: (document.getElementById('taskDesc') as HTMLTextAreaElement)?.value || null,
      assigned_to,
      due_date,
      recurrence,
      rotation_users,
      subtasks: cleanedSubtasks.length > 0 ? cleanedSubtasks : null,
      status
    };
    if (completed_by) data.completed_by = completed_by;

    await api.tasks.update(id, data);
    if (t) Object.assign(t, data);
    app.closeModal('taskModal');
    app.render();
    app.toast('Gespeichert');
  } catch (e) {
    app.toast('Fehler beim Speichern');
  }
}

export async function toggleTask(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const t = app.state.tasks.find((x: any) => x.id === id);
    if (!t) return;

    if (t.status === 'todo' && t.recurrence === 'irregular') {
      // No rotation, no due date to advance -- just log the completion
      // and leave it open/unassigned, ready to be picked up again
      // whenever it's next needed.
      await api.tasks.update(id, { status: 'todo', assigned_to: null, due_date: null, completed_by: app.state.userId });
      app.state.taskCompletions.unshift({ id: `local-${Date.now()}`, task_id: id, household_id: app.state.householdId, completed_by: app.state.userId, completed_at: Math.floor(Date.now() / 1000) });
      t.assigned_to = null;
      app.toast('Erledigt! Aufgabe ist wieder offen, sobald sie erneut nötig ist.');
      app.render();
      return;
    }

    if (t.status === 'todo' && t.recurrence) {
      let nextAssignee = t.assigned_to;
      if (Array.isArray(t.rotation_users) && t.rotation_users.length > 0) {
        const currIdx = t.rotation_users.indexOf(t.assigned_to || '');
        const nextIdx = (currIdx + 1) % t.rotation_users.length;
        nextAssignee = t.rotation_users[nextIdx];
      }

      let nextDue = t.due_date;
      if (t.due_date) {
        const d = new Date(t.due_date);
        if (t.recurrence === 'daily') d.setDate(d.getDate() + 1);
        else if (t.recurrence === 'weekly') d.setDate(d.getDate() + 7);
        else if (t.recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
        nextDue = d.toISOString().split('T')[0];
      }

      // completed_by is the person closing out *this* cycle (whoever is
      // actually tapping the checkmark right now) -- not nextAssignee,
      // who's just whoever the rotation hands the *next* cycle to. This
      // is what powers the People view's "who's actually been doing
      // things" fairness summary, so it must reflect the real completer
      // even though the task's own `assigned_to` field immediately moves
      // on to someone else in the same request.
      await api.tasks.update(id, { status: 'todo', assigned_to: nextAssignee, due_date: nextDue, completed_by: app.state.userId });
      app.state.taskCompletions.unshift({ id: `local-${Date.now()}`, task_id: id, household_id: app.state.householdId, completed_by: app.state.userId, completed_at: Math.floor(Date.now() / 1000) });
      t.assigned_to = nextAssignee;
      t.due_date = nextDue;
      app.toast('Wiederholende Aufgabe für nächste Runde fällig gestellt!');
      app.render();
      return;
    }

    const next = t.status === 'todo' ? 'done' : 'todo';
    const payload: any = { status: next };
    // Only a todo -> done transition is a "completion" worth logging --
    // reopening a done task (done -> todo, e.g. to fix a misclick) isn't
    // someone doing work, so it shouldn't count toward fairness tracking.
    if (next === 'done') {
      payload.completed_by = app.state.userId;
      app.state.taskCompletions.unshift({ id: `local-${Date.now()}`, task_id: id, household_id: app.state.householdId, completed_by: app.state.userId, completed_at: Math.floor(Date.now() / 1000) });
    }
    await api.tasks.update(id, payload);
    t.status = next;
    app.render();
  } catch (e) {
    app.toast('Fehler beim Aktualisieren');
  }
}


export async function deleteTask(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  const task = app.state.tasks.find((t: any) => t.id === id);
  if (!task) return;
  app.scheduleSoftDelete('task', task, app.state.tasks, '"' + task.title + '"', async () => {
    await api.tasks.delete(id);
  });
}


export async function toggleSubtaskInstant(taskId: string, idx: number, checked: boolean) {
  const app = (window as any).app;
  const api = (window as any).api;
  const t = app.state.tasks.find((x: any) => x.id === taskId);
  if (!t || !Array.isArray(t.subtasks) || !t.subtasks[idx]) return;

  t.subtasks[idx].done = checked;
  if (taskSubtasksDraft[idx]) taskSubtasksDraft[idx].done = checked;

  const allDone = t.subtasks.every((s: any) => s.done);
  let status = t.status;
  let assigned_to = t.assigned_to;
  let due_date = t.due_date;
  let completed_by = null;

  if (allDone && t.status !== 'done') {
    if (t.recurrence === 'irregular') {
      t.subtasks.forEach((s: any) => (s.done = false));
      if (taskSubtasksDraft.length) taskSubtasksDraft.forEach(s => (s.done = false));
      assigned_to = null;
      due_date = null;
      status = 'todo';
      completed_by = app.state.userId;
      app.toast('Erledigt! Aufgabe ist wieder offen, sobald sie erneut nötig ist.');
    } else if (t.recurrence) {
      t.subtasks.forEach((s: any) => (s.done = false));
      if (taskSubtasksDraft.length) taskSubtasksDraft.forEach(s => (s.done = false));
      if (Array.isArray(t.rotation_users) && t.rotation_users.length > 0) {
        const currIdx = t.rotation_users.indexOf(assigned_to || '');
        const nextIdx = (currIdx + 1) % t.rotation_users.length;
        assigned_to = t.rotation_users[nextIdx];
      }
      if (due_date) {
        const d = new Date(due_date);
        if (t.recurrence === 'daily') d.setDate(d.getDate() + 1);
        else if (t.recurrence === 'weekly') d.setDate(d.getDate() + 7);
        else if (t.recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
        due_date = d.toISOString().split('T')[0];
      }
      status = 'todo';
      completed_by = app.state.userId;
      app.toast('Wiederholende Aufgabe für nächste Runde fällig gestellt! (Checkliste zurückgesetzt)');
    } else {
      status = 'done';
      completed_by = app.state.userId;
    }
  } else if (!allDone && t.status === 'done') {
    status = 'todo';
  }

  const payload: any = { subtasks: t.subtasks, status, assigned_to, due_date };
  if (completed_by) payload.completed_by = completed_by;

  t.status = status;
  t.assigned_to = assigned_to;
  t.due_date = due_date;

  try {
    await api.tasks.update(taskId, payload);
    app.render();
  } catch (e) {
    app.toast('Fehler beim Aktualisieren');
  }
}

// Bind to window for HTML onclick handlers


let taskSubtasksDraft: Array<{ id: string; text: string; done: boolean }> = [];

export function renderTaskSubtasksRows(): string {
  if (!taskSubtasksDraft.length) {
    return '<div class="empty-state" style="padding:12px;">Keine Checklisten-Punkte</div>';
  }
  return taskSubtasksDraft
    .map(
      (sub, idx) =>
        '<div class="subtask-row" style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">' +
        '<input type="checkbox" class="subtask-row-check" ' +
        (sub.done ? 'checked' : '') +
        ' onchange="updateTaskSubtaskDone(' +
        idx +
        ', this.checked)">' +
        '<input type="text" class="subtask-row-text" placeholder="Schritt (z. B. Boden wischen)" value="' +
        escapeAttr(sub.text || '') +
        '" style="flex:1; padding:6px 10px; border-radius:6px; border:1px solid var(--border); background:var(--field-bg); color:var(--text); font-size:14px;" oninput="updateTaskSubtaskText(' +
        idx +
        ', this.value)">' +
        '<button class="icon-btn btn-mini" type="button" onclick="removeTaskSubtaskRow(' +
        idx +
        ')" title="Entfernen"><i class="ph ph-x"></i></button>' +
        '</div>'
    )
    .join('');
}

export function updateTaskSubtaskDone(idx: number, checked: boolean) {
  if (taskSubtasksDraft[idx]) {
    taskSubtasksDraft[idx].done = checked;
  }
}

export function updateTaskSubtaskText(idx: number, value: string) {
  if (taskSubtasksDraft[idx]) taskSubtasksDraft[idx].text = value;
}

export function addTaskSubtaskRow() {
  taskSubtasksDraft.push({
    id: crypto.randomUUID(),
    text: '',
    done: false,
  });
  const el = document.getElementById('taskSubtasksContainer');
  if (el) el.innerHTML = renderTaskSubtasksRows();
}

export function removeTaskSubtaskRow(idx: number) {
  taskSubtasksDraft.splice(idx, 1);
  const el = document.getElementById('taskSubtasksContainer');
  if (el) el.innerHTML = renderTaskSubtasksRows();
}


// Bind to window for HTML onclick handlers
if (typeof window !== 'undefined') {
  Object.assign(window as any, {
    openAddTaskModal,
    openEditTaskModal,
    saveTask,
    updateExistingTask,
    toggleTask,
    deleteTask,
    renderTaskSubtasksRows,
    updateTaskSubtaskDone,
    updateTaskSubtaskText,
    addTaskSubtaskRow,
    removeTaskSubtaskRow,
    toggleSubtaskInstant
  });
}
