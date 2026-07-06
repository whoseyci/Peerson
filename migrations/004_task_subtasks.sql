-- Migration: optional multi-step task checklists (subtasks).
--
-- Adds JSON column `subtasks` to `tasks`.
-- See functions/api/tasks.ts and functions/api/tasks/[id].ts for API implementation.

ALTER TABLE tasks ADD COLUMN subtasks TEXT DEFAULT NULL;
