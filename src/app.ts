import type { AppState, Household, HouseholdMember, Item, Batch, Task, Expense, ShoppingItem } from './types';
import { api } from './api/client';
import { renderHouseholdView } from './views/household';
import { renderInventoryView } from './views/inventory';
import { renderShoppingView } from './views/shopping';
import { renderTasksView } from './views/tasks';
import { renderExpensesView } from './views/expenses';

export class App {
  state: AppState = {
    userId: '',
    userName: '',
    householdId: null,
    household: null,
    members: [],
    items: [],
    batches: [],
    tasks: [],
    expenses: [],
    splits: [],
    shopping: [],
    view: 'household',
    darkMode: false,
  };

  init() {
    this.state.userId = localStorage.getItem('peerson_userId') || crypto.randomUUID();
    this.state.userName = localStorage.getItem('peerson_userName') || '';
    localStorage.setItem('peerson_userId', this.state.userId);

    const savedHousehold = localStorage.getItem('peerson_householdId');
    const savedView = localStorage.getItem('peerson_view');
    this.state.darkMode = localStorage.getItem('peerson_darkMode') === 'true';
    if (this.state.darkMode) document.body.classList.add('dark-mode');

    if (savedView) this.state.view = savedView;
    if (savedHousehold) {
      this.state.householdId = savedHousehold;
      this.loadHousehold(savedHousehold).then(() => this.render());
    } else {
      this.render();
    }

    const url = new URL(location.href);
    const inviteCode = url.searchParams.get('join');
    if (inviteCode) {
      this.joinFromInvite(inviteCode);
      history.replaceState({}, '', url.pathname);
    }
  }

  async loadHousehold(id: string) {
    try {
      const data = await api.households.get(id);
      this.state.household = data.household;
      this.state.members = data.members;
      await this.loadData();
    } catch (e) {
      this.toast('Fehler beim Laden des Haushalts');
      this.state.householdId = null;
      localStorage.removeItem('peerson_householdId');
    }
  }

  async loadData() {
    if (!this.state.householdId) return;
    const hid = this.state.householdId;
    try {
      const [itemsData, tasksData, expensesData, shoppingData] = await Promise.all([
        api.items.list(hid),
        api.tasks.list(hid),
        api.expenses.list(hid),
        api.shopping.list(hid),
      ]);
      this.state.items = itemsData.items;
      this.state.batches = itemsData.batches;
      this.state.tasks = tasksData.tasks;
      this.state.expenses = expensesData.expenses;
      this.state.splits = expensesData.splits;
      this.state.shopping = shoppingData.items;
      this.state.members = expensesData.members;
    } catch (e) {
      console.error('Load data error', e);
    }
  }

  navigate(view: string) {
    this.state.view = view;
    localStorage.setItem('peerson_view', view);
    this.render();
  }

  setHtml(el: HTMLElement, html: string) {
    el.innerHTML = html;
    // Re-execute scripts since innerHTML doesn't run them
    el.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.appendChild(document.createTextNode(oldScript.innerHTML));
      oldScript.parentNode!.replaceChild(newScript, oldScript);
    });
  }

  render() {
    const appEl = document.getElementById('app')!;
    if (!this.state.householdId || !this.state.household) {
      this.setHtml(appEl, renderHouseholdView(this));
      return;
    }

    let viewHtml = '';
    switch (this.state.view) {
      case 'inventory': viewHtml = renderInventoryView(this); break;
      case 'shopping': viewHtml = renderShoppingView(this); break;
      case 'tasks': viewHtml = renderTasksView(this); break;
      case 'expenses': viewHtml = renderExpensesView(this); break;
      case 'household': viewHtml = renderHouseholdView(this); break;
      default: viewHtml = renderInventoryView(this);
    }

    const unreadTasks = this.state.tasks.filter(t => t.status === 'todo').length;
    const lowStock = this.state.items.filter(i => {
      const total = this.state.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0);
      return total < i.threshold;
    }).length;

    this.setHtml(appEl, `
      ${viewHtml}
      <nav class="bottom-dock">
        <button class="dock-btn ${this.state.view === 'inventory' ? 'active' : ''}" onclick="app.navigate('inventory')" title="Vorrat">
          <i class="ph ph-package"></i>
          ${lowStock > 0 ? `<span class="badge">${lowStock}</span>` : ''}
        </button>
        <button class="dock-btn ${this.state.view === 'shopping' ? 'active' : ''}" onclick="app.navigate('shopping')" title="Einkaufen">
          <i class="ph ph-shopping-cart"></i>
        </button>
        <button class="dock-btn ${this.state.view === 'tasks' ? 'active' : ''}" onclick="app.navigate('tasks')" title="Aufgaben">
          <i class="ph ph-check-circle"></i>
          ${unreadTasks > 0 ? `<span class="badge">${unreadTasks}</span>` : ''}
        </button>
        <button class="dock-btn ${this.state.view === 'expenses' ? 'active' : ''}" onclick="app.navigate('expenses')" title="Finanzen">
          <i class="ph ph-currency-euro"></i>
        </button>
        <button class="dock-btn ${this.state.view === 'household' ? 'active' : ''}" onclick="app.navigate('household')" title="Haushalt">
          <i class="ph ph-users"></i>
        </button>
      </nav>
    `);
  }

  showModal(id: string, content: string) {
    let modal = document.getElementById(id);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = id;
      modal.className = 'modal';
      document.body.appendChild(modal);
    }
    this.setHtml(modal, `<div class="modal-content">${content}</div>`);
    modal.classList.add('active');
  }

  closeModal(id: string) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 2500);
  }

  async createHousehold(name: string) {
    try {
      const data = await api.households.create(name);
      this.state.householdId = data.household.id;
      this.state.household = data.household;
      localStorage.setItem('peerson_householdId', data.household.id);
      this.toast('Haushalt erstellt');
      this.navigate('inventory');
      await this.loadData();
      this.render();
    } catch (e: any) {
      this.toast(e.message || 'Fehler');
    }
  }

  async joinFromInvite(code: string) {
    try {
      const data = await api.households.join(code);
      this.state.householdId = data.household.id;
      this.state.household = data.household;
      localStorage.setItem('peerson_householdId', data.household.id);
      this.toast('Haushalt beigetreten');
      this.navigate('inventory');
      await this.loadData();
      this.render();
    } catch (e: any) {
      this.toast(e.message || 'Ungültiger Code');
    }
  }

  setUserName(name: string) {
    this.state.userName = name;
    localStorage.setItem('peerson_userName', name);
  }

  toggleDarkMode() {
    this.state.darkMode = !this.state.darkMode;
    document.body.classList.toggle('dark-mode', this.state.darkMode);
    localStorage.setItem('peerson_darkMode', String(this.state.darkMode));
  }

  getMemberName(id?: string) {
    if (!id) return 'Nicht zugewiesen';
    const m = this.state.members.find(x => x.id === id);
    return m?.name || 'Unbekannt';
  }

  getItemTotal(itemId: string) {
    return this.state.batches.filter(b => b.item_id === itemId).reduce((a, b) => a + b.quantity, 0);
  }
}
