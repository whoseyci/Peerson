import type { HouseholdMember, TaskCompletion } from '../types';

// Purely retrospective visibility into "who's actually been doing
// things" -- NOT a workflow change. Tasks stay assigned/rotated exactly
// as before; this only summarizes the append-only task_completions log
// (see schema.sql) for display in the People view. Every member with a
// household account gets an entry, even with zero completions, so
// "nobody's done anything yet" is visible rather than that member simply
// not appearing in a list.
export interface FairnessLine {
  memberId: string;
  memberName: string;
  completedCount: number;
  lastCompletedAt: number | null;
}

// `sinceSeconds` filters to completions at or after that unix timestamp
// (e.g. "this week"); omit it for all-time totals. Sorted most-active
// first so the summary reads naturally without the caller re-sorting.
export function fairnessSummary(
  members: HouseholdMember[],
  completions: TaskCompletion[],
  sinceSeconds?: number
): FairnessLine[] {
  const relevant = sinceSeconds !== undefined
    ? completions.filter(c => c.completed_at >= sinceSeconds)
    : completions;

  const countByMember = new Map<string, number>();
  const lastByMember = new Map<string, number>();
  for (const c of relevant) {
    countByMember.set(c.completed_by, (countByMember.get(c.completed_by) || 0) + 1);
    const prevLast = lastByMember.get(c.completed_by) || 0;
    if (c.completed_at > prevLast) lastByMember.set(c.completed_by, c.completed_at);
  }

  return members
    .map(m => ({
      memberId: m.id,
      memberName: m.name,
      completedCount: countByMember.get(m.id) || 0,
      lastCompletedAt: lastByMember.get(m.id) ?? null,
    }))
    .sort((a, b) => b.completedCount - a.completedCount);
}

// Start of the current ISO week (Monday 00:00 local time) as a unix
// timestamp -- matches how a household naturally thinks about "this
// week's chores" rather than a rolling 7-day window that shifts every day.
export function startOfThisWeek(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return Math.floor(d.getTime() / 1000);
}
