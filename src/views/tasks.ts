import type { App } from '../app';
import type { Task } from '../types';

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
        const recLabel = t.recurrence === 'daily' ? '🔄 Täglich' : t.recurrence === 'weekly' ? '🔄 Wöchentlich' : t.recurrence === 'monthly' ? '🔄 Monatlich' : '';
        const rotLabel = (t.rotation_users && t.rotation_users.length > 1) ? ' (Rotation)' : '';
        return `
        <div class="card">
          <div class="card-content" style="align-items: flex-start;" onclick="openEditTaskModal('${t.id}')">
            <button class="shopping-check" style="margin-top: 2px;" onclick="event.stopPropagation(); toggleTask('${t.id}')"></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name">${t.title}</div></div>
              ${t.description ? `<div class="task-meta">${t.description}</div>` : ''}
              <div class="task-meta">
                <span class="task-assignee"><i class="ph ph-user"></i> ${app.getMemberName(t.assigned_to)}${rotLabel}</span>
                ${t.due_date ? `<span>· ${new Date(t.due_date).toLocaleDateString('de-DE')}</span>` : ''}
                ${recLabel ? `<span style="color:var(--accent); font-weight:600;">· ${recLabel}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="event.stopPropagation(); deleteTask('${t.id}')"><i class="ph ph-trash"></i></button>
          </div>
        </div>`;
      }).join('') : `<div class="empty-state">Alles erledigt!</div>`}
    </div>

    ${done.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">Erledigt</div></div>
      ${done.map(t => `
        <div class="card" style="opacity: 0.6;">
          <div class="card-content" style="align-items: flex-start;" onclick="openEditTaskModal('${t.id}')">
            <button class="shopping-check checked" style="margin-top: 2px;" onclick="event.stopPropagation(); toggleTask('${t.id}')"><i class="ph-bold ph-check"></i></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name" style="text-decoration: line-through;">${t.title}</div></div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="event.stopPropagation(); deleteTask('${t.id}')"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `).join('')}
    </div>` : ''}
  `;
}

export async function openAddTaskModal() {
  const app = (window as any).app;
  const members = app.state.members;
  const memberOptions = members.map((m: any) => `<option value="${m.id}">${m.name}</option>`).join('');
  const rotCheckboxes = members.map((m: any) => `
    <label class="checkbox-label" style="font-size:0.85rem; padding:4px 0;">
      <input type="checkbox" class="rot-check" value="${m.id}" checked>
      <span>${m.name}</span>
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
        <select id="taskRecurrence" onchange="document.getElementById('rotSection').style.display = this.value ? 'block' : 'none';">
          <option value="">Einmalig (Keine Wiederholung)</option>
          <option value="daily">🔄 Täglich</option>
          <option value="weekly">🔄 Wöchentlich</option>
          <option value="monthly">🔄 Monatlich</option>
        </select>
      </div>
      <div id="rotSection" class="form-group" style="display:none; background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <label style="margin-bottom:6px;">Team-Rotation (Wer wechselt sich ab?)</label>
        <div style="display:flex; flex-direction:column; gap:4px;">${rotCheckboxes}</div>
      </div>
      <button class="btn" onclick="saveTask()"><i class="ph-bold ph-check"></i> Aufgabe erstellen</button>
    </div>
  `);
}

export async function openEditTaskModal(id: string) {
  const app = (window as any).app;
  const t = app.state.tasks.find((x: any) => x.id === id);
  if (!t) return;

  const members = app.state.members;
  const memberOptions = members.map((m: any) => `<option value="${m.id}" ${t.assigned_to === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const rotUsers = Array.isArray(t.rotation_users) ? t.rotation_users : [];
  const rotCheckboxes = members.map((m: any) => `
    <label class="checkbox-label" style="font-size:0.85rem; padding:4px 0;">
      <input type="checkbox" class="rot-check" value="${m.id}" ${rotUsers.includes(m.id) || !rotUsers.length ? 'checked' : ''}>
      <span>${m.name}</span>
    </label>
  `).join('');

  app.showModal('taskModal', `
    <div class="modal-header"><div class="modal-title">Aufgabe bearbeiten</div><button class="close-btn" onclick="window.app.closeModal('taskModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>Titel</label><input type="text" id="taskTitle" value="${t.title.replace(/"/g, '&quot;')}"></div>
      <div class="form-group"><label>Beschreibung</label><textarea id="taskDesc" rows="2">${t.description || ''}</textarea></div>
      <div class="form-group"><label>Zugewiesen an</label><select id="taskAssignee"><option value="">Niemand</option>${memberOptions}</select></div>
      <div class="form-group"><label>Fällig am</label><input type="date" id="taskDue" value="${t.due_date || ''}"></div>
      <div class="form-group">
        <label>Wiederholung</label>
        <select id="taskRecurrence" onchange="document.getElementById('rotSection').style.display = this.value ? 'block' : 'none';">
          <option value="" ${!t.recurrence ? 'selected' : ''}>Einmalig (Keine Wiederholung)</option>
          <option value="daily" ${t.recurrence === 'daily' ? 'selected' : ''}>🔄 Täglich</option>
          <option value="weekly" ${t.recurrence === 'weekly' ? 'selected' : ''}>🔄 Wöchentlich</option>
          <option value="monthly" ${t.recurrence === 'monthly' ? 'selected' : ''}>🔄 Monatlich</option>
        </select>
      </div>
      <div id="rotSection" class="form-group" style="display:${t.recurrence ? 'block' : 'none'}; background:var(--field-bg); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <label style="margin-bottom:6px;">Team-Rotation (Wer wechselt sich ab?)</label>
        <div style="display:flex; flex-direction:column; gap:4px;">${rotCheckboxes}</div>
      </div>
      <button class="btn" onclick="updateExistingTask('${t.id}')"><i class="ph-bold ph-check"></i> Änderungen speichern</button>
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
    const rotChecks = Array.from(document.querySelectorAll('.rot-check:checked')) as HTMLInputElement[];
    const rotation_users = recurrence ? rotChecks.map(c => c.value) : null;

    const task = await api.tasks.create({
      household_id: app.state.householdId,
      title,
      description: (document.getElementById('taskDesc') as HTMLTextAreaElement)?.value || null,
      assigned_to: (document.getElementById('taskAssignee') as HTMLSelectElement)?.value || null,
      due_date: (document.getElementById('taskDue') as HTMLInputElement)?.value || null,
      recurrence,
      rotation_users
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
    const rotChecks = Array.from(document.querySelectorAll('.rot-check:checked')) as HTMLInputElement[];
    const rotation_users = recurrence ? rotChecks.map(c => c.value) : null;

    const data = {
      title,
      description: (document.getElementById('taskDesc') as HTMLTextAreaElement)?.value || null,
      assigned_to: (document.getElementById('taskAssignee') as HTMLSelectElement)?.value || null,
      due_date: (document.getElementById('taskDue') as HTMLInputElement)?.value || null,
      recurrence,
      rotation_users
    };
    await api.tasks.update(id, data);
    const t = app.state.tasks.find((x: any) => x.id === id);
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

      await api.tasks.update(id, { status: 'todo', assigned_to: nextAssignee, due_date: nextDue });
      t.assigned_to = nextAssignee;
      t.due_date = nextDue;
      app.toast('Wiederholende Aufgabe für nächste Runde fällig gestellt!');
      app.render();
      return;
    }

    const next = t.status === 'todo' ? 'done' : 'todo';
    await api.tasks.update(id, { status: next });
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

// Bind to window for HTML onclick handlers
Object.assign(window as any, {
  openAddTaskModal,
  openEditTaskModal,
  saveTask,
  updateExistingTask,
  toggleTask,
  deleteTask
});
