import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

describe('Build Output', () => {
  it('produces dist/index.html', () => {
    expect(existsSync('dist/index.html')).toBe(true);
  });

  it('produces JS and CSS assets', () => {
    const assets = readdirSync('dist/assets');
    expect(assets.some(f => f.endsWith('.js'))).toBe(true);
    expect(assets.some(f => f.endsWith('.css'))).toBe(true);
  });

  it('index.html references bundled assets', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('src="/assets/');
    expect(html).toContain('href="/assets/');
  });

  it('produces dist/manifest.json for PWA support', () => {
    expect(existsSync('dist/manifest.json')).toBe(true);
  });
});

describe('Wrangler Config', () => {
  it('has pages_build_output_dir', () => {
    const toml = readFileSync('wrangler.toml', 'utf-8');
    expect(toml).toContain('pages_build_output_dir');
    expect(toml).toContain('"dist"');
  });

  it('has D1 binding configured', () => {
    const toml = readFileSync('wrangler.toml', 'utf-8');
    expect(toml).toContain('[[d1_databases]]');
    expect(toml).toContain('binding = "DB"');
  });

  it('has compatibility_date', () => {
    const toml = readFileSync('wrangler.toml', 'utf-8');
    expect(toml).toContain('compatibility_date');
  });
});

describe('Schema SQL', () => {
  it('contains all required tables', () => {
    const sql = readFileSync('schema.sql', 'utf-8').toLowerCase();
    const required = [
      'households',
      'users',
      'household_members',
      'items',
      'batches',
      'tasks',
      'expenses',
      'expense_splits',
      'shopping_items',
      'task_completions',
    ];
    for (const table of required) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
  });

  it('contains performance indexes for foreign keys', () => {
    const sql = readFileSync('schema.sql', 'utf-8').toLowerCase();
    expect(sql).toContain('create index if not exists');
    expect(sql).toContain('idx_items_household');
    expect(sql).toContain('idx_batches_item');
    expect(sql).toContain('idx_expenses_household');
  });
});

describe('Functions Structure', () => {
  it('has all API routes', () => {
    const routes = [
      'functions/api/households.ts',
      'functions/api/households/[id].ts',
      'functions/api/items.ts',
      'functions/api/items/[id].ts',
      'functions/api/batches.ts',
      'functions/api/batches/[id].ts',
      'functions/api/tasks.ts',
      'functions/api/tasks/[id].ts',
      'functions/api/expenses.ts',
      'functions/api/expenses/[id].ts',
      'functions/api/shopping.ts',
      'functions/api/shopping/[id].ts',
      'functions/api/locations.ts',
      'functions/api/locations/[id].ts',
      'functions/api/items/[id]/price-history.ts',
      'functions/api/receipt-scan.ts',
      'functions/api/batches/move.ts',
      'functions/_middleware.ts',
    ];
    for (const route of routes) {
      expect(existsSync(route), `Missing ${route}`).toBe(true);
    }
  });

  it('has shared auth and error helpers instead of duplicated API boilerplate', () => {
    expect(existsSync('functions/auth.ts')).toBe(true);
    expect(existsSync('functions/http.ts')).toBe(true);
    const checkDir = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const content = readFileSync(path, 'utf-8');
        expect(content, `${path} should not redeclare requireMember`).not.toMatch(/function\s+requireMember\s*\(/);
        expect(content, `${path} should use jsonError() for standard error bodies`).not.toContain('new Response(JSON.stringify({ error');
      }
    };
    checkDir('functions/api');
  });

  it('has no external imports outside functions tree', () => {
    const checkDir = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const content = readFileSync(path, 'utf-8');
        const imports = content.match(/from\s+['"]([^'"]+)['"]/g) || [];
        for (const imp of imports) {
          const source = imp.match(/from\s+['"]([^'"]+)['"]/)![1];
          if (source.startsWith('.') && source.includes('lib/')) {
            throw new Error(`Illegal external import in ${path}: ${source}`);
          }
        }
      }
    };
    expect(() => checkDir('functions/api')).not.toThrow();
  });
});
