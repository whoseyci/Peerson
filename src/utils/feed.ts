import type { AppState } from '../types';
import { personalBalanceLines } from './finance';
import { computeCategoryBudgets } from './budgets';

export interface FeedItem {
  key: string;
  kind: 'expiring' | 'lowstock' | 'task' | 'balance' | 'budget';
  icon: string;
  title: string;
  sub: string;
  urgency: number;
  refId: string;
}

function daysUntil(dateString?: string | null): number {
  if (!dateString) return 9999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export function computeFeed(
  state: Pick<AppState, 'items' | 'batches' | 'tasks' | 'expenses' | 'splits' | 'members' | 'userId'> & Pick<Partial<AppState>, 'shopping' | 'budgets'>,
  snoozed: Set<string>
): FeedItem[] {
  const items: FeedItem[] = [];

  state.batches.forEach(b => {
    if (!b.expiry) return;
    const days = daysUntil(b.expiry);
    if (days > 3) return;
    const item = state.items.find(i => i.id === b.item_id);
    if (!item) return;
    const key = `expiring:${b.id}`;
    if (snoozed.has(key)) return;
    items.push({
      key,
      kind: 'expiring',
      icon: item.icon || 'package',
      title: item.name,
      sub: days < 0
        ? `Seit ${Math.abs(days)} Tag${Math.abs(days) === 1 ? '' : 'en'} abgelaufen`
        : days === 0
          ? 'Läuft heute ab'
          : `Läuft in ${days} Tag${days === 1 ? '' : 'en'} ab`,
      urgency: days,
      refId: item.id,
    });
  });

  const openShopping = state.shopping || [];
  state.items.forEach(item => {
    const total = state.batches.filter(b => b.item_id === item.id).reduce((a, b) => a + b.quantity, 0);
    if (total >= item.threshold) return;
    const alreadyOnShoppingList = openShopping.some(sh =>
      sh.status === 'open' && (
        sh.linked_item_id === item.id || sh.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      )
    );
    if (alreadyOnShoppingList) return;
    const key = `lowstock:${item.id}`;
    if (snoozed.has(key)) return;
    items.push({
      key,
      kind: 'lowstock',
      icon: item.icon || 'package',
      title: item.name,
      sub: `Nur noch ${total} von ${item.threshold} vorrätig`,
      urgency: 10 - Math.max(0, item.threshold - total),
      refId: item.id,
    });
  });

  state.tasks.forEach(t => {
    if (t.status !== 'todo' || !t.due_date) return;
    const days = daysUntil(t.due_date);
    if (days > 2) return;
    const key = `task:${t.id}`;
    if (snoozed.has(key)) return;
    items.push({
      key,
      kind: 'task',
      icon: 'check-circle',
      title: t.title,
      sub: days < 0 ? 'Überfällig' : days === 0 ? 'Heute fällig' : `In ${days} Tag${days === 1 ? '' : 'en'} fällig`,
      urgency: 5 + days,
      refId: t.id,
    });
  });

  const balances = personalBalanceLines(state.userId, state.members, state.expenses, state.splits);
  balances.forEach(line => {
    const key = `balance:${line.memberId}`;
    if (snoozed.has(key)) return;
    items.push({
      key,
      kind: 'balance',
      icon: line.direction === 'you_owe' ? 'arrow-up-right' : 'arrow-down-left',
      title: line.direction === 'you_owe' ? `Du schuldest ${line.memberName}` : `${line.memberName} schuldet dir`,
      sub: `${line.amount.toFixed(2)} €`,
      urgency: 50,
      refId: line.memberId,
    });
  });

  // Projected budget overruns (stretch scope Issue #52)
  if (state.budgets && state.budgets.length > 0 && state.expenses) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const summaries = computeCategoryBudgets(state.expenses, state.budgets, now);

    for (const sum of summaries) {
      if (!sum.budgetAmount || sum.spent <= 0) continue;
      const key = `budget:${sum.category}`;
      if (snoozed.has(key)) continue;

      const projected = (sum.spent / Math.max(1, dayOfMonth)) * daysInMonth;
      if (projected > sum.budgetAmount || sum.spent >= sum.budgetAmount) {
        const catLabel = sum.category.charAt(0).toUpperCase() + sum.category.slice(1);
        const isExceeded = sum.spent >= sum.budgetAmount;
        items.push({
          key,
          kind: 'budget',
          icon: 'chart-pie-slice',
          title: `Budget-Warnung: ${catLabel}`,
          sub: isExceeded
            ? `Budget überschritten (${sum.spent.toFixed(2)} € von ${sum.budgetAmount.toFixed(2)} €)`
            : `Hochgerechnet ca. ${projected.toFixed(2)} € (Budget: ${sum.budgetAmount.toFixed(2)} €)`,
          urgency: isExceeded ? 15 : 25,
          refId: sum.category,
        });
      }
    }
  }

  return items.sort((a, b) => a.urgency - b.urgency);
}

export function getSnoozedKeys(householdId: string | null): Set<string> {
  if (!householdId) return new Set();
  const storageKey = `peerson_home_snoozed_${householdId}`;
  let raw: Record<string, string> = {};
  try { raw = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { }
  const today = new Date().toISOString().slice(0, 10);
  const active = new Set<string>();
  Object.entries(raw).forEach(([key, snoozedOnDate]) => {
    if (snoozedOnDate === today) active.add(key);
  });
  return active;
}

export function snoozeKey(householdId: string | null, key: string) {
  if (!householdId) return;
  const storageKey = `peerson_home_snoozed_${householdId}`;
  let raw: Record<string, string> = {};
  try { raw = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { }
  raw[key] = new Date().toISOString().slice(0, 10);
  localStorage.setItem(storageKey, JSON.stringify(raw));
}
