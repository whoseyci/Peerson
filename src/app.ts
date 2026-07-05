import type { AppState, Household, HouseholdMember, Item, Batch, Task, Expense, ShoppingItem } from './types';
import { api } from './api/client';
import { renderHouseholdView } from './views/household';
import { renderInventoryView } from './views/inventory';
import { renderShoppingView } from './views/shopping';
import { renderTasksView } from './views/tasks';
import { renderExpensesView } from './views/expenses';

interface ActionLog {
  action: string;
  timestamp: number;
  details?: string;
}

export class App {
  // Exposed so inline view scripts (household.ts etc.) can call
  // `app.api.households.kick(...)`, `app.api.households.leave(...)`,
  // and `app.api.households.regenerateInvite(...)` directly.
  api = api;

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

  actionLog: ActionLog[] = [];
  isLoading = false;
  loadError: string | null = null;

  private logAction(action: string, details?: string) {
    this.actionLog.unshift({ action, timestamp: Date.now(), details });
    if (this.actionLog.length > 10) this.actionLog.pop();
  }

  init() {
    this.state.userId = localStorage.getItem('peerson_userId') || crypto.randomUUID();
    this.state.userName = localStorage.getItem('peerson_userName') || '';
    localStorage.setItem('peerson_userId', this.state.userId);

    const savedHousehold = localStorage.getItem('peerson_householdId');
    const savedView = localStorage.getItem('peerson_view');
    this.state.darkMode = localStorage.getItem('peerson_darkMode') === 'true';
    if (this.state.darkMode) document.body.classList.add('dark-mode');

    if (savedView) this.state.view = savedView;

    const url = new URL(location.href);
    const inviteCode = url.searchParams.get('join');
    if (inviteCode) {
      this.joinFromInvite(inviteCode);
      history.replaceState({}, '', url.pathname);
      return;
    }

    if (savedHousehold) {
      this.isLoading = true;
      this.loadError = null;
      this.render();
      this.loadHousehold(savedHousehold)
        .then(() => { this.isLoading = false; this.render(); })
        .catch(() => { this.isLoading = false; this.render(); });
    } else {
      this.render();
    }

    this.injectBugButton();
  }

  injectBugButton() {
    if (document.getElementById('bugReportBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'bugReportBtn';
    btn.className = 'bug-report-btn';
    btn.title = 'Bug melden';
    btn.innerHTML = '<i class="ph ph-bug"></i>';
    btn.onclick = () => this.openBugReport();
    document.body.appendChild(btn);
  }

  openBugReport() {
    const lastActions = this.actionLog.slice(0, 3).map((a, i) => {
      const time = new Date(a.timestamp).toLocaleTimeString('de-DE');
      return `${i + 1}. [${time}] ${a.action}${a.details ? ' — ' + a.details : ''}`;
    }).join('\n') || 'Keine Aktionen aufgezeichnet';

    this.showModal('bugModal', `
      <div class="modal-header">
        <div class="modal-title"><i class="ph ph-bug"></i> Bug melden</div>
        <button class="close-btn" onclick="app.closeModal('bugModal')"><i class="ph ph-x"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Titel</label>
          <input type="text" id="bugTitle" placeholder="Kurze Beschreibung des Problems">
        </div>
        <div class="form-group">
          <label>Beschreibung</label>
          <textarea id="bugDesc" rows="4" placeholder="Was ist passiert? Was hast du erwartet?"></textarea>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="bugScreenshot" checked>
            <span>Screenshot anhängen</span>
          </label>
        </div>
        <div class="bug-context">
          <div style="font-weight:700; margin-bottom:6px;">Auto-Kontext</div>
          <div>View: <strong>${this.state.view}</strong></div>
          <div>Haushalt: <strong>${this.state.household?.name || '—'}</strong></div>
          <div>User: <strong>${this.state.userName || 'Anonym'}</strong></div>
          <div>Screen: <strong>${window.innerWidth}x${window.innerHeight}</strong></div>
          <div style="margin-top:6px; font-weight:700;">Letzte Aktionen:</div>
          <pre>${lastActions}</pre>
        </div>
        <button class="btn" onclick="app.submitBugReport()">
          <i class="ph-bold ph-github-logo"></i> Auf GitHub erstellen
        </button>
      </div>
    `);
  }

  async submitBugReport() {
    const title = (document.getElementById('bugTitle') as HTMLInputElement)?.value.trim();
    const desc = (document.getElementById('bugDesc') as HTMLTextAreaElement)?.value.trim();
    const includeScreenshot = (document.getElementById('bugScreenshot') as HTMLInputElement)?.checked;

    if (!title) {
      this.toast('Bitte Titel eingeben');
      return;
    }

    const lastActions = this.actionLog.slice(0, 3).map((a, i) => {
      const time = new Date(a.timestamp).toLocaleTimeString('de-DE');
      return `${i + 1}. [${time}] ${a.action}${a.details ? ' — ' + a.details : ''}`;
    }).join('\n') || 'Keine Aktionen aufgezeichnet';

    let screenshotData = '';
    if (includeScreenshot && (window as any).html2canvas) {
      try {
        this.closeModal('bugModal');
        await new Promise(r => setTimeout(r, 300));
        const canvas = await (window as any).html2canvas(document.body, {
          backgroundColor: null,
          scale: 1,
          logging: false,
        });
        screenshotData = canvas.toDataURL('image/png');
      } catch (e) {
        console.error('Screenshot failed', e);
      }
    }

    const body = `## Beschreibung
${desc || '_(keine Beschreibung)_'}

## Kontext
| Feld | Wert |
|------|------|
| View | \`${this.state.view}\` |
| Haushalt | ${this.state.household?.name || '—'} |
| User | ${this.state.userName || 'Anonym'} |
| Screen | \`${window.innerWidth}x${window.innerHeight}\` |
| URL | \`${location.href}\` |
| User-Agent | \`${navigator.userAgent}\` |

## Letzte Aktionen
\`\`\`
${lastActions}
\`\`\`
${screenshotData ? '\n## Screenshot\n![Screenshot](' + screenshotData + ')' : ''}
`;

    const issueUrl = `https://github.com/whoseyci/Peerson/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(issueUrl, '_blank');
    this.toast('GitHub Issue geöffnet');
  }

  async loadHousehold(id: string) {
    try {
      const data = await api.households.get(id);
      this.state.householdId = id;
      this.state.household = data.household;
      this.state.members = data.members;
      await this.loadData();
      this.loadError = null;
    } catch (e: any) {
      console.error('Load household error', e);
      if (e.status === 404 || e.status === 401 || e.status === 403) {
        this.toast('Haushalt nicht gefunden oder Zugriff verweigert');
        this.state.householdId = null;
        this.state.household = null;
        localStorage.removeItem('peerson_householdId');
      } else {
        this.loadError = 'Verbindungsfehler — bitte erneut versuchen';
        this.toast(this.loadError);
      }
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
    this.logAction('Navigation', `→ ${view}`);
    this.state.view = view;
    localStorage.setItem('peerson_view', view);
    this.render();
  }

  setHtml(el: HTMLElement, html: string) {
    el.innerHTML = html;
    el.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.appendChild(document.createTextNode(oldScript.innerHTML));
      oldScript.parentNode!.replaceChild(newScript, oldScript);
    });
  }

  render() {
    const appEl = document.getElementById('app')!;

    if (this.isLoading) {
      appEl.innerHTML = `
        <div class="loading-overlay">
          <div class="spinner"></div>
          <div style="margin-top:16px; font-weight:600;">Laden...</div>
        </div>`;
      this.injectBugButton();
      return;
    }

    if (!this.state.householdId || !this.state.household) {
      this.setHtml(appEl, renderHouseholdView(this));
      this.injectBugButton();
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
    this.injectBugButton();
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
    this.logAction('Haushalt erstellen', name);
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
      this.toast(e.message || 'Fehler beim Erstellen');
    }
  }

  async joinFromInvite(code: string) {
    this.logAction('Einladung beitreten', code);
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
      this.render();
    }
  }

  setUserName(name: string) {
    this.logAction('Name setzen', name);
    this.state.userName = name;
    localStorage.setItem('peerson_userName', name);
  }

  async updateUserName(name: string) {
    this.logAction('Name aktualisieren', name);
    this.state.userName = name;
    localStorage.setItem('peerson_userName', name);
    try {
      await api.users.updateName(name);
      this.toast('Name gespeichert');
    } catch (e) {
      console.error('Update name error', e);
    }
  }

  setUserId(id: string) {
    this.state.userId = id;
    localStorage.setItem('peerson_userId', id);
  }

  toggleDarkMode() {
    this.logAction('Dark Mode toggle');
    this.state.darkMode = !this.state.darkMode;
    document.body.classList.toggle('dark-mode', this.state.darkMode);
    localStorage.setItem('peerson_darkMode', String(this.state.darkMode));
  }

  getMemberName(id?: string) {
    if (!id) return 'Nicht zugewiesen';
    const m = this.state.members.find(x => x.id === id);
    return m?.name || 'Unbekannt';
  }

  isAdmin() {
    if (!this.state.householdId) return false;
    const m = this.state.members.find(x => x.id === this.state.userId);
    return m?.role === 'admin';
  }

  getItemTotal(itemId: string) {
    return this.state.batches.filter(b => b.item_id === itemId).reduce((a, b) => a + b.quantity, 0);
  }
}
