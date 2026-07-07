import type { Household, Item, Batch, Task, Expense, ShoppingItem, HouseholdMember, Location, ItemPriceHistoryEntry, TaskCompletion, CategoryBudget } from '../types';

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
    syncCheck: (householdId: string) => get(`/api/sync-check?householdId=${householdId}`) as Promise<{ lastModified: number }>,
  },
  items: {
    list: (householdId: string) => get(`/api/items?householdId=${householdId}`) as Promise<{ items: Item[]; batches: Batch[] }>,
    create: (data: any) => post('/api/items', data) as Promise<{ item: Item }>,
    update: (id: string, data: any) => patch(`/api/items/${id}`, data) as Promise<{ item: Item }>,
    delete: (id: string) => del(`/api/items/${id}`),
    priceHistory: (id: string) => get(`/api/items/${id}/price-history`) as Promise<{ history: ItemPriceHistoryEntry[] }>,
  },
  locations: {
    list: (householdId: string) => get(`/api/locations?householdId=${householdId}`) as Promise<{ locations: Location[] }>,
    create: (data: { household_id: string; name: string; parent_id?: string | null }) =>
      post('/api/locations', data) as Promise<{ location: Location }>,
    update: (id: string, data: { name?: string; parent_id?: string | null; sort_order?: number }) =>
      patch(`/api/locations/${id}`, data) as Promise<{ location: Location }>,
    delete: (id: string) => del(`/api/locations/${id}`),
  },
  batches: {
    create: (data: any) => post('/api/batches', data) as Promise<{ batch: Batch }>,
    update: (id: string, data: any) => patch(`/api/batches/${id}`, data) as Promise<{ batch: Batch }>,
    delete: (id: string) => del(`/api/batches/${id}`),
    move: (data: { item_id: string; from_location_id: string | null; to_location_id: string | null; quantity: number }) =>
      post('/api/batches/move', data) as Promise<{ moved: number; requested: number; batches: Batch[] }>,
  },
  tasks: {
    list: (householdId: string) => get(`/api/tasks?householdId=${householdId}`) as Promise<{ tasks: Task[]; completions: TaskCompletion[] }>,
    create: (data: any) => post('/api/tasks', data) as Promise<{ task: Task }>,
    update: (id: string, data: any) => patch(`/api/tasks/${id}`, data) as Promise<{ task: Task }>,
    delete: (id: string) => del(`/api/tasks/${id}`),
  },
  categoryBudgets: {
    list: (householdId: string) => get(`/api/category-budgets?householdId=${householdId}`) as Promise<{ budgets: CategoryBudget[] }>,
    upsert: (data: { household_id: string; category: string; monthly_amount: number }) =>
      post('/api/category-budgets', data) as Promise<{ budget: CategoryBudget }>,
    delete: (householdId: string, category: string) =>
      del(`/api/category-budgets?householdId=${encodeURIComponent(householdId)}&category=${encodeURIComponent(category)}`),
  },
  expenses: {
    list: (householdId: string) => get(`/api/expenses?householdId=${householdId}`) as Promise<{
      expenses: Expense[]; splits: any[]; members: HouseholdMember[]; balances: Record<string, number>
    }>,
    create: (data: any) => post('/api/expenses', data) as Promise<{ expense: Expense }>,
    update: (id: string, data: any) => patch(`/api/expenses/${id}`, data) as Promise<{ expense: Expense }>,
    markSettled: (householdId: string) => post('/api/expenses', { action: 'mark_settled', household_id: householdId }) as Promise<{ success: boolean }>,
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
  bugReport: {
    submit: (data: {
      title: string;
      description?: string;
      context?: Record<string, string>;
      lastActions?: string;
      screenshot?: string;
    }) => post('/api/bug-report', data) as Promise<{ url: string; number: number }>,
  },
  products: {
    lookup: (barcode: string) =>
      get(`/api/product-lookup?barcode=${encodeURIComponent(barcode)}`) as Promise<ProductLookupResult>,
  },
  receipts: {
    // A photo (data URL) of a receipt goes to a vision-LLM (see
    // functions/api/receipt-scan.ts for the exact provider/prompt) and
    // comes back as a draft list of line items for the user to review
    // and edit before anything is actually added to the shopping list --
    // see ReceiptScanResult for why this degrades gracefully when no API
    // key is configured server-side.
    scan: (imageDataUrl: string) => post('/api/receipt-scan', { image: imageDataUrl }) as Promise<ReceiptScanResult>,
  },
  push: {
    getConfig: (householdId: string) => get(`/api/push-subscribe?householdId=${encodeURIComponent(householdId)}`) as Promise<{ configured: boolean; vapidPublicKey: string | null; subscriptions: string[] }>,
    subscribe: (data: { household_id: string; endpoint: string; keys: { p256dh: string; auth: string } }) => post('/api/push-subscribe', data) as Promise<{ success: boolean }>,
    unsubscribe: (endpoint: string) => post('/api/push-unsubscribe', { endpoint }) as Promise<{ success: boolean }>,
  },
};

export interface ReceiptScanLineItem {
  name: string;
  price: number | null;
  quantity: string | null;
}

export interface ReceiptScanResult {
  configured: boolean;
  items: ReceiptScanLineItem[];
  total: number | null;
  merchant: string | null;
}

export interface ProductLookupResult {
  found: boolean;
  barcode: string;
  name?: string;
  category?: string;
  quantity?: string | null;
  imageUrl?: string | null;
  nutrition?: {
    energy_kcal_100g: number | null;
    fat_100g: number | null;
    carbohydrates_100g: number | null;
    proteins_100g: number | null;
  };
}

