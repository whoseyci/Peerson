/**
 * Lightweight mock D1 for testing Pages Functions without a real database.
 */
export interface MockRow {
  [key: string]: any;
}

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

  prepare(sql: string) {
    const db = this;
    return {
      params: [] as any[],
      bind(...p: any[]) {
        this.params = p;
        return this;
      },
      async first(): Promise<MockRow | null> {
        const table = db.getTable(sql);
        const rows = db.tables.get(table) || [];
        if (table === 'household_members' && this.params.length >= 2) {
          const found = rows.find(r => r.household_id === this.params[0] && r.user_id === this.params[1]);
          if (found) return found;
        }
        return rows.find(r => db.matchWhere(r, this.params)) || null;
      },
      async all(): Promise<{ results: MockRow[] }> {
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
          const row: MockRow = { id: String(db.idCounter++) };
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
    members.push({ household_id: householdId, user_id: userId, role });
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
