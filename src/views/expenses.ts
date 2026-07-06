import type { App } from '../app';
import type { Expense } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';
import { personalBalanceLines } from '../utils/finance';

const EXPENSE_CATEGORIES: Record<string, { icon: string; label: string }> = {
  groceries: { icon: 'shopping-cart-simple', label: 'Lebensmittel' },
  rent: { icon: 'house', label: 'Miete & Wohnen' },
  household: { icon: 'broom', label: 'Haushalt & Drogerie' },
  leisure: { icon: 'confetti', label: 'Freizeit' },
  settlement: { icon: 'hand-coins', label: 'Schuldenausgleich' },
  sonstiges: { icon: 'package', label: 'Sonstiges' },
};

function cleanExpenseTitle(title: string) {
  return title.replace(/^\s*\u{1F4B8}\s*/u, '').trim();
}

function isSettlementExpense(expense: Expense) {
  const title = cleanExpenseTitle(expense.title || '').toLowerCase();
  return expense.category === 'settlement' || title.includes('schuldenausgleich') || title.includes('ausgleich');
}

function isExpenseSettled(expense: Expense, splits: Array<{ expense_id: string; settled?: number }>) {
  if (isSettlementExpense(expense)) return true;
  const expenseSplits = splits.filter(sp => sp.expense_id === expense.id);
  return expenseSplits.length > 0 && expenseSplits.every(sp => Number(sp.settled) === 1);
}

function expenseMeta(expense: Expense) {
  return isSettlementExpense(expense)
    ? EXPENSE_CATEGORIES.settlement
    : (EXPENSE_CATEGORIES[expense.category || 'sonstiges'] || EXPENSE_CATEGORIES.sonstiges);
}

function formatExpenseDate(createdAt: unknown) {
  const seconds = typeof createdAt === 'number' ? createdAt : Number(createdAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Datum unbekannt';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? 'Datum unbekannt' : date.toLocaleDateString('de-DE');
}

export function renderExpensesView(app: App) {
  const s = app.state;
  const settlementExpenses = s.expenses.filter(isSettlementExpense);
  const settledRegularExpenses = s.expenses.filter(e => !isSettlementExpense(e) && isExpenseSettled(e, s.splits));
  const regularExpenses = s.expenses.filter(e => !isSettlementExpense(e) && !isExpenseSettled(e, s.splits));
  const personalBalances = personalBalanceLines(s.userId, s.members, s.expenses, s.splits);
  const hasImbalance = personalBalances.length > 0;

  return `
    <div class="header">
      <h1><i class="ph ph-currency-eur"></i> Finanzen</h1>
      <div style="display:flex; gap:8px;">
        <button class="icon-btn" onclick="openPaymentHistoryModal()" title="Zahlungshistorie" aria-label="Zahlungshistorie öffnen"><i class="ph ph-clock-counter-clockwise"></i></button>
        ${hasImbalance ? `<button class="icon-btn" onclick="openSettleModal()" title="Schulden ausgleichen" aria-label="Schulden ausgleichen"><i class="ph ph-scales"></i></button>` : ''}
        <button class="icon-btn" onclick="openAddExpenseModal()" title="Ausgabe hinzufügen" aria-label="Ausgabe hinzufügen"><i class="ph ph-plus"></i></button>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title">Bilanz</div>
        ${hasImbalance ? `<button class="btn-mini" onclick="openSettleModal()" style="font-size: 0.75rem; padding: 4px 8px;"><i class="ph ph-scales"></i> Ausgleichen</button>` : ''}
      </div>
      ${personalBalances.length ? personalBalances.map(line => `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-${line.direction === 'you_owe' ? 'arrow-up-right' : 'arrow-down-left'}"></i></div>
            <div class="card-text">
              <div class="card-header">
                <div class="item-name">${line.direction === 'you_owe' ? 'Du schuldest ' + escapeHtml(line.memberName) : escapeHtml(line.memberName) + ' schuldet dir'}</div>
                <div class="item-qty ${line.direction === 'owes_you' ? 'balance-positive' : 'balance-negative'}">
                  ${line.amount.toFixed(2)} €
                </div>
              </div>
              <div class="card-meta">${line.direction === 'you_owe' ? 'Von dir zu zahlen' : 'Dir wird Geld geschuldet'}</div>
            </div>
          </div>
        </div>
      `).join('') : `<div class="empty-state">Du bist mit allen ausgeglichen</div>`}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Ausgaben</div></div>
      ${regularExpenses.length ? regularExpenses.map(e => {
        const payer = escapeHtml(app.getMemberName(e.paid_by));
        const expenseId = escapeJsAttr(e.id);
        const title = escapeHtml(cleanExpenseTitle(e.title));
        const cat = expenseMeta(e);
        const icon = escapeAttr(cat.icon);
        return `
        <div class="card">
          <div class="card-content" onclick="openEditExpenseModal('${expenseId}')">
            <div class="card-icon"><i class="ph ph-${icon}"></i></div>
            <div class="card-text">
              <div class="card-header">
                <div class="item-name">${title}</div>
                <div class="expense-amount">${e.amount.toFixed(2)} €</div>
              </div>
              <div class="card-meta"><span>Bezahlt von ${payer}</span> · <span>${formatExpenseDate(e.created_at)}</span></div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="event.stopPropagation(); deleteExpense('${expenseId}')" title="Löschen" aria-label="${title} löschen"><i class="ph ph-trash"></i></button>
          </div>
        </div>
        `;
      }).join('') : `<div class="empty-state">Noch keine Ausgaben</div>`}
    </div>
  `;
}

export function openPaymentHistoryModal() {
  const app = (window as any).app;
  const settlementExpenses = app.state.expenses.filter(isSettlementExpense);
  const settledRegularExpenses = app.state.expenses.filter((e: Expense) => !isSettlementExpense(e) && isExpenseSettled(e, app.state.splits));

  const settlementRows = settlementExpenses.length ? settlementExpenses.map((e: Expense) => {
    const payer = escapeHtml(app.getMemberName(e.paid_by));
    return `
      <div class="price-history-row payment-history-row">
        <span><i class="ph ph-${EXPENSE_CATEGORIES.settlement.icon}"></i> ${escapeHtml(cleanExpenseTitle(e.title))}<br><small>${payer} · ${formatExpenseDate(e.created_at)}</small></span>
        <span>${Number(e.amount || 0).toFixed(2)} €</span>
      </div>
    `;
  }).join('') : '<div class="empty-state" style="padding:16px;">Noch keine Schuldenausgleiche verbucht</div>';

  const settledRows = settledRegularExpenses.length ? settledRegularExpenses.map((e: Expense) => {
    const payer = escapeHtml(app.getMemberName(e.paid_by));
    const cat = expenseMeta(e);
    return `
      <div class="price-history-row payment-history-row">
        <span><i class="ph ph-${escapeAttr(cat.icon)}"></i> ${escapeHtml(cleanExpenseTitle(e.title))}<br><small>${payer} · ${formatExpenseDate(e.created_at)}</small></span>
        <span>${Number(e.amount || 0).toFixed(2)} €</span>
      </div>
    `;
  }).join('') : '<div class="empty-state" style="padding:16px;">Noch keine Ausgaben durch Ausgleich erledigt</div>';

  app.showModal('paymentHistoryModal', `
    <div class="modal-header"><div class="modal-title"><i class="ph ph-clock-counter-clockwise"></i> Zahlungshistorie</div><button class="close-btn" onclick="window.app.closeModal('paymentHistoryModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="section-header"><div class="section-title">Ausgleichszahlungen</div><span class="badge">${settlementExpenses.length}</span></div>
      <div class="price-history-list">${settlementRows}</div>
      <div class="section-header" style="margin-top:18px;"><div class="section-title">Beglichene Ausgaben</div><span class="badge">${settledRegularExpenses.length}</span></div>
      <div class="price-history-list">${settledRows}</div>
    </div>
  `);
}

export function openSettleModal() {
  const app = (window as any).app;
  const members = app.state.members;
  const expenses = app.state.expenses;
  const splits = app.state.splits;
  
  const balances = members.map((m: any) => {
    const paid = expenses.filter((e: any) => e.paid_by === m.id).reduce((a: number, e: any) => a + e.amount, 0);
    const owed = splits.filter((sp: any) => sp.user_id === m.id).reduce((a: number, sp: any) => a + sp.amount, 0);
    return { id: m.id, name: m.name, balance: paid - owed };
  });

  const debtors = balances.filter((b: any) => b.balance < -0.01).map((b: any) => ({ ...b, amount: -b.balance })).sort((a: any, b: any) => b.amount - a.amount);
  const creditors = balances.filter((b: any) => b.balance > 0.01).map((b: any) => ({ ...b, amount: b.balance })).sort((a: any, b: any) => b.amount - a.amount);
  
  const transfers: Array<{ fromId: string; fromName: string; toId: string; toName: string; amount: number }> = [];
  let dIdx = 0, cIdx = 0;
  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const amt = Math.min(debtor.amount, creditor.amount);
    transfers.push({ fromId: debtor.id, fromName: debtor.name, toId: creditor.id, toName: creditor.name, amount: amt });
    debtor.amount -= amt; creditor.amount -= amt;
    if (debtor.amount < 0.01) dIdx++;
    if (creditor.amount < 0.01) cIdx++;
  }

  if (!transfers.length) {
    app.toast('Alle Konten sind bereits ausgeglichen!');
    return;
  }

  const transfersHtml = transfers.map(t => `
    <div class="card" style="margin-bottom:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">
      <div><strong>${escapeHtml(t.fromName)}</strong> <i class="ph ph-arrow-right" style="vertical-align:middle; margin:0 4px;"></i> <strong>${escapeHtml(t.toName)}</strong></div>
      <div style="font-weight:700; color:var(--success);">${t.amount.toFixed(2)} €</div>
    </div>
  `).join('');

  app.showModal('settleModal', `
    <div class="modal-header"><div class="modal-title"><i class="ph ph-scales"></i> Schulden ausgleichen</div><button class="close-btn" onclick="window.app.closeModal('settleModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <p style="margin-bottom:12px; font-size:0.9rem; color:var(--text-soft);">Um alle Konten auf 0,00 € zu setzen, sind folgende Überweisungen nötig:</p>
      ${transfersHtml}
      <div style="margin-top:16px;">
        <button class="btn" style="width:100%; justify-content:center;" onclick="executeSettlement()"><i class="ph-bold ph-check"></i> Als bezahlt markieren (Ausgleich verbuchen)</button>
      </div>
    </div>
  `);

  (window as any)._pendingTransfers = transfers;
}

export async function executeSettlement() {
  const app = (window as any).app;
  const api = (window as any).api;
  const transfers = (window as any)._pendingTransfers;
  if (!transfers || !transfers.length) return;
  
  try {
    for (const t of transfers) {
      await api.expenses.create({
        household_id: app.state.householdId,
        title: 'Schuldenausgleich: ' + t.fromName + ' → ' + t.toName,
        amount: t.amount,
        paid_by: t.fromId,
        split_type: 'custom',
        category: 'settlement',
        splits: [{ user_id: t.toId, amount: t.amount }]
      });
    }
    await api.expenses.markSettled(app.state.householdId);
    app.closeModal('settleModal');
    await app.loadData();
    app.render();
    app.toast('Schulden erfolgreich ausgeglichen!');
  } catch (e) {
    app.toast('Fehler beim Ausgleichen');
  }
}

export function openAddExpenseModal() {
  renderExpenseEditorModal();
}

export function openEditExpenseModal(id: string) {
  const app = (window as any).app;
  const e = app.state.expenses.find((x: any) => x.id === id);
  if (!e) return;
  const eSplits = app.state.splits.filter((sp: any) => sp.expense_id === id);
  renderExpenseEditorModal(e, eSplits);
}

function renderExpenseEditorModal(existingExpense?: Expense, existingSplits?: any[]) {
  const app = (window as any).app;
  const members = app.state.members;
  const isEdit = !!existingExpense;
  const titleVal = existingExpense ? escapeAttr(existingExpense.title) : '';
  const amtVal = existingExpense ? existingExpense.amount : '';
  const paidByVal = existingExpense ? existingExpense.paid_by : app.state.userId;
  const catVal = existingExpense?.category || 'groceries';

  const payerOptions = members.map((m: any) => `<option value="${escapeAttr(m.id)}" ${paidByVal === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
  const catOptions = Object.entries(EXPENSE_CATEGORIES)
    .filter(([k]) => k !== 'settlement')
    .map(([k, v]) => `<option value="${k}" ${catVal === k ? 'selected' : ''}>${v.label}</option>`).join('');

  // Default spend split rule check (Issue #25 & #5)
  const ruleKey = `peerson_split_rule_${app.state.householdId}_${catVal}`;
  let defaultRule: Record<string, number> = {};
  try { defaultRule = JSON.parse(localStorage.getItem(ruleKey) || '{}'); } catch (e) {}

  const splitRows = members.map((m: any) => {
    let checked = true;
    let pct = 100 / members.length;
    let customAmt = 0;
    if (existingSplits && existingSplits.length > 0) {
      const sp = existingSplits.find(x => x.user_id === m.id);
      checked = !!sp;
      if (sp && existingExpense && existingExpense.amount > 0) {
        pct = Math.round((sp.amount / existingExpense.amount) * 100);
        customAmt = sp.amount;
      }
    } else if (defaultRule[m.id] !== undefined) {
      pct = defaultRule[m.id];
    }
    return `
      <div class="split-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border);">
        <label class="checkbox-label" style="font-size:0.9rem; margin:0;">
          <input type="checkbox" class="split-check-member" value="${escapeAttr(m.id)}" ${checked ? 'checked' : ''} onchange="updateSplitAmounts()">
          <span>${escapeHtml(m.name)}</span>
        </label>
        <div style="display:flex; align-items:center; gap:6px;">
          <input type="number" class="split-pct-input" data-user="${escapeAttr(m.id)}" value="${Math.round(pct)}" min="0" max="100" style="width:60px; padding:4px; text-align:right; display:none;" oninput="updateSplitAmounts('pct')"> <span class="pct-symbol" style="display:none;">%</span>
          <input type="number" class="split-amt-input" data-user="${escapeAttr(m.id)}" value="${customAmt.toFixed(2)}" step="0.01" min="0" style="width:80px; padding:4px; text-align:right;" oninput="updateSplitAmounts('amt')"> <span>€</span>
        </div>
      </div>
    `;
  }).join('');

  app.showModal('expenseModal', `
    <div class="modal-header"><div class="modal-title">${isEdit ? 'Ausgabe bearbeiten' : 'Ausgabe hinzufügen'}</div><button class="close-btn" onclick="window.app.closeModal('expenseModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>Titel</label><input type="text" id="expTitle" placeholder="z. B. Wocheneinkauf" value="${titleVal}"></div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div class="form-group"><label>Betrag (€)</label><input type="number" id="expAmount" step="0.01" min="0" value="${amtVal}" oninput="updateSplitAmounts()"></div>
        <div class="form-group"><label>Kategorie</label><select id="expCategory" onchange="onExpenseCatChange()">${catOptions}</select></div>
      </div>
      <div class="form-group"><label>Bezahlt von</label><select id="expPayer">${payerOptions}</select></div>
      
      <div class="form-group" style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <label style="margin:0">Aufteilung</label>
          <select id="expSplitMode" style="width:auto; padding:2px 8px; font-size:0.8rem;" onchange="onSplitModeChange()">
            <option value="equal">Gleichmäßig</option>
            <option value="pct" ${Object.keys(defaultRule).length ? 'selected' : ''}>Prozentual (%)</option>
            <option value="custom">Beträge (€)</option>
          </select>
        </div>
        <div id="splitRowsContainer" style="background:var(--field-bg); border:1px solid var(--border); padding:8px 12px; border-radius:var(--radius-sm);">${splitRows}</div>
        <div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
          <button class="btn btn-small btn-secondary" type="button" onclick="saveDefaultSplitRule()"><i class="ph ph-push-pin"></i> Als Standard für Kategorie speichern</button>
          <span id="splitTotalHint" style="font-size:0.8rem; font-weight:700; color:var(--text-soft);">Summe: 0,00 €</span>
        </div>
      </div>

      <button class="btn mt-3" onclick="${isEdit ? `saveEditedExpense('${escapeJsAttr(existingExpense.id)}')` : 'saveNewExpense()'}"><i class="ph-bold ph-check"></i> ${isEdit ? 'Änderungen speichern' : 'Ausgabe erstellen'}</button>
    </div>
  `);

  setTimeout(() => {
    onSplitModeChange();
    updateSplitAmounts();
  }, 10);
}

export function onSplitModeChange() {
  const mode = (document.getElementById('expSplitMode') as HTMLSelectElement)?.value || 'equal';
  const pctInputs = document.querySelectorAll('.split-pct-input');
  const pctSymbols = document.querySelectorAll('.pct-symbol');
  const amtInputs = document.querySelectorAll('.split-amt-input');

  pctInputs.forEach((el: any) => el.style.display = mode === 'pct' ? 'inline-block' : 'none');
  pctSymbols.forEach((el: any) => el.style.display = mode === 'pct' ? 'inline' : 'none');
  amtInputs.forEach((el: any) => el.readOnly = mode !== 'custom');
  
  updateSplitAmounts();
}

export function onExpenseCatChange() {
  const app = (window as any).app;
  const cat = (document.getElementById('expCategory') as HTMLSelectElement)?.value || 'groceries';
  const ruleKey = `peerson_split_rule_${app.state.householdId}_${cat}`;
  let rule: Record<string, number> = {};
  try { rule = JSON.parse(localStorage.getItem(ruleKey) || '{}'); } catch (e) {}

  if (Object.keys(rule).length > 0) {
    (document.getElementById('expSplitMode') as HTMLSelectElement).value = 'pct';
    onSplitModeChange();
    document.querySelectorAll('.split-pct-input').forEach((el: any) => {
      const uid = el.getAttribute('data-user');
      if (rule[uid] !== undefined) el.value = rule[uid];
    });
    updateSplitAmounts();
    app.toast('Standard-Aufteilung für Kategorie geladen');
  }
}

export function updateSplitAmounts(source?: 'pct' | 'amt') {
  const total = parseFloat((document.getElementById('expAmount') as HTMLInputElement)?.value) || 0;
  const mode = (document.getElementById('expSplitMode') as HTMLSelectElement)?.value || 'equal';
  const checkedRows = Array.from(document.querySelectorAll('.split-check-member:checked'));
  const hint = document.getElementById('splitTotalHint');

  if (mode === 'equal') {
    const share = checkedRows.length > 0 ? total / checkedRows.length : 0;
    document.querySelectorAll('.split-check-member').forEach((cb: any) => {
      const amtInput = document.querySelector(`.split-amt-input[data-user="${cb.value}"]`) as HTMLInputElement;
      if (amtInput) amtInput.value = cb.checked ? share.toFixed(2) : '0.00';
    });
    if (hint) hint.textContent = `Summe: ${total.toFixed(2)} €`;
  } else if (mode === 'pct') {
    let sumPct = 0;
    checkedRows.forEach((cb: any) => {
      const pctInput = document.querySelector(`.split-pct-input[data-user="${cb.value}"]`) as HTMLInputElement;
      const amtInput = document.querySelector(`.split-amt-input[data-user="${cb.value}"]`) as HTMLInputElement;
      const pct = parseFloat(pctInput?.value) || 0;
      sumPct += pct;
      if (amtInput) amtInput.value = ((total * pct) / 100).toFixed(2);
    });
    if (hint) hint.textContent = `Summe: ${sumPct}% (${((total * sumPct) / 100).toFixed(2)} €)`;
  } else if (mode === 'custom') {
    let sumAmt = 0;
    checkedRows.forEach((cb: any) => {
      const amtInput = document.querySelector(`.split-amt-input[data-user="${cb.value}"]`) as HTMLInputElement;
      sumAmt += parseFloat(amtInput?.value) || 0;
    });
    if (hint) hint.textContent = `Summe: ${sumAmt.toFixed(2)} € / ${total.toFixed(2)} €`;
  }
}

export function saveDefaultSplitRule() {
  const app = (window as any).app;
  const cat = (document.getElementById('expCategory') as HTMLSelectElement)?.value || 'groceries';
  const rule: Record<string, number> = {};
  document.querySelectorAll('.split-pct-input').forEach((el: any) => {
    const uid = el.getAttribute('data-user');
    const pct = parseFloat(el.value) || 0;
    if (uid) rule[uid] = pct;
  });
  const ruleKey = `peerson_split_rule_${app.state.householdId}_${cat}`;
  localStorage.setItem(ruleKey, JSON.stringify(rule));
  app.toast('Standard-Aufteilung (%) für Kategorie gespeichert!');
}

export async function saveNewExpense() {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const title = (document.getElementById('expTitle') as HTMLInputElement)?.value.trim();
    const amount = parseFloat((document.getElementById('expAmount') as HTMLInputElement)?.value);
    const paid_by = (document.getElementById('expPayer') as HTMLSelectElement)?.value;
    const category = (document.getElementById('expCategory') as HTMLSelectElement)?.value || 'sonstiges';

    if (!title || isNaN(amount) || amount <= 0) return app.toast('Bitte gültige Daten eingeben');

    const checked = Array.from(document.querySelectorAll('.split-check-member:checked'));
    if (checked.length === 0) return app.toast('Mindestens eine Person auswählen');

    const splits = checked.map((cb: any) => {
      const amtInput = document.querySelector(`.split-amt-input[data-user="${cb.value}"]`) as HTMLInputElement;
      return { user_id: cb.value, amount: parseFloat(amtInput?.value) || 0 };
    });

    await api.expenses.create({ household_id: app.state.householdId, title, amount, paid_by, category, split_type: 'custom', splits });
    app.closeModal('expenseModal');
    await app.loadData();
    app.render();
    app.toast('Ausgabe erstellt');
  } catch (e) {
    app.toast('Fehler beim Speichern');
  }
}

export async function saveEditedExpense(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const title = (document.getElementById('expTitle') as HTMLInputElement)?.value.trim();
    const amount = parseFloat((document.getElementById('expAmount') as HTMLInputElement)?.value);
    const paid_by = (document.getElementById('expPayer') as HTMLSelectElement)?.value;
    const category = (document.getElementById('expCategory') as HTMLSelectElement)?.value || 'sonstiges';

    if (!title || isNaN(amount) || amount <= 0) return app.toast('Bitte gültige Daten eingeben');

    const checked = Array.from(document.querySelectorAll('.split-check-member:checked'));
    if (checked.length === 0) return app.toast('Mindestens eine Person auswählen');

    const splits = checked.map((cb: any) => {
      const amtInput = document.querySelector(`.split-amt-input[data-user="${cb.value}"]`) as HTMLInputElement;
      return { user_id: cb.value, amount: parseFloat(amtInput?.value) || 0 };
    });

    await api.expenses.update(id, { title, amount, paid_by, category, split_type: 'custom', splits });
    app.closeModal('expenseModal');
    await app.loadData();
    app.render();
    app.toast('Ausgabe aktualisiert');
  } catch (e) {
    app.toast('Fehler beim Aktualisieren');
  }
}

export async function deleteExpense(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  const exp = app.state.expenses.find((e: any) => e.id === id);
  if (!exp) return;
  app.scheduleSoftDelete('expense', exp, app.state.expenses, '"' + exp.title + '"', async () => {
    await api.expenses.delete(id);
  });
}

// Bind to window for HTML onclick handlers
Object.assign(window as any, {
  openSettleModal,
  openPaymentHistoryModal,
  executeSettlement,
  openAddExpenseModal,
  openEditExpenseModal,
  onSplitModeChange,
  onExpenseCatChange,
  updateSplitAmounts,
  saveDefaultSplitRule,
  saveNewExpense,
  saveEditedExpense,
  deleteExpense
});
