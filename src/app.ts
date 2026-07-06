import type { AppState, Household, HouseholdMember, Item, Batch, Task, Expense, ShoppingItem } from './types';
import { api } from './api/client';
import { renderHouseholdView } from './views/household';
import { renderInventoryView } from './views/inventory';
import { renderShoppingView } from './views/shopping';
import { renderTasksView } from './views/tasks';
import { renderExpensesView } from './views/expenses';
import { renderBriefView } from './views/brief';
import { escapeHtml } from './utils/html';
import { loadExternalScript } from './utils/loadExternalScript';

interface ActionLog {
  action: string;
  timestamp: number;
  details?: string;
}

// How often we poll for changes made by other household members. Kept
// fairly responsive (3s) while a visibilitychange + window-focus listener
// also triggers an immediate refresh so switching back to the tab always
// feels current even between polls.
const SYNC_INTERVAL_MS = 3000;
const TAB_ORDER = ['brief', 'inventory', 'shopping', 'tasks', 'expenses', 'household'];

function redactSensitive(value: string) {
  return value
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/([?&]join=)[^&]+/gi, '$1[redacted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-user-id]')
    .replace(/(Einladung beitreten\s*[—-]\s*)[A-Z0-9]{6,12}/gi, '$1[redacted-code]');
}

function safeLastActions(actions: ActionLog[]) {
  return actions.slice(0, 3).map((a, i) => {
    const time = new Date(a.timestamp).toLocaleTimeString('de-DE');
    const details = a.details ? ' — ' + redactSensitive(a.details) : '';
    return `${i + 1}. [${time}] ${redactSensitive(a.action)}${details}`;
  }).join('\n') || 'Keine Aktionen aufgezeichnet';
}

type DeletableType = 'item' | 'task' | 'shopping' | 'expense';

interface PendingDeletion {
  timeoutId: ReturnType<typeof setTimeout>;
  undo: () => void;
  commit: () => Promise<void>;
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
    locations: [],
    view: 'household',
    darkMode: false,
  };

  actionLog: ActionLog[] = [];
  isLoading = false;
  loadError: string | null = null;

  // --- Live sync state ---
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private syncInFlight = false;
  isSyncing = false;
  private lastSyncTimestamp = 0;

  // --- Soft-delete / undo state ---
  // Keyed by "type:id" so an item and a task can never collide even if
  // their ids happened to match. Only one pending deletion per key at a
  // time (re-deleting mid-countdown just restarts the timer).
  private pendingDeletions = new Map<string, PendingDeletion>();
  private swipeStart: { x: number; y: number; target: EventTarget | null } | null = null;

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

    if (savedView && TAB_ORDER.includes(savedView)) this.state.view = savedView;
    else if (savedHousehold) this.state.view = 'brief';

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
        .then(() => { this.isLoading = false; this.render(); this.startSync(); })
        .catch(() => { this.isLoading = false; this.render(); });
    } else {
      this.render();
    }

    this.injectBugButton();
    this.injectSyncIndicator();

    // Refresh immediately whenever the tab regains focus/visibility --
    // covers the common case of switching away and back without waiting
    // for the next poll tick, e.g. checking another app and coming back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.syncNow();
    });
    window.addEventListener('focus', () => this.syncNow());
    this.installSwipeNavigation();
  }

  injectBugButton() {
    if (document.getElementById('bugReportBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'bugReportBtn';
    btn.className = 'bug-report-btn';
    btn.title = 'Bug melden';
    btn.setAttribute('aria-label', 'Bug melden');
    btn.innerHTML = '<i class="ph ph-bug"></i>';
    btn.onclick = () => this.openBugReport();
    document.body.appendChild(btn);
  }

  // Small pulsing dot, always in the same corner regardless of which view
  // is showing, that lights up while a background sync request is in
  // flight. Deliberately subtle -- most users should never consciously
  // notice it, it's just enough to confirm "yes, this is live" for anyone
  // who does look.
  injectSyncIndicator() {
    let el = document.getElementById('syncIndicator');
    if (!el) {
      el = document.createElement('div');
      el.id = 'syncIndicator';
      el.className = 'sync-indicator';
      el.title = 'Wird synchronisiert...';
      document.body.appendChild(el);
    }
    el.classList.toggle('active', this.isSyncing);
  }

  openBugReport() {
    const lastActions = safeLastActions(this.actionLog);

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
            <span>Screenshot anhängen (kann sichtbare Einladungscodes enthalten)</span>
          </label>
        </div>
        <div class="bug-context">
          <div style="font-weight:700; margin-bottom:6px;">Auto-Kontext</div>
          <div>View: <strong>${this.state.view}</strong></div>
          <div>Haushalt: <strong>${escapeHtml(this.state.household?.name || '—')}</strong></div>
          <div>User: <strong>${escapeHtml(this.state.userName || 'Anonym')}</strong></div>
          <div>Screen: <strong>${window.innerWidth}x${window.innerHeight}</strong></div>
          <div style="margin-top:6px; font-weight:700;">Letzte Aktionen:</div>
          <pre>${escapeHtml(lastActions)}</pre>
        </div>
        <button class="btn" id="bugSubmitBtn" onclick="app.submitBugReport()">
          <i class="ph-bold ph-paper-plane-tilt"></i> Bug melden
        </button>
      </div>
    `);
    setTimeout(() => {
      const descEl = document.getElementById('bugDesc') as HTMLTextAreaElement;
      if (descEl) {
        descEl.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const val = descEl.value;
            const selStart = descEl.selectionStart;
            const currentLine = val.substring(0, selStart).split('\n').pop()!;
            const listMatch = currentLine.match(/^(\s*)(\d+)\.\s+/);
            const bulletMatch = currentLine.match(/^(\s*)[-*+]\s+/);
            if (listMatch) {
              e.preventDefault();
              const nextNum = parseInt(listMatch[2], 10) + 1;
              const insertion = `\n${listMatch[1]}${nextNum}. `;
              descEl.setRangeText(insertion, selStart, descEl.selectionEnd, 'end');
              descEl.selectionStart = descEl.selectionEnd = selStart + insertion.length;
            } else if (bulletMatch) {
              e.preventDefault();
              const insertion = `\n${bulletMatch[0]}`;
              descEl.setRangeText(insertion, selStart, descEl.selectionEnd, 'end');
              descEl.selectionStart = descEl.selectionEnd = selStart + insertion.length;
            }
          }
        });
      }
    }, 10);
  }

  async submitBugReport() {
    const title = (document.getElementById('bugTitle') as HTMLInputElement)?.value.trim();
    const desc = (document.getElementById('bugDesc') as HTMLTextAreaElement)?.value.trim();
    const includeScreenshot = (document.getElementById('bugScreenshot') as HTMLInputElement)?.checked;
    const submitBtn = document.getElementById('bugSubmitBtn') as HTMLButtonElement | null;

    if (!title) {
      this.toast('Bitte Titel eingeben');
      return;
    }

    const lastActions = safeLastActions(this.actionLog);

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="ph ph-spinner-gap"></i> Wird gesendet\u2026';
    }

    let screenshotData = '';
    if (includeScreenshot) {
      try {
        await loadExternalScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        if ((window as any).html2canvas) {
          const canvas = await (window as any).html2canvas(document.body, {
            backgroundColor: null,
            scale: 1,
            logging: false,
            ignoreElements: (el: HTMLElement) => el.id === 'bugModal',
          });
          screenshotData = canvas.toDataURL('image/png');
        }
      } catch (e) {
        console.error('Screenshot failed', e);
      }
    }

    const context = {
      View: this.state.view,
      Haushalt: this.state.household?.name || '\u2014',
      User: this.state.userName || 'Anonym',
      Screen: `${window.innerWidth}x${window.innerHeight}`,
      URL: redactSensitive(location.href),
      'User-Agent': navigator.userAgent,
    };

    try {
      const result = await api.bugReport.submit({
        title,
        description: desc,
        context,
        lastActions,
        screenshot: screenshotData || undefined,
      });
      this.closeModal('bugModal');
      this.showModal('bugSuccessModal', `
        <div class="modal-header">
          <div class="modal-title"><i class="ph ph-check-circle"></i> Danke!</div>
          <button class="close-btn" onclick="app.closeModal('bugSuccessModal')"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:16px;">Dein Bug-Report wurde direkt erstellt (Issue #${result.number}).</p>
          <a class="btn btn-secondary" href="${result.url}" target="_blank" rel="noopener noreferrer">
            <i class="ph ph-arrow-square-out"></i> Auf GitHub ansehen
          </a>
        </div>
      `);
    } catch (e: any) {
      // Server-side reporting isn't configured (no GITHUB_PAT set yet) or
      // failed -- fall back to the old manual flow so reporting still
      // works, but only as a last resort, and only if the reporter has a
      // GitHub account to file it with themselves.
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> Bug melden';
      }
      if (e?.status === 501) {
        this.toast('Bug-Reporting ist serverseitig noch nicht eingerichtet \u2014 \u00f6ffne GitHub manuell.');
        const body = `## Beschreibung\n${desc || '_(keine Beschreibung)_'}\n\n## Kontext\n${Object.entries(context).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}\n\n## Letzte Aktionen\n\`\`\`\n${lastActions}\n\`\`\`\n`;
        const issueUrl = `https://github.com/whoseyci/Peerson/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
        window.open(issueUrl, '_blank');
      } else {
        this.toast(e?.message || 'Fehler beim Erstellen des Bug-Reports');
      }
    }
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
      const [itemsData, tasksData, expensesData, shoppingData, locationsData] = await Promise.all([
        api.items.list(hid),
        api.tasks.list(hid),
        api.expenses.list(hid),
        api.shopping.list(hid),
        api.locations.list(hid),
      ]);
      this.state.items = this.stripPending('item', itemsData.items);
      this.state.batches = itemsData.batches;
      this.state.tasks = this.stripPending('task', tasksData.tasks);
      this.state.expenses = this.stripPending('expense', expensesData.expenses);
      this.state.splits = expensesData.splits;
      this.state.shopping = this.stripPending('shopping', shoppingData.items);
      this.state.members = expensesData.members;
      this.state.locations = locationsData.locations;
    } catch (e) {
      console.error('Load data error', e);
    }
  }

  // --- Live sync -----------------------------------------------------
  //
  // Peerson is a shared household app; if my flatmate adds something to
  // the shopping list I should see it without needing to know to reload
  // the page. This polls the same endpoints loadData() already uses on
  // a fixed interval, plus refreshes immediately on tab focus/visibility
  // so switching back to the app always feels current.
  //
  // Deliberately conservative about *when* it's allowed to trigger a
  // visible re-render: it never fires while the user is actively typing
  // (active element is an input/textarea) or while a modal is open, so a
  // background refresh can never wipe out an in-progress edit or steal
  // focus. State is still kept fresh underneath either way -- the next
  // render (whenever that naturally happens) will reflect it.

  startSync() {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => this.syncNow(), SYNC_INTERVAL_MS);
  }

  stopSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async syncNow() {
    if (!this.state.householdId || this.syncInFlight || this.isLoading) return;
    this.syncInFlight = true;
    this.isSyncing = true;
    this.injectSyncIndicator();
    try {
      try {
        const check = await (this.api as any).syncCheck(this.state.householdId);
        if (check && check.lastModified && check.lastModified === this.lastSyncTimestamp) {
          return;
        }
        this.lastSyncTimestamp = (check && check.lastModified) ? check.lastModified : 0;
      } catch (e) {
        // Fall back to full data load if check fails
      }
      await this.loadData();
    } finally {
      this.syncInFlight = false;
      this.isSyncing = false;
      this.injectSyncIndicator();
    }

    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
    const modalOpen = !!document.querySelector('.modal.active');
    if (isTyping || modalOpen) return;
    this.render();
  }

  private installSwipeNavigation() {
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      if (!this.state.householdId) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, .modal')) return;
      this.swipeStart = { x: event.clientX, y: event.clientY, target: event.target };
    }, { passive: true });

    document.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'touch' || !this.swipeStart) return;
      const start = this.swipeStart;
      this.swipeStart = null;
      if (!this.state.householdId || document.querySelector('.modal.active')) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.4 || Math.abs(dy) > 90) return;

      const current = TAB_ORDER.indexOf(this.state.view);
      if (current === -1) return;
      const next = dx < 0
        ? (current + 1) % TAB_ORDER.length
        : (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      this.navigate(TAB_ORDER[next]);
    }, { passive: true });
  }

  navigate(view: string) {
    if (!TAB_ORDER.includes(view) && view !== 'household') return;
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
    this.injectSyncIndicator();
      return;
    }

    if (!this.state.householdId || !this.state.household) {
      this.setHtml(appEl, renderHouseholdView(this));
      this.injectBugButton();
    this.injectSyncIndicator();
      return;
    }

    let viewHtml = '';
    switch (this.state.view) {
      case 'brief': viewHtml = renderBriefView(this); break;
      case 'inventory': viewHtml = renderInventoryView(this); break;
      case 'shopping': viewHtml = renderShoppingView(this); break;
      case 'tasks': viewHtml = renderTasksView(this); break;
      case 'expenses': viewHtml = renderExpensesView(this); break;
      case 'household': viewHtml = renderHouseholdView(this); break;
      default: viewHtml = renderBriefView(this);
    }

    const unreadTasks = this.state.tasks.filter(t => t.status === 'todo').length;
    const lowStock = this.state.items.filter(i => {
      const total = this.state.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0);
      return total < i.threshold;
    }).length;
    const daysUntil = (dateString?: string) => {
      if (!dateString) return 9999;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateString);
      target.setHours(0, 0, 0, 0);
      return Math.ceil((target.getTime() - today.getTime()) / 86400000);
    };
    const briefExpiring = this.state.batches.filter(b => b.expiry && daysUntil(b.expiry) <= 7).length;
    const briefDueTasks = this.state.tasks.filter(t => t.status === 'todo' && t.due_date && daysUntil(t.due_date) <= 2).length;
    const briefBalances = this.state.members.filter(m => {
      const paid = this.state.expenses.filter(e => e.paid_by === m.id).reduce((a, e) => a + e.amount, 0);
      const owed = this.state.splits.filter(sp => sp.user_id === m.id).reduce((a, sp) => a + sp.amount, 0);
      return Math.abs(paid - owed) > 0.05;
    }).length;
    const dailyAlerts = briefExpiring + lowStock + briefDueTasks + briefBalances;

    this.setHtml(appEl, `
      ${viewHtml}
      <nav class="top-tabs" aria-label="Hauptnavigation">
        <button class="tab-btn ${this.state.view === 'brief' ? 'active' : ''}" onclick="app.navigate('brief')" title="Heute" aria-label="Heute öffnen">
          <i class="ph ph-sparkle"></i><span class="tab-label">Heute</span>
          ${dailyAlerts > 0 ? `<span class="badge">${dailyAlerts}</span>` : ''}
        </button>
        <button class="tab-btn ${this.state.view === 'inventory' ? 'active' : ''}" onclick="app.navigate('inventory')" title="Vorrat" aria-label="Vorrat öffnen">
          <i class="ph ph-package"></i><span class="tab-label">Vorrat</span>
          ${lowStock > 0 ? `<span class="badge">${lowStock}</span>` : ''}
        </button>
        <button class="tab-btn ${this.state.view === 'shopping' ? 'active' : ''}" onclick="app.navigate('shopping')" title="Einkaufen" aria-label="Einkaufen öffnen">
          <i class="ph ph-shopping-cart"></i><span class="tab-label">Einkauf</span>
        </button>
        <button class="tab-btn ${this.state.view === 'tasks' ? 'active' : ''}" onclick="app.navigate('tasks')" title="Aufgaben" aria-label="Aufgaben öffnen">
          <i class="ph ph-check-circle"></i><span class="tab-label">Aufgaben</span>
          ${unreadTasks > 0 ? `<span class="badge">${unreadTasks}</span>` : ''}
        </button>
        <button class="tab-btn ${this.state.view === 'expenses' ? 'active' : ''}" onclick="app.navigate('expenses')" title="Finanzen" aria-label="Finanzen öffnen">
          <i class="ph ph-currency-eur"></i><span class="tab-label">Finanzen</span>
        </button>
        <button class="tab-btn ${this.state.view === 'household' ? 'active' : ''}" onclick="app.navigate('household')" title="Haushalt" aria-label="Haushalt öffnen">
          <i class="ph ph-users"></i><span class="tab-label">Haushalt</span>
        </button>
      </nav>
    `);
    this.injectBugButton();
    this.injectSyncIndicator();
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

    modal.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.closeModal(id));
    });
    (window as any).closeModal = (cid: string) => this.closeModal(cid);
  }

  closeModal(id: string) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 2500);
  }

  // A toast with an "Undo" button and a shrinking progress bar, used by
  // the soft-delete flow below. Lives for `durationMs`, then calls
  // onExpire() if the user never clicked undo.
  private undoToast(msg: string, durationMs: number, onUndo: () => void, onExpire: () => void) {
    const t = document.createElement('div');
    t.className = 'toast toast-undo';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');

    const message = document.createElement('span');
    message.textContent = msg;

    const undoBtn = document.createElement('button');
    undoBtn.className = 'toast-undo-btn';
    undoBtn.type = 'button';
    undoBtn.textContent = 'Rückgängig';

    const progress = document.createElement('div');
    progress.className = 'toast-progress';
    const bar = document.createElement('div');
    bar.className = 'toast-progress-bar';
    progress.appendChild(bar);

    t.append(message, undoBtn, progress);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));

    if (bar) {
      bar.style.transitionDuration = `${durationMs}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transform = 'scaleX(0)'; }));
    }

    let settled = false;
    const dismiss = () => {
      if (settled) return;
      settled = true;
      t.classList.remove('visible');
      setTimeout(() => t.remove(), 300);
    };

    undoBtn.addEventListener('click', () => {
      if (settled) return;
      onUndo();
      dismiss();
    });

    setTimeout(() => {
      if (settled) return;
      onExpire();
      dismiss();
    }, durationMs);
  }

  // --- Soft delete / undo ---------------------------------------------
  //
  // Deleting something in a shared household app is unusually costly to
  // get wrong -- it's not just your own data, a flatmate might notice a
  // task or expense missing and have no way to know it was deleted by
  // mistake versus never having existed. Every destructive action in the
  // app should route through this instead of calling the delete API
  // directly: it hides the item from the UI immediately (so it *feels*
  // instant), but only actually calls the API after a grace period,
  // giving the user a chance to undo a misclick.
  //
  // `list` is the live state array (e.g. this.state.items) so we can
  // filter it in place without each caller re-deriving a new array.
  scheduleSoftDelete<T extends { id: string }>(
    type: DeletableType,
    item: T,
    list: T[],
    label: string,
    commitFn: () => Promise<void>
  ) {
    const key = `${type}:${item.id}`;
    // If this exact item somehow gets "deleted" again before the first
    // grace period ends (shouldn't normally happen since it's hidden from
    // the UI already), just restart the timer rather than double-commit.
    const existing = this.pendingDeletions.get(key);
    if (existing) clearTimeout(existing.timeoutId);

    const index = list.indexOf(item);
    if (index !== -1) list.splice(index, 1);
    this.render();

    const restore = () => {
      this.pendingDeletions.delete(key);
      if (!list.includes(item)) {
        const insertAt = Math.min(index, list.length);
        list.splice(insertAt, 0, item);
      }
      this.render();
      this.toast('Wiederhergestellt');
    };

    const commit = async () => {
      this.pendingDeletions.delete(key);
      try {
        await commitFn();
      } catch (e) {
        console.error(`Soft-delete commit failed for ${key}`, e);
        // The optimistic removal already happened; if the server call
        // failed, put it back rather than silently diverging from the
        // backend's actual state.
        restore();
        this.toast('Fehler beim Löschen — wiederhergestellt');
      }
    };

    const timeoutId = setTimeout(() => { void commit(); }, 5000);
    this.pendingDeletions.set(key, { timeoutId, undo: restore, commit });

    this.undoToast(`${label} gelöscht`, 5000, restore, () => { void commit(); });
  }

  // Removes any item from a freshly-fetched list that's currently
  // mid-undo-countdown locally, so a background sync poll can never
  // resurrect something the user just deleted (and hasn't undone) just
  // because the server hadn't processed the delete yet.
  private stripPending<T extends { id: string }>(type: DeletableType, list: T[]): T[] {
    if (this.pendingDeletions.size === 0) return list;
    return list.filter((item) => !this.pendingDeletions.has(`${type}:${item.id}`));
  }

  async createHousehold(name: string) {
    this.logAction('Haushalt erstellen', name);
    try {
      const data = await api.households.create(name);
      this.state.householdId = data.household.id;
      this.state.household = data.household;
      localStorage.setItem('peerson_householdId', data.household.id);
      this.toast('Haushalt erstellt');
      this.navigate('brief');
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
      this.navigate('brief');
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
