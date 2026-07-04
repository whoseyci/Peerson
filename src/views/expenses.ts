import type { App } from '../app';

export function renderExpensesView(app: App) {
  const s = app.state;
  const balances = s.members.map(m => {
    const paid = s.expenses.filter(e => e.paid_by === m.id).reduce((a, e) => a + e.amount, 0);
    const owed = s.splits.filter(sp => sp.user_id === m.id).reduce((a, sp) => a + sp.amount, 0);
    return { ...m, balance: paid - owed };
  });

  return `
    <div class="header">
      <h1><i class="ph ph-currency-euro"></i> Finanzen</h1>
      <button class="icon-btn" onclick="openAddExpenseModal()"><i class="ph ph-plus"></i></button>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Bilanz</div></div>
      ${balances.map(b => `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header">
                <div class="item-name">${b.name}</div>
                <div class="item-qty ${b.balance >= 0 ? 'balance-positive' : 'balance-negative'}">
                  ${b.balance >= 0 ? '+' : ''}${b.balance.toFixed(2)} €
                </div>
              </div>
              <div class="card-meta">${b.balance >= 0 ? 'Bekommt Geld' : 'Schuldet Geld'}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Ausgaben</div></div>
      ${s.expenses.length ? s.expenses.map(e => {
        const payer = app.getMemberName(e.paid_by);
        return `
        <div class="card">
          <div class="card-content">
            <div class="card-text">
              <div class="card-header"><div class="item-name">${e.title}</div><div class="expense-amount">${e.amount.toFixed(2)} €</div></div>
              <div class="card-meta">Bezahlt von ${payer} · ${new Date(e.created_at).toLocaleDateString('de-DE')}</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="deleteExpense('${e.id}')"><i class="ph ph-trash"></i></button>
          </div>
        </div>
        `;
      }).join('') : `<div class="empty-state">Noch keine Ausgaben</div>`}
    </div>

    <script>
      async function openAddExpenseModal() {
        const members = window.app.state.members;
        const checkboxes = members.map(m =>
          '<label class="checkbox-label">' +
            '<input type="checkbox" class="split-check" data-id="' + m.id + '" checked>' +
            '<span>' + m.name + '</span>' +
          '</label>'
        ).join('');
        const payerOptions = members.map(m => '<option value="' + m.id + '">' + m.name + '</option>').join('');
        window.app.showModal('expenseModal',
          '<div class="modal-header"><div class="modal-title">Ausgabe hinzufügen</div><button class="close-btn" onclick="window.app.closeModal(\'expenseModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Titel</label><input type="text" id="expTitle" placeholder="z. B. Wocheneinkauf"></div>' +
            '<div class="form-group"><label>Betrag (€)</label><input type="number" id="expAmount" step="0.01" min="0"></div>' +
            '<div class="form-group"><label>Bezahlt von</label><select id="expPayer">' + payerOptions + '</select></div>' +
            '<div class="form-group"><label>Aufteilen zwischen</label>' + checkboxes + '</div>' +
            '<button class="btn" onclick="saveExpense()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function saveExpense() {
        try {
          const title = document.getElementById('expTitle').value.trim();
          const amount = parseFloat(document.getElementById('expAmount').value);
          const paidBy = document.getElementById('expPayer').value;
          if (!title || !amount || amount <= 0) return window.app.toast('Titel und Betrag erforderlich');
          const checked = Array.from(document.querySelectorAll('.split-check:checked')).map(el => el.getAttribute('data-id'));
          if (checked.length === 0) return window.app.toast('Mindestens eine Person auswählen');
          const splitAmount = amount / checked.length;
          const splits = checked.map(uid => ({ user_id: uid, amount: splitAmount }));
          const expense = await window.api.expenses.create({
            household_id: window.app.state.householdId,
            title,
            amount,
            paid_by: paidBy,
            split_type: 'equal',
            splits
          });
          window.app.state.expenses.push(expense.expense);
          const data = await window.api.expenses.list(window.app.state.householdId);
          window.app.state.splits = data.splits;
          window.app.state.members = data.members;
          window.app.closeModal('expenseModal');
          window.app.render();
          window.app.toast('Ausgabe gespeichert');
        } catch (e) {
          window.app.toast('Fehler beim Speichern');
        }
      }
      async function deleteExpense(id) {
        if (!confirm('Löschen?')) return;
        try {
          await window.api.expenses.delete(id);
          window.app.state.expenses = window.app.state.expenses.filter(e => e.id !== id);
          const data = await window.api.expenses.list(window.app.state.householdId);
          window.app.state.splits = data.splits;
          window.app.render();
          window.app.toast('Gelöscht');
        } catch (e) {
          window.app.toast('Fehler beim Löschen');
        }
      }
    </script>
  `;
}
