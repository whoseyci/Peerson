/**
 * Lightweight mock D1 for testing Pages Functions without a real database.
 */
export interface MockRow {
  [key: string]: any;
}

// Mirrors the DEFAULT clauses declared in schema.sql for columns commonly
// omitted from INSERT statements (server-assigned timestamps/statuses).
// The mock doesn't parse SQL DEFAULT clauses at all, so without this,
// INSERT rows silently end up with those columns `undefined` -- which
// would never catch a real bug like "POST handler echoes the request body
// instead of re-selecting the inserted row" (see functions/api/expenses.ts,
// batches.ts, shopping.ts -- all fixed to re-select after a bug where their
// created-row responses were missing created_at/date_added/status entirely,
// discovered via a UI audit that found "Invalid Date" appearing right after
// creating an expense/batch/shopping item).
const TABLE_DEFAULTS: Record<string, () => MockRow> = {
  items: () => ({ category: 'sonstiges', threshold: 0, barcodes: '[]', nutrition: '{}', created_at: Math.floor(Date.now() / 1000) }),
  batches: () => ({ quantity: 0, grams_per_unit: 0, date_added: Math.floor(Date.now() / 1000) }),
  tasks: () => ({ status: 'todo', created_at: Math.floor(Date.now() / 1000) }),
  expenses: () => ({ split_type: 'equal', created_at: Math.floor(Date.now() / 1000) }),
  shopping_items: () => ({ status: 'open', created_at: Math.floor(Date.now() / 1000) }),
  locations: () => ({ sort_order: 0, created_at: Math.floor(Date.now() / 1000) }),
  households: () => ({ created_at: Math.floor(Date.now() / 1000) }),
  household_members: () => ({ role: 'member', joined_at: Math.floor(Date.now() / 1000) }),
  category_budgets: () => ({ created_at: Math.floor(Date.now() / 1000) }),
};

export class MockD1Database {
  private tables: Map<string, MockRow[]> = new Map();
  private idCounter = 1;

  private getTable(sql: string): string {
    const lower = sql.toLowerCase();
    const fromMatch = lower.match(/from\s+(\w+)/);
    const intoMatch = lower.match(/into\s+(\w+)/);
    const updateMatch = lower.match(/update\s+(\w+)/);
    return (fromMatch || intoMatch || updateMatch)?.[1] || 'unknown';
  }

  private matchWhere(row: MockRow, params: any[]): boolean {
    return params.every(p => Object.values(row).includes(p));
  }

  // Extremely narrow support for the one JOIN shape actually used in this
  // codebase's handlers: "FROM <table> <alias> JOIN <table2> <alias2> ON
  // <a>.<col> = <b>.<col>" (see functions/api/batches/[id].ts's
  // "SELECT b.*, i.household_id FROM batches b JOIN items i ON
  // b.item_id = i.id" -- used to look up which household a batch belongs
  // to via its parent item). Not a real SQL engine: this only needs to
  // resolve exactly this single-join, single-condition pattern, since
  // that's the only one any handler in functions/api actually issues.
  private resolveJoin(sql: string): { rows: MockRow[]; table: string } | null {
    const joinMatch = sql.match(/from\s+(\w+)\s+(\w+)\s+join\s+(\w+)\s+(\w+)\s+on\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i);
    if (!joinMatch) return null;
    const [, table1, alias1, table2, alias2, leftAlias, leftCol, rightAlias, rightCol] = joinMatch;
    const rows1 = this.tables.get(table1.toLowerCase()) || [];
    const rows2 = this.tables.get(table2.toLowerCase()) || [];
    const [table1Col, table2Col] = leftAlias === alias1 ? [leftCol, rightCol] : [rightCol, leftCol];

    const joined = rows1.map(r1 => {
      const match = rows2.find(r2 => r2[table2Col] === r1[table1Col]);
      // Mirrors "SELECT b.*, i.household_id" -- the base table's own
      // columns win on conflict, with the joined table's columns merged
      // in underneath (real SQL would need explicit column lists to
      // avoid ambiguity; every actual usage in this codebase selects
      // `b.*` plus one specific joined column, so this ordering matches).
      return match ? { ...match, ...r1 } : null;
    }).filter((r): r is MockRow => r !== null);

    return { rows: joined, table: table1.toLowerCase() };
  }

  prepare(sql: string) {
    const db = this;
    return {
      params: [] as any[],
      bind(...p: any[]) {
        this.params = p;
        return this;
      },
      async first(): Promise<MockRow | null> {
        const joinResult = db.resolveJoin(sql);
        if (joinResult) {
          return joinResult.rows.find(r => db.matchWhere(r, this.params)) || null;
        }
        const table = db.getTable(sql);
        const rows = db.tables.get(table) || [];
        if (table === 'household_members' && this.params.length >= 2) {
          const found = rows.find(r => r.household_id === this.params[0] && r.user_id === this.params[1]);
          if (found) return found;
        }
        return rows.find(r => db.matchWhere(r, this.params)) || null;
      },
      async all(): Promise<{ results: MockRow[] }> {
        const joinResult = db.resolveJoin(sql);
        if (joinResult) {
          const filtered = this.params.length
            ? joinResult.rows.filter(r => db.matchWhere(r, this.params))
            : joinResult.rows;
          return { results: filtered };
        }
        const table = db.getTable(sql);
        const rows = db.tables.get(table) || [];
        const filtered = this.params.length
          ? rows.filter(r => db.matchWhere(r, this.params))
          : rows;
        return { results: filtered };
      },
      async run(): Promise<{ success: boolean }> {
        const table = db.getTable(sql);
        if (!db.tables.has(table)) db.tables.set(table, []);
        const rows = db.tables.get(table)!;

        const upper = sql.toUpperCase();
        if (upper.includes('INSERT')) {
          const defaults = TABLE_DEFAULTS[table]?.() || {};
          const row: MockRow = { id: String(db.idCounter++), ...defaults };
          const cols = upper.match(/\(([^)]+)\)/)?.[1].split(',').map(c => c.trim().toLowerCase());
          if (cols) {
            cols.forEach((col, i) => {
              if (this.params[i] !== undefined) row[col] = this.params[i];
            });
          } else {
            row._params = [...this.params];
          }
          rows.push(row);
        }
        if (upper.includes('DELETE')) {
          db.tables.set(table, rows.filter(r => !db.matchWhere(r, this.params)));
        }
        if (upper.includes('UPDATE')) {
          // Naive UPDATE: last param is WHERE id, preceding params are SET values
          const id = this.params[this.params.length - 1];
          const idx = rows.findIndex(r => r.id === id);
          if (idx >= 0) {
            const setParams = this.params.slice(0, -1);
            const setMatch = upper.match(/SET\s+(.+?)\s+WHERE/i);
            if (setMatch) {
              const setCols = setMatch[1].split(',').map(c => c.trim().split('=')[0].trim().toLowerCase());
              setCols.forEach((col, i) => {
                if (setParams[i] !== undefined) rows[idx][col] = setParams[i];
              });
            }
          }
        }
        return { success: true };
      },
    };
  }

  seed(table: string, rows: MockRow[]) {
    this.tables.set(table, rows);
  }

  seedMembership(householdId: string, userId: string, role = 'member') {
    const members = this.tables.get('household_members') || [];
    members.push({ household_id: householdId, user_id: userId, role, joined_at: Math.floor(Date.now() / 1000) });
    this.tables.set('household_members', members);
  }

  seedItem(item: MockRow) {
    const items = this.tables.get('items') || [];
    items.push(item);
    this.tables.set('items', items);
  }

  clear() {
    this.tables.clear();
    this.idCounter = 1;
  }
}

export function createMockD1(): MockD1Database {
  return new MockD1Database();
}
