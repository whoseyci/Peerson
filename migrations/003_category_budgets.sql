-- Migration: monthly budgets per expense category.
--
-- One budget per household per category, excluding 'settlement' expenses.
-- See functions/api/category-budgets.ts for API implementation.

CREATE TABLE IF NOT EXISTS category_budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_amount REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_budgets_household_category
  ON category_budgets(household_id, category);
