import type { Household, Item, Batch, Task, Expense, ShoppingItem, HouseholdMember } from '../types';

const API_BASE = '';

function headers() {
  const userId = localStorage.getItem('peerson_userId') || '';
  const userName = localStorage.getItem('peerson_userName') || '';
  const householdId = localStorage.getItem('peerson_householdId') || '';
  return {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
    'X-User-Name': userName,
    'X-Household-Id': householdId,
  };
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function get(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

async function post(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

async function patch(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

async function del(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

export const api = {
  households: {
    list: () => get('/api/households') as Promise<{ households: Household[] }>,
    get: (id: string) => get(`/api/households?householdId=${id}`) as Promise<{ household: Household; members: HouseholdMember[] }>,
    create: (name: string) => post('/api/households', { name }) as Promise<{ household: Household }>,
    join: (code: string) => post('/api/households', { action: 'join', code }) as Promise<{ household: Household }>,
    leave: (householdId: string, targetUserId: string) => post('/api/households', { action: 'leave', household_id: householdId, target_user_id: targetUserId }),
    kick: (householdId: string, targetUserId: string) => post('/api/households', { action: 'kick', household_id: householdId, target_user_id: targetUserId }),
    regenerateInvite: (id: string) => patch(`/api/households/${id}`, { invite_code: 'regenerate' }) as Promise<{ invite_code: string }>,
  },
  items: {
    list: (householdId: string) => get(`/api/items?householdId=${householdId}`) as Promise<{ items: Item[]; batches: Batch[] }>,
    create: (data: any) => post('/api/items', data) as Promise<{ item: Item }>,
    update: (id: string, data: any) => patch(`/api/items/${id}`, data) as Promise<{ item: Item }>,
    delete: (id: string) => del(`/api/items/${id}`),
  },
  batches: {
    create: (data: any) => post('/api/batches', data) as Promise<{ batch: Batch }>,
    update: (id: string, data: any) => patch(`/api/batches/${id}`, data) as Promise<{ batch: Batch }>,
    delete: (id: string) => del(`/api/batches/${id}`),
  },
  tasks: {
    list: (householdId: string) => get(`/api/tasks?householdId=${householdId}`) as Promise<{ tasks: Task[] }>,
    create: (data: any) => post('/api/tasks', data) as Promise<{ task: Task }>,
    update: (id: string, data: any) => patch(`/api/tasks/${id}`, data) as Promise<{ task: Task }>,
    delete: (id: string) => del(`/api/tasks/${id}`),
  },
  expenses: {
    list: (householdId: string) => get(`/api/expenses?householdId=${householdId}`) as Promise<{
      expenses: Expense[]; splits: any[]; members: HouseholdMember[]; balances: Record<string, number>
    }>,
    create: (data: any) => post('/api/expenses', data) as Promise<{ expense: Expense }>,
    delete: (id: string) => del(`/api/expenses/${id}`),
  },
  shopping: {
    list: (householdId: string) => get(`/api/shopping?householdId=${householdId}`) as Promise<{ items: ShoppingItem[] }>,
    create: (data: any) => post('/api/shopping', data) as Promise<{ item: ShoppingItem }>,
    update: (id: string, data: any) => patch(`/api/shopping/${id}`, data) as Promise<{ item: ShoppingItem }>,
    delete: (id: string) => del(`/api/shopping/${id}`),
  },
  users: {
    updateName: (name: string) => post('/api/users', { action: 'update_name', name }),
  },
};
