import type { App } from '../app';

export function renderTasksView(app: App) {
  const s = app.state;
  const todo = s.tasks.filter(t => t.status === 'todo');
  const done = s.tasks.filter(t => t.status === 'done');

  return `
    <div class="header">
      <h1><i class="ph ph-check-circle"></i> Aufgaben</h1>
      <button class="icon-btn" onclick="openAddTaskModal()"><i class="ph ph-plus"></i></button>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Offen</div><span class="badge">${todo.length}</span></div>
      ${todo.length ? todo.map(t => `
        <div class="card">
          <div class="card-content" style="align-items: flex-start;">
            <button class="shopping-check" style="margin-top: 2px;" onclick="toggleTask('${t.id}')"></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name">${t.title}</div></div>
              ${t.description ? `<div class="task-meta">${t.description}</div>` : ''}
              <div class="task-meta">
                <span class="task-assignee"><i class="ph ph-user"></i> ${app.getMemberName(t.assigned_to)}</span>
                ${t.due_date ? `<span>· ${new Date(t.due_date).toLocaleDateString('de-DE')}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="deleteTask('${t.id}')"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `).join('') : `<div class="empty-state">Alles erledigt!</div>`}
    </div>

    ${done.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">Erledigt</div></div>
      ${done.map(t => `
        <div class="card" style="opacity: 0.6;">
          <div class="card-content" style="align-items: flex-start;">
            <button class="shopping-check checked" style="margin-top: 2px;" onclick="toggleTask('${t.id}')"><i class="ph-bold ph-check"></i></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name" style="text-decoration: line-through;">${t.title}</div></div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <script>
      async function openAddTaskModal() {
        const members = window.app.state.members.map(m => '<option value="' + m.id + '">' + m.name + '</option>').join('');
        window.app.showModal('taskModal',
          '<div class="modal-header"><div class="modal-title">Neue Aufgabe</div><button class="close-btn" onclick="window.app.closeModal(\'taskModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Titel</label><input type="text" id="taskTitle" placeholder="Was ist zu tun?"></div>' +
            '<div class="form-group"><label>Beschreibung</label><textarea id="taskDesc" rows="2" placeholder="Details..."></textarea></div>' +
            '<div class="form-group"><label>Zugewiesen an</label><select id="taskAssignee"><option value="">Niemand</option>' + members + '</select></div>' +
            '<div class="form-group"><label>Fällig am</label><input type="date" id="taskDue"></div>' +
            '<button class="btn" onclick="saveTask()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function saveTask() {
        const title = document.getElementById('taskTitle').value.trim();
        if (!title) return window.app.toast('Titel erforderlich');
        const task = await window.api.tasks.create({
          household_id: window.app.state.householdId,
          title,
          description: document.getElementById('taskDesc').value || null,
          assigned_to: document.getElementById('taskAssignee').value || null,
          due_date: document.getElementById('taskDue').value || null
        });
        window.app.state.tasks.push(task.task);
        window.app.closeModal('taskModal');
        window.app.render();
        window.app.toast('Aufgabe erstellt');
      }
      async function toggleTask(id) {
        const t = window.app.state.tasks.find(x => x.id === id);
        if (!t) return;
        const next = t.status === 'todo' ? 'done' : 'todo';
        await window.api.tasks.update(id, { status: next });
        t.status = next;
        window.app.render();
      }
      async function deleteTask(id) {
        if (!confirm('Löschen?')) return;
        await window.api.tasks.delete(id);
        window.app.state.tasks = window.app.state.tasks.filter(t => t.id !== id);
        window.app.render();
        window.app.toast('Gelöscht');
      }
    </script>
  `;
}
