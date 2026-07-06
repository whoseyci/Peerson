import { describe, it, expect } from 'vitest';
import { fairnessSummary, startOfThisWeek } from '../src/utils/fairness';
import type { HouseholdMember, TaskCompletion } from '../src/types';

const members: HouseholdMember[] = [
  { id: 'alice', name: 'Alice', role: 'admin', joined_at: 0 },
  { id: 'bob', name: 'Bob', role: 'member', joined_at: 0 },
];

function completion(id: string, task_id: string, completed_by: string, completed_at: number): TaskCompletion {
  return { id, task_id, household_id: 'h1', completed_by, completed_at };
}

describe('fairnessSummary', () => {
  it('includes every member even with zero completions', () => {
    const result = fairnessSummary(members, []);
    expect(result).toEqual([
      { memberId: 'alice', memberName: 'Alice', completedCount: 0, lastCompletedAt: null },
      { memberId: 'bob', memberName: 'Bob', completedCount: 0, lastCompletedAt: null },
    ]);
  });

  it('counts completions per member and sorts most-active first', () => {
    const completions = [
      completion('c1', 't1', 'bob', 100),
      completion('c2', 't2', 'alice', 200),
      completion('c3', 't3', 'alice', 300),
      completion('c4', 't1', 'alice', 400),
    ];
    const result = fairnessSummary(members, completions);
    expect(result[0]).toMatchObject({ memberId: 'alice', completedCount: 3 });
    expect(result[1]).toMatchObject({ memberId: 'bob', completedCount: 1 });
  });

  it('tracks the most recent completion timestamp per member', () => {
    const completions = [
      completion('c1', 't1', 'alice', 100),
      completion('c2', 't1', 'alice', 500),
      completion('c3', 't1', 'alice', 300),
    ];
    const result = fairnessSummary(members, completions);
    expect(result.find(r => r.memberId === 'alice')?.lastCompletedAt).toBe(500);
  });

  it('filters to completions at or after `sinceSeconds` when provided', () => {
    const completions = [
      completion('c1', 't1', 'alice', 100),
      completion('c2', 't1', 'alice', 1000),
    ];
    const result = fairnessSummary(members, completions, 500);
    expect(result.find(r => r.memberId === 'alice')?.completedCount).toBe(1);
  });

  it('ignores completions from users who are no longer household members', () => {
    const completions = [completion('c1', 't1', 'ghost-user', 100)];
    const result = fairnessSummary(members, completions);
    expect(result.every(r => r.completedCount === 0)).toBe(true);
  });
});

describe('startOfThisWeek', () => {
  it('returns the preceding Monday at midnight for a mid-week date', () => {
    // Wednesday 2024-01-10 14:30 -> Monday 2024-01-08 00:00
    const wednesday = new Date(2024, 0, 10, 14, 30);
    const result = startOfThisWeek(wednesday);
    const expected = new Date(2024, 0, 8, 0, 0, 0, 0);
    expect(result).toBe(Math.floor(expected.getTime() / 1000));
  });

  it('treats Sunday as the last day of the previous week, not a new week start', () => {
    // Sunday 2024-01-14 -> Monday 2024-01-08
    const sunday = new Date(2024, 0, 14, 9, 0);
    const result = startOfThisWeek(sunday);
    const expected = new Date(2024, 0, 8, 0, 0, 0, 0);
    expect(result).toBe(Math.floor(expected.getTime() / 1000));
  });

  it('returns the same Monday for a Monday input', () => {
    const monday = new Date(2024, 0, 8, 23, 59);
    const result = startOfThisWeek(monday);
    const expected = new Date(2024, 0, 8, 0, 0, 0, 0);
    expect(result).toBe(Math.floor(expected.getTime() / 1000));
  });
});
