import { describe, it, expect } from 'vitest';
import { renderTasksView, toggleSubtaskInstant } from '../src/views/tasks';
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
