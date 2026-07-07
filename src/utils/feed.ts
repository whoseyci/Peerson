import type { AppState } from '../types';
import { personalBalanceLines } from './finance';
import { PREDICTED_LOW_STOCK_DAYS, predictConsumptionForItem } from './consumption';
import { BUDGET_CATEGORY_LABELS, budgetProgressLines, monthlySpentByCategory } from './budgets';
import { t } from '../i18n';

export interface FeedItem {
  key: string;
  kind: 'expiring' | 'lowstock' | 'predicted-low' | 'task' | 'balance' | 'budget';
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
  state: Pick<AppState, 'items' | 'batches' | 'tasks' | 'expenses' | 'splits' | 'members' | 'userId'> & Pick<Partial<AppState>, 'shopping' | 'categoryBudgets'>,
  snoozed: Set<string>
): FeedItem[] {
  const items: FeedItem[] = [];

  state.batches.forEach(b => {
    if (b.quantity <= 0 || !b.expiry) return;
    const days = daysUntil(b.expiry);
    if (days > 3) return;
    const item = state.items.find(i => i.id === b.item_id);
    if (!item) return;
    const key = `expiring:${b.id}`;
    if (snoozed.has(key)) return;
    const absDays = Math.abs(days);
    const plural = absDays === 1 ? '' : 'en';
    items.push({
      key,
      kind: 'expiring',
      icon: item.icon || 'package',
      title: item.name,
      sub: days < 0
        ? t('feed.expired.n', { days: absDays, plural })
        : days === 0
          ? t('feed.expiring.today')
          : t('feed.expiring.n', { days, plural }),
      urgency: days,
      refId: item.id,
    });
  });

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
        sub: t('feed.lowstock', { total: String(total), threshold: String(item.threshold) }),
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
        ? t('feed.predicted.tomorrow')
        : t('feed.predicted.n', { days: String(days) }),
      urgency: 8 + days,
      refId: item.id,
    });
  });

  state.tasks.forEach(task => {
    if (task.status !== 'todo' || !task.due_date) return;
    const days = daysUntil(task.due_date);
    if (days > 2) return;
    const key = `task:${task.id}`;
    if (snoozed.has(key)) return;
    const plural = Math.abs(days) === 1 ? '' : 'en';
    items.push({
      key,
      kind: 'task',
      icon: 'check-circle',
      title: task.title,
      sub: days < 0 ? t('feed.task.overdue') : days === 0 ? t('feed.task.today') : t('feed.task.n', { days: String(days), plural }),
      urgency: 5 + days,
      refId: task.id,
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
      title: line.direction === 'you_owe' ? t('feed.balance.youOwe', { name: line.memberName }) : t('feed.balance.owesYou', { name: line.memberName }),
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

      const catLabel = t(`expenses.cat.${line.category}`) || BUDGET_CATEGORY_LABELS[line.category] || line.category;
      items.push({
        key,
        kind: 'budget',
        icon: 'chart-pie-slice',
        title: t('feed.budget.title', { category: catLabel }),
        sub: isExceeded
          ? t('feed.budget.exceeded', { spent: spent.toFixed(2), budget: line.monthlyAmount.toFixed(2) })
          : t('feed.budget.projected', { projected: projected.toFixed(2), budget: line.monthlyAmount.toFixed(2) }),
        urgency: isExceeded ? 15 : 25,
        refId: line.category,
      });
    });
  }

  return items.sort((a, b) => a.urgency - b.urgency);
}

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
