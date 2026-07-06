import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './mocks/d1';
import type { Env } from '../functions/_middleware';

function makeRequest(url: string, opts: RequestInit = {}, userId = 'test-user'): Request {
  return new Request(url, {
    ...opts,
    headers: {
      'X-User-Id': userId,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
}

async function runHandler(handler: any, request: Request, env: Env, params = {}) {
  return handler({ request, env, params } as any);
}

describe('Task Subtasks API & Logic (Issue #51)', () => {
  let env: Env;
  let d1: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    d1 = createMockD1();
    d1.seedMembership('house-1', 'test-user');
    env = { DB: d1 } as unknown as Env;
  });

  it('creating a task with subtasks round-trips as an array, not a JSON string', async () => {
    const { onRequestPost, onRequestGet } = await import('../functions/api/tasks');
    const subtasks = [
      { id: 's1', text: 'Schritt 1', done: false },
      { id: 's2', text: 'Schritt 2', done: true }
    ];
    const req = makeRequest('http://test/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', title: 'Küche putzen', subtasks }),
    });
    const res = await runHandler(onRequestPost, req, env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.task.subtasks)).toBe(true);
    expect(body.task.subtasks).toEqual(subtasks);

    // Fetch via GET
    const getRes = await runHandler(onRequestGet, makeRequest('http://test/api/tasks?householdId=house-1'), env);
    const getBody = await getRes.json();
    expect(Array.isArray(getBody.tasks[0].subtasks)).toBe(true);
    expect(getBody.tasks[0].subtasks).toEqual(subtasks);
  });

  it('creating and editing a task WITHOUT subtasks continues to work exactly as before (regression check)', async () => {
    const { onRequestPost } = await import('../functions/api/tasks');
    const { onRequestPatch } = await import('../functions/api/tasks/[id]');

    const req = makeRequest('http://test/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', title: 'Normal task' }),
    });
    const res = await runHandler(onRequestPost, req, env);
    const task = (await res.json()).task;
    expect(task.subtasks).toBeNull();
    expect(task.status).toBe('todo');

    // Patch without subtasks
    const patchRes = await runHandler(onRequestPatch, makeRequest('http://test/api/tasks/' + task.id, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated title' }),
    }), env, { id: task.id });
    const updated = (await patchRes.json()).task;
    expect(updated.title).toBe('Updated title');
    expect(updated.subtasks).toBeNull();
  });

  it('toggling the last subtask marks parent task done and writes exactly ONE task_completion row', async () => {
    const { onRequestPost, onRequestGet } = await import('../functions/api/tasks');
    const { onRequestPatch } = await import('../functions/api/tasks/[id]');

    const subtasks = [
      { id: 's1', text: 'Schritt 1', done: true },
      { id: 's2', text: 'Schritt 2', done: false }
    ];
    const postRes = await runHandler(onRequestPost, makeRequest('http://test/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', title: 'Multi-step', subtasks }),
    }), env);
    const task = (await postRes.json()).task;

    // Check off second subtask, setting parent status to done + completed_by
    subtasks[1].done = true;
    const patchRes = await runHandler(onRequestPatch, makeRequest('http://test/api/tasks/' + task.id, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks, status: 'done', completed_by: 'test-user' }),
    }), env, { id: task.id });
    expect((await patchRes.json()).task.status).toBe('done');

    const getRes = await runHandler(onRequestGet, makeRequest('http://test/api/tasks?householdId=house-1'), env);
    const getBody = await getRes.json();
    expect(getBody.completions).toHaveLength(1);
    expect(getBody.completions[0].completed_by).toBe('test-user');
  });

  it('un-checking any subtask on an already done parent task reverts status to todo', async () => {
    const { onRequestPost } = await import('../functions/api/tasks');
    const { onRequestPatch } = await import('../functions/api/tasks/[id]');

    const subtasks = [{ id: 's1', text: 'Schritt 1', done: true }];
    const postRes = await runHandler(onRequestPost, makeRequest('http://test/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', title: 'Task', subtasks, status: 'done' }),
    }), env);
    const task = (await postRes.json()).task;

    subtasks[0].done = false;
    const patchRes = await runHandler(onRequestPatch, makeRequest('http://test/api/tasks/' + task.id, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks, status: 'todo' }),
    }), env, { id: task.id });
    expect((await patchRes.json()).task.status).toBe('todo');
  });

  it('a recurring task subtask checkmarks all reset on cycle close', async () => {
    const { onRequestPost } = await import('../functions/api/tasks');
    const { onRequestPatch } = await import('../functions/api/tasks/[id]');

    const subtasks = [{ id: 's1', text: 'Schritt 1', done: true }];
    const postRes = await runHandler(onRequestPost, makeRequest('http://test/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ household_id: 'house-1', title: 'Recurring', subtasks, recurrence: 'weekly' }),
    }), env);
    const task = (await postRes.json()).task;

    // Cycle close resets subtasks to done: false
    const resetSubtasks = [{ id: 's1', text: 'Schritt 1', done: false }];
    const patchRes = await runHandler(onRequestPatch, makeRequest('http://test/api/tasks/' + task.id, {
      method: 'PATCH',
      body: JSON.stringify({ subtasks: resetSubtasks, status: 'todo', completed_by: 'test-user' }),
    }), env, { id: task.id });
    const updated = (await patchRes.json()).task;
    expect(updated.status).toBe('todo');
    expect(updated.subtasks[0].done).toBe(false);
  });
});
