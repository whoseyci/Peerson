import type { AppState } from '../types';
import { personalBalanceLines } from './finance';
import { PREDICTED_LOW_STOCK_DAYS, predictConsumptionForItem } from './consumption';
import { BUDGET_CATEGORY_LABELS, budgetProgressLines, monthlySpentByCategory } from './budgets';

// The Home view's "things that need your attention today" feed --
// deliberately a *pure* function of state (no DOM, no window) so it can be
// unit-tested directly and so app.ts's tab-badge count and home.ts's
// card-stack rendering can never drift out of sync (both call this exact
// function rather than each re-deriving their own notion of "what's
// urgent").
export interface FeedItem {
  // Stable, content-derived key (not a random id) so a snooze recorded
  // against e.g. "expiring:<batchId>" survives a background sync
  // re-render as long as the same batch is still the one that's expiring.
  key: string;
  kind: 'expiring' | 'lowstock' | 'predicted-low' | 'task' | 'balance' | 'budget';
  icon: string;
  title: string;
  sub: string;
  // Lower sorts first (more urgent). Not shown in the UI, purely for
  // ordering the stack + overflow list.
  urgency: number;
  // The id of the underlying record (item id / task id / member id) that
  // an action handler needs to actually do something about this entry.
  refId: string;
}

// Calendar-day difference (midnight-to-midnight), matching the same
// "due today counts as due, not overdue" semantics app.ts's own inline
// daysUntil() already uses for tab badges -- a raw ms/86400000 diff
// without normalizing hours would flip from "1 day left" to "0 days left"
// depending on what time of day it currently is, which is confusing for
// a due-date/expiry feed a household checks at random times.
function daysUntil(dateString?: string | null): number {
  if (!dateString) return 9999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export function computeFeed(
  state: Pick<AppState, 'items' | 'batches' | 'tasks' | 'expenses' | 'splits' | 'members' | 'userId'> & Pick<Partial<AppState>, 'shopping' | 'categoryBudgets'>,
  snoozed: Set<string>
): FeedItem[] {
  const items: FeedItem[] = [];

  // Expiring / already-expired batches, within 3 days either side of today.
  state.batches.forEach(b => {
    if (b.quantity <= 0 || !b.expiry) return;
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

  // Low-stock items that are not already on the open shopping list. If an
  // item is already below its static threshold, that concrete alert wins and
  // the predictive alert below is suppressed to avoid duplicate cards.
  const openShopping = state.shopping || [];
  state.items.forEach(item => {
    const total = state.batches.filter(b => b.item_id === item.id).reduce((a, b) => a + b.quantity, 0);
    const alreadyOnShoppingList = openShopping.some(sh =>
      sh.status === 'open' && (
        sh.linked_item_id === item.id || sh.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      )
    );
    if (alreadyOnShoppingList) return;

    if (total < item.threshold) {
      const key = `lowstock:${item.id}`;
      if (snoozed.has(key)) return;
      items.push({
        key,
        kind: 'lowstock',
        icon: item.icon || 'package',
        title: item.name,
        sub: `Nur noch ${total} von ${item.threshold} vorrätig`,
        // Bigger deficits are more urgent, so they need a *lower* number to
        // sort first alongside expiring items' day-counts (which can go
        // negative for already-expired stock) -- flip the deficit's sign
        // rather than just offsetting it.
        urgency: 10 - Math.max(0, item.threshold - total),
        refId: item.id,
      });
      return;
    }

    const prediction = predictConsumptionForItem(item.id, state.batches);
    if (!prediction || prediction.daysRemaining > PREDICTED_LOW_STOCK_DAYS) return;
    const key = `predicted-low:${item.id}`;
    if (snoozed.has(key)) return;
    const days = Math.max(0, Math.ceil(prediction.daysRemaining));
    items.push({
      key,
      kind: 'predicted-low',
      icon: item.icon || 'package',
      title: item.name,
      sub: days <= 1
        ? 'Voraussichtlich morgen leer'
        : `Reicht voraussichtlich noch ${days} Tage`,
      urgency: 8 + days,
      refId: item.id,
    });
  });

  // Tasks due within 2 days (or overdue), still open.
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

  // Unsettled personal balances.
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

  // Projected category-budget overruns (Issue #52 stretch scope): once
  // there's been *any* real spending in a budgeted category this month, we
  // linearly project "spend so far / days elapsed * days in month" to warn
  // before the budget is actually blown, not just after. A category that's
  // already over budget is always shown regardless of the projection (a
  // short/early month can't undercount an already-real overrun).
  if (state.categoryBudgets && state.categoryBudgets.length > 0) {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const spentByCategory = monthlySpentByCategory(state.expenses, now);

    budgetProgressLines(state.categoryBudgets, state.expenses, now).forEach(line => {
      const spent = spentByCategory[line.category] || 0;
      if (spent <= 0) return;
      const key = `budget:${line.category}`;
      if (snoozed.has(key)) return;

      const projected = (spent / Math.max(1, dayOfMonth)) * daysInMonth;
      const isExceeded = spent >= line.monthlyAmount;
      if (!isExceeded && projected <= line.monthlyAmount) return;

      const catLabel = BUDGET_CATEGORY_LABELS[line.category] || line.category;
      items.push({
        key,
        kind: 'budget',
        icon: 'chart-pie-slice',
        title: `Budget-Warnung: ${catLabel}`,
        sub: isExceeded
          ? `Budget überschritten (${spent.toFixed(2)} € von ${line.monthlyAmount.toFixed(2)} €)`
          : `Hochgerechnet ca. ${projected.toFixed(2)} € (Budget: ${line.monthlyAmount.toFixed(2)} €)`,
        urgency: isExceeded ? 15 : 25,
        refId: line.category,
      });
    });
  }

  return items.sort((a, b) => a.urgency - b.urgency);
}

// Per-household, per-day snooze bookkeeping shared by home.ts (to filter
// the feed it renders) and app.ts (so the Home tab's badge count matches
// exactly what the feed will show, never a stale pre-snooze number).
// Keyed by household so switching households on the same device never
// leaks one household's snoozed items into another's feed.
export function getSnoozedKeys(householdId: string | null): Set<string> {
  if (!householdId) return new Set();
  const storageKey = `peerson_home_snoozed_${householdId}`;
  let raw: Record<string, string> = {};
  try { raw = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { /* corrupt value, ignore */ }
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
  try { raw = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (e) { /* corrupt value, ignore */ }
  raw[key] = new Date().toISOString().slice(0, 10);
  localStorage.setItem(storageKey, JSON.stringify(raw));
}
