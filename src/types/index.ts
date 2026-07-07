export interface User {
  id: string;
  name: string;
}

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  created_at: number;
}

export interface HouseholdMember {
  id: string;
  name: string;
  role: string;
  joined_at: number;
}

export interface Item {
  id: string;
  household_id: string;
  name: string;
  category: string;
  icon?: string;
  threshold: number;
  location?: string;
  location_id?: string | null;
  barcodes: Barcode[];
  nutrition: Record<string, number>;
  price_cents?: number | null;
  created_by?: string;
  recurrence?: string | null;
  rotation_users?: string[] | null;
}

export interface Barcode {
  code: string;
  grams: number;
}

// A node in a household's nested storage-location tree, e.g.
// "Küche" (parent_id: null) -> "Rollcontainer" (parent_id: <Küche.id>) ->
// "oben" (parent_id: <Rollcontainer.id>). Managed in Settings; items point
// at a single leaf-or-any-level location via Item.location_id.
export interface Location {
  id: string;
  household_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

// One superseded price for an item. Only created when the price actually
// changes (see functions/api/items/[id].ts) -- the *current* price lives on
// Item.price_cents, not here. effective_until is always set for history
// rows (the currently-active price has no row here at all).
export interface ItemPriceHistoryEntry {
  id: string;
  item_id: string;
  price_cents: number;
  effective_from: number;
  effective_until: number;
}


export interface Batch {
  id: string;
  item_id: string;
  quantity: number;
  expiry?: string;
  barcode_code?: string;
  grams_per_unit: number;
  date_added: number;
  price?: number | null;
  initial_quantity?: number | null;
  consumed_at?: number | null;
  // Where this specific batch physically is, if it differs from the
  // item's own location_id (e.g. half the "Milch" batches are in the
  // kitchen fridge, one just-bought batch is still in the garage fridge).
  // null/undefined means "inherit the item's location_id" -- the
  // pre-existing single-location-per-item behavior.
  location_id?: string | null;
}

export interface Task {
  id: string;
  household_id: string;
  title: string;
  description?: string;
  assigned_to?: string;
  status: 'todo' | 'done';
  due_date?: string;
  created_by?: string;
  recurrence?: string | null;
  rotation_users?: string[] | null;
}

// One row per completed to-do (append-only log, see schema.sql) -- powers
// the People view's "who's actually been doing things" fairness summary.
export interface TaskCompletion {
  id: string;
  task_id: string;
  household_id: string;
  completed_by: string;
  completed_at: number;
}

export interface CategoryBudget {
  id: string;
  household_id: string;
  category: string;
  monthly_amount: number;
  created_at: number;
}

export interface Expense {
  id: string;
  household_id: string;
  title: string;
  amount: number;
  paid_by: string;
  split_type: string;
  category?: string;
  created_at: number;
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  user_id: string;
  amount: number;
  settled: number;
}

export interface ShoppingItem {
  id: string;
  household_id: string;
  name: string;
  quantity?: string;
  requested_by?: string;
  status: 'open' | 'bought';
  linked_item_id?: string;
  price?: number | null;
}

export interface AppState {
  userId: string;
  userName: string;
  householdId: string | null;
  household: Household | null;
  members: HouseholdMember[];
  items: Item[];
  batches: Batch[];
  tasks: Task[];
  expenses: Expense[];
  splits: ExpenseSplit[];
  categoryBudgets: CategoryBudget[];
  shopping: ShoppingItem[];
  locations: Location[];
  // Task-completion log for the whole household, loaded alongside tasks --
  // powers the People view's fairness summary. Kept as a flat list (not
  // pre-aggregated) so different aggregation windows (this week / all
  // time) can be computed client-side without another round trip.
  taskCompletions: TaskCompletion[];
  view: string;
  darkMode: boolean;
  // Where the Rooms view's drill-down currently is (root location id, then
  // optionally a child location id one level deeper). Kept on AppState --
  // not module-local to src/views/rooms.ts -- so it survives across
  // render() calls the same way state.view does (a background sync
  // re-render must never silently reset which room/container the user was
  // looking at).
  roomsNav: { roomId: string | null; containerId: string | null };
}
