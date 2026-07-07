import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportHouseholdData, deleteAccount } from '../src/views/household';
import type { AppState, HouseholdMember } from '../src/types';

describe('Data Export & Account Deletion E2E / UI Flow Verification (Issue #54)', () => {
  const members: HouseholdMember[] = [
    { id: 'u1', name: 'Alice', role: 'admin', joined_at: 0 },
    { id: 'u2', name: 'Bob', role: 'member', joined_at: 0 },
  ];

  function createMockApp() {
    const state: Partial<AppState> = {
      userId: 'u1',
      userName: 'Alice',
      householdId: 'h1',
      household: { id: 'h1', name: 'WG Mitte', invite_code: 'ABC12345', created_at: 0 },
      members: [...members],
      view: 'household',
    };
    const toasts: string[] = [];
    return {
      state: state as AppState,
      toasts,
      toast: (msg: string) => { toasts.push(msg); },
      navigate: () => {},
      render: () => {},
      api: {
        export: {
          get: vi.fn(async (hId: string) => ({
            household: { id: hId, name: 'WG Mitte' },
            members: [...members],
            items: [{ id: 'item-1', name: 'Milk' }],
            batches: [],
            priceHistory: [],
            tasks: [],
            taskCompletions: [],
            expenses: [],
            expenseSplits: [],
            shoppingItems: [],
            locations: [],
            categoryBudgets: [],
          })),
        },
        users: {
          deleteAccount: vi.fn(async () => ({ success: true })),
        },
      },
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies E2E Household Data Export Flow: fetches export JSON, constructs Blob, triggers download, and toasts success', async () => {
    const app = createMockApp();
    
    let createdTag = '';
    let clickCalled = false;
    let appendedChild = false;
    let removedChild = false;
    let blobContent = '';

    const mockAnchor = {
      href: '',
      download: '',
      click: () => { clickCalled = true; },
    };

    const mockDoc = {
      createElement: (tag: string) => {
        createdTag = tag;
        return mockAnchor;
      },
      body: {
        appendChild: (el: any) => { if (el === mockAnchor) appendedChild = true; },
        removeChild: (el: any) => { if (el === mockAnchor) removedChild = true; },
      },
    };

    (globalThis as any).window = { app };
    (globalThis as any).document = mockDoc;
    (globalThis as any).Blob = class MockBlob {
      constructor(parts: any[], opts: any) {
        blobContent = parts[0];
      }
    };
    (globalThis as any).URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {},
    };

    await exportHouseholdData();

    // 1. Confirms API call was made for household id 'h1'
    expect(app.api.export.get).toHaveBeenCalledWith('h1');

    // 2. Confirms Blob was constructed with well-formed JSON containing expected resource keys
    const parsedBlob = JSON.parse(blobContent);
    expect(parsedBlob.household.id).toBe('h1');
    expect(parsedBlob.items[0].name).toBe('Milk');
    expect(parsedBlob).toHaveProperty('members');
    expect(parsedBlob).toHaveProperty('batches');
    expect(parsedBlob).toHaveProperty('priceHistory');
    expect(parsedBlob).toHaveProperty('tasks');
    expect(parsedBlob).toHaveProperty('taskCompletions');
    expect(parsedBlob).toHaveProperty('expenses');
    expect(parsedBlob).toHaveProperty('expenseSplits');
    expect(parsedBlob).toHaveProperty('shoppingItems');
    expect(parsedBlob).toHaveProperty('locations');
    expect(parsedBlob).toHaveProperty('categoryBudgets');

    // 3. Confirms anchor tag download attribute and DOM click lifecycle
    expect(createdTag).toBe('a');
    expect(mockAnchor.download).toContain('peerson-export-WG Mitte-');
    expect(appendedChild).toBe(true);
    expect(clickCalled).toBe(true);
    expect(removedChild).toBe(true);

    // 4. Confirms toast lifecycle
    expect(app.toasts).toContain('Daten werden exportiert...');
    expect(app.toasts).toContain('Export erfolgreich');
  });

  it('verifies E2E Account Deletion Flow: confirms dialog, calls API, wipes all peerson_* localStorage keys, logs out, and reloads', async () => {
    const app = createMockApp();
    let reloaded = false;

    // Seed mock localStorage with various app keys
    const storageStore: Record<string, string> = {
      'peerson_userId': 'u1',
      'peerson_userName': 'Alice',
      'peerson_householdId': 'h1',
      'peerson_view': 'tasks',
      'peerson_darkMode': 'true',
      'peerson_scanMode': '1d',
      'peerson_dismissed_sug_h1': '["item-1"]',
      'peerson_home_snoozed_h1': '{"123":true}',
      'unrelated_key': 'should_stay',
    };

    const mockLocalStorage = {
      getItem: (k: string) => storageStore[k] || null,
      setItem: (k: string, v: string) => { storageStore[k] = v; },
      removeItem: (k: string) => { delete storageStore[k]; },
      key: (idx: number) => Object.keys(storageStore)[idx] || null,
      get length() { return Object.keys(storageStore).length; },
    };

    (globalThis as any).window = { app };
    (globalThis as any).confirm = () => true; // user confirms deletion
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).location = {
      reload: () => { reloaded = true; },
    };

    await deleteAccount();

    // 1. Confirms API call was made to delete account
    expect(app.api.users.deleteAccount).toHaveBeenCalledTimes(1);

    // 2. Confirms all peerson_* keys were wiped from localStorage while unrelated keys stay intact
    expect(mockLocalStorage.getItem('peerson_userId')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_userName')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_householdId')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_view')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_darkMode')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_scanMode')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_dismissed_sug_h1')).toBeNull();
    expect(mockLocalStorage.getItem('peerson_home_snoozed_h1')).toBeNull();
    expect(mockLocalStorage.getItem('unrelated_key')).toBe('should_stay');

    // 3. Confirms app state was logged out / reset
    expect(app.state.userId).toBeNull();
    expect(app.state.userName).toBeNull();
    expect(app.state.householdId).toBeNull();
    expect(app.state.household).toBeNull();
    expect(app.state.members).toEqual([]);

    // 4. Confirms location.reload() was called to show fresh welcome screen
    expect(reloaded).toBe(true);
  });
});
