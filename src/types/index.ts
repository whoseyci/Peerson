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
  barcodes: Barcode[];
  nutrition: Record<string, number>;
  created_by?: string;
}

export interface Barcode {
  code: string;
  grams: number;
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
}

export interface Expense {
  id: string;
  household_id: string;
  title: string;
  amount: number;
  paid_by: string;
  split_type: string;
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
  shopping: ShoppingItem[];
  view: string;
  darkMode: boolean;
}
