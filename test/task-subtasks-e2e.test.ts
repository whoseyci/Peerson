import { describe, it, expect, vi } from 'vitest';
import { renderTasksView, toggleSubtaskInstant, toggleTask } from '../src/views/tasks';
import type { AppState, Task, HouseholdMember } from '../src/types';

describe('Task Subtasks E2E / UI Logic Verification (Issue #51)', () => {
  const members: HouseholdMember[] = [
    { id: 'u1', name: 'Alice', role: 'admin', joined_at: 0 },
  ];

  function createMockApp(tasks: Task[]) {
    const state: Partial<AppState> = {
      userId: 'u1',
      userName: 'Alice',
      householdId: 'h1',
      household: { id: 'h1', name: 'WG Mitte', invite_code: 'ABC12345', created_at: 0 },
      members,
      tasks,
      view: 'tasks',
    };
    let lastRenderHtml = '';
    return {
      state: state as AppState,
      getMemberName: (id: string) => members.find(m => m.id === id)?.name || id,
      render: function() {
        lastRenderHtml = renderTasksView(this);
      },
      getHtml: () => lastRenderHtml,
      toast: () => {},
    } as any;
  }

  it('verifies creating a task with 3 subtasks, checking them off one by one, progress badge updates, and reverts', async () => {
    const tasks: Task[] = [
      {
        id: 't1',
        household_id: 'h1',
        title: 'Küche putzen',
        status: 'todo',
        created_at: 0,
        subtasks: [
          { id: 'sub-1', text: 'Geschirrspüler ausräumen', done: false },
          { id: 'sub-2', text: 'Arbeitsflächen abwischen', done: false },
          { id: 'sub-3', text: 'Boden wischen', done: false },
        ]
      }
    ];

    const app = createMockApp(tasks);
    (globalThis as any).window = { app, api: { tasks: { update: async () => {} } } };
    app.render();

    // 1. Initial render shows 0/3 chip
    expect(app.getHtml()).toContain('0/3');
    expect(app.getHtml()).toContain('class="chip warn"');
    expect(tasks[0].status).toBe('todo');

    // 2. Check off first subtask
    await toggleSubtaskInstant('t1', 0, true);
    expect(app.getHtml()).toContain('1/3');
    expect(tasks[0].status).toBe('todo');

    // 3. Check off second subtask
    await toggleSubtaskInstant('t1', 1, true);
    expect(app.getHtml()).toContain('2/3');
    expect(tasks[0].status).toBe('todo');

    // 4. Check off third (last) subtask -> parent transitions to done!
    await toggleSubtaskInstant('t1', 2, true);
    expect(app.getHtml()).toContain('3/3');
    expect(app.getHtml()).toContain('class="chip good"');
    expect(tasks[0].status).toBe('done');

    // 5. Uncheck one subtask -> reverts to todo!
    await toggleSubtaskInstant('t1', 1, false);
    expect(app.getHtml()).toContain('2/3');
    expect(tasks[0].status).toBe('todo');
  });

  it('verifies a plain task without subtasks works exactly as before (regression check)', () => {
    const tasks: Task[] = [
      { id: 't2', household_id: 'h1', title: 'Müll rausbringen', status: 'todo', created_at: 0 }
    ];
    const app = createMockApp(tasks);
    app.render();
    expect(app.getHtml()).toContain('Müll rausbringen');
    expect(app.getHtml()).not.toContain('chip'); // no subtask chip
    expect(tasks[0].status).toBe('todo');
  });
});

describe('Irregular (unassigned, no-fixed-rhythm) tasks', () => {
  const members: HouseholdMember[] = [
    { id: 'u1', name: 'Alice', role: 'admin', joined_at: 0 },
  ];

  function createMockApp(tasks: Task[]) {
    const state: Partial<AppState> = {
      userId: 'u1',
      userName: 'Alice',
      householdId: 'h1',
      household: { id: 'h1', name: 'WG Mitte', invite_code: 'ABC12345', created_at: 0 },
      members,
      tasks,
      taskCompletions: [],
      view: 'tasks',
    };
    return { state: state as AppState, getMemberName: (id?: string) => members.find(m => m.id === id)?.name || 'Niemand', render: () => {}, toast: () => {} } as any;
  }

  it('renders an unassigned irregular task with a "free for anyone" label instead of a blank assignee', () => {
    const tasks: Task[] = [
      { id: 't1', household_id: 'h1', title: 'Wäsche waschen', status: 'todo', recurrence: 'irregular', assigned_to: undefined, created_at: 0 },
    ];
    const app = createMockApp(tasks);
    const html = renderTasksView(app);
    expect(html).toContain('Wäsche waschen');
    expect(html).toContain('Frei · wer Zeit hat');
    expect(html).toContain('Nach Bedarf');
  });

  it('toggleTask on a plain irregular task logs a completion and resets to open/unassigned (no rotation, no due-date math)', async () => {
    const tasks: Task[] = [
      { id: 't1', household_id: 'h1', title: 'Wäsche waschen', status: 'todo', recurrence: 'irregular', assigned_to: 'u1', created_at: 0 },
    ];
    const app = createMockApp(tasks);
    const updateCalls: any[] = [];
    (globalThis as any).window = { app, api: { tasks: { update: async (id: string, data: any) => { updateCalls.push({ id, data }); } } } };

    await toggleTask('t1');

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data).toMatchObject({ status: 'todo', assigned_to: null, due_date: null, completed_by: 'u1' });
    expect(tasks[0].assigned_to).toBeNull();
    expect(tasks[0].status).toBe('todo');
    expect(app.state.taskCompletions).toHaveLength(1);
    expect(app.state.taskCompletions[0].completed_by).toBe('u1');
  });

  it('toggleSubtaskInstant on an irregular task with a checklist resets the checklist AND unassigns on last-subtask completion', async () => {
    const tasks: Task[] = [
      {
        id: 't1', household_id: 'h1', title: 'Wäsche waschen', status: 'todo', recurrence: 'irregular', assigned_to: 'u1', created_at: 0,
        subtasks: [
          { id: 's1', text: 'Waschmaschine anstellen', done: true },
          { id: 's2', text: 'Wäsche aufhängen', done: false },
        ],
      },
    ];
    const app = createMockApp(tasks);
    const updateCalls: any[] = [];
    (globalThis as any).window = { app, api: { tasks: { update: async (id: string, data: any) => { updateCalls.push({ id, data }); } } }, closeModal: () => {} };

    await toggleSubtaskInstant('t1', 1, true);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data.status).toBe('todo');
    expect(updateCalls[0].data.assigned_to).toBeNull();
    expect(updateCalls[0].data.due_date).toBeNull();
    expect(updateCalls[0].data.completed_by).toBe('u1');
    expect(tasks[0].subtasks!.every(s => !s.done)).toBe(true);
    expect(tasks[0].assigned_to).toBeNull();
    expect(tasks[0].status).toBe('todo');
  });

  it('a recurring (non-irregular) task with rotation is unaffected by the irregular-task changes (regression check)', async () => {
    const tasks: Task[] = [
      { id: 't1', household_id: 'h1', title: 'Müll rausbringen', status: 'todo', recurrence: 'weekly', assigned_to: 'u1', rotation_users: ['u1'], due_date: '2026-07-01', created_at: 0 },
    ];
    const app = createMockApp(tasks);
    const updateCalls: any[] = [];
    (globalThis as any).window = { app, api: { tasks: { update: async (id: string, data: any) => { updateCalls.push({ id, data }); } } } };

    await toggleTask('t1');

    expect(updateCalls[0].data.assigned_to).toBe('u1'); // only member in rotation, rotates back to itself
    expect(updateCalls[0].data.due_date).toBe('2026-07-08'); // advanced by a week, unlike irregular tasks
    expect(updateCalls[0].data.completed_by).toBe('u1');
  });
});
