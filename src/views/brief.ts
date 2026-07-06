import type { App } from '../app';
import { escapeHtml, escapeJsAttr } from '../utils/html';

function daysUntil(dateString?: string | null) {
  if (!dateString) return 9999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function formatDate(dateString?: string | null) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function urgencyText(days: number) {
  if (days < 0) return 'überfällig';
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
}

function itemTotal(app: App, itemId: string) {
  return app.state.batches.filter(b => b.item_id === itemId).reduce((sum, b) => sum + b.quantity, 0);
}

export function renderBriefView(app: App) {
  const s = app.state;
  const expiring = s.batches
    .filter(b => b.expiry && daysUntil(b.expiry) <= 7)
    .map(b => ({ ...b, item: s.items.find(i => i.id === b.item_id), days: daysUntil(b.expiry) }))
    .filter(x => x.item)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  const lowStock = s.items
    .map(i => ({ item: i, total: itemTotal(app, i.id), needed: Math.max(0, i.threshold - itemTotal(app, i.id)) }))
    .filter(x => x.total < x.item.threshold)
    .sort((a, b) => b.needed - a.needed)
    .slice(0, 5);

  const dueTasks = s.tasks
    .filter(t => t.status === 'todo' && t.due_date && daysUntil(t.due_date) <= 2)
    .map(t => ({ ...t, days: daysUntil(t.due_date) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  const balances = s.members.map(m => {
    const paid = s.expenses.filter(e => e.paid_by === m.id).reduce((a, e) => a + e.amount, 0);
    const owed = s.splits.filter(sp => sp.user_id === m.id).reduce((a, sp) => a + sp.amount, 0);
    return { ...m, balance: paid - owed };
  }).filter(b => Math.abs(b.balance) > 0.05).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 4);

  const alertCount = expiring.length + lowStock.length + dueTasks.length + balances.length;

  return `
    <div class="header">
      <h1><i class="ph ph-sparkle"></i> Heute</h1>
      <div style="display:flex; gap:8px;">
        <button class="icon-btn" onclick="startScanFlow()" title="Barcode scannen" aria-label="Barcode scannen"><i class="ph ph-barcode"></i></button>
        <button class="icon-btn" onclick="openAddExpenseModal()" title="Ausgabe hinzufügen" aria-label="Ausgabe hinzufügen"><i class="ph ph-plus"></i></button>
      </div>
    </div>

    <div class="brief-hero">
      <div>
        <div class="brief-kicker">Daily Brief</div>
        <h2>${alertCount ? `${alertCount} Dinge brauchen Aufmerksamkeit` : 'Alles ruhig im Haushalt'}</h2>
        <p>${alertCount ? 'Hier ist, was heute wichtig ist.' : 'Keine dringenden Vorräte, Aufgaben oder Finanzen offen.'}</p>
      </div>
      <i class="ph ph-house-line"></i>
    </div>

    <div class="quick-grid brief-actions">
      <button class="quick-card quick-button" onclick="startScanFlow()"><i class="ph ph-barcode"></i><span>Produkt scannen</span></button>
      <button class="quick-card quick-button" onclick="openAddExpenseModal()"><i class="ph ph-currency-eur"></i><span>Ausgabe</span></button>
      <button class="quick-card quick-button" onclick="openAddTaskModal()"><i class="ph ph-check-circle"></i><span>Aufgabe</span></button>
      <button class="quick-card quick-button" onclick="app.navigate('shopping')"><i class="ph ph-shopping-cart-simple"></i><span>Einkauf</span></button>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title"><i class="ph ph-clock"></i> MHD / Verbrauchen</div><span class="badge">${expiring.length}</span></div>
      ${expiring.length ? expiring.map(b => {
        const item = b.item!;
        return `
          <div class="card ${b.days < 0 ? 'danger' : b.days <= 2 ? 'warning' : ''}">
            <div class="card-content" onclick="openItemDetail('${escapeJsAttr(item.id)}')">
              <div class="card-icon"><i class="ph ph-package"></i></div>
              <div class="card-text">
                <div class="card-header"><div class="item-name">${escapeHtml(item.name)}</div><div class="item-qty">${escapeHtml(b.quantity)}</div></div>
                <div class="card-meta">${urgencyText(b.days)} · ${formatDate(b.expiry)}</div>
              </div>
            </div>
          </div>`;
      }).join('') : '<div class="empty-state">Nichts läuft bald ab</div>'}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title"><i class="ph ph-shopping-cart-simple"></i> Einkaufsvorschläge</div><span class="badge">${lowStock.length}</span></div>
      ${lowStock.length ? lowStock.map(x => `
        <div class="card warning">
          <div class="card-content" onclick="app.navigate('shopping')">
            <div class="card-icon"><i class="ph ph-shopping-cart-simple"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${escapeHtml(x.item.name)}</div><div class="item-qty">+${escapeHtml(x.needed)}</div></div>
              <div class="card-meta">${escapeHtml(x.total)} vorrätig · Min. ${escapeHtml(x.item.threshold)}</div>
            </div>
          </div>
        </div>`).join('') : '<div class="empty-state">Keine niedrigen Bestände</div>'}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title"><i class="ph ph-check-circle"></i> Fällige Aufgaben</div><span class="badge">${dueTasks.length}</span></div>
      ${dueTasks.length ? dueTasks.map(t => `
        <div class="card">
          <div class="card-content" onclick="openEditTaskModal('${escapeJsAttr(t.id)}')">
            <div class="card-icon"><i class="ph ph-check-circle"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${escapeHtml(t.title)}</div></div>
              <div class="card-meta">${urgencyText(t.days)}${t.assigned_to ? ` · ${escapeHtml(app.getMemberName(t.assigned_to))}` : ''}</div>
            </div>
          </div>
        </div>`).join('') : '<div class="empty-state">Keine fälligen Aufgaben</div>'}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title"><i class="ph ph-scales"></i> Finanzen</div><span class="badge">${balances.length}</span></div>
      ${balances.length ? balances.map(b => `
        <div class="card">
          <div class="card-content" onclick="app.navigate('expenses')">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${escapeHtml(b.name)}</div><div class="item-qty ${b.balance >= 0 ? 'balance-positive' : 'balance-negative'}">${b.balance >= 0 ? '+' : ''}${b.balance.toFixed(2)} €</div></div>
              <div class="card-meta">${b.balance >= 0 ? 'bekommt Geld' : 'schuldet Geld'}</div>
            </div>
          </div>
        </div>`).join('') : '<div class="empty-state">Alle Konten ausgeglichen</div>'}
    </div>
  `;
}
