import type { App } from '../app';

export function renderExpensesView(app: App) {
  const s = app.state;
  const balances = s.members.map(m => {
    const paid = s.expenses.filter(e => e.paid_by === m.id).reduce((a, e) => a + e.amount, 0);
    const owed = s.splits.filter(sp => sp.user_id === m.id).reduce((a, sp) => a + sp.amount, 0);
    return { ...m, balance: paid - owed };
  });

  const hasImbalance = balances.some(b => Math.abs(b.balance) > 0.05);

  return `
    <div class="header">
      <h1><i class="ph ph-currency-eur"></i> Finanzen</h1>
      <div style="display:flex; gap:8px;">
        ${hasImbalance ? `<button class="icon-btn" onclick="openSettleModal()" title="Schulden ausgleichen"><i class="ph ph-scales"></i></button>` : ''}
        <button class="icon-btn" onclick="openAddExpenseModal()" title="Ausgabe hinzufügen"><i class="ph ph-plus"></i></button>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title">Bilanz</div>
        ${hasImbalance ? `<button class="btn-mini" onclick="openSettleModal()" style="font-size: 0.75rem; padding: 4px 8px;"><i class="ph ph-scales"></i> Ausgleichen</button>` : ''}
      </div>
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
        const isSettlement = e.title.includes('Schuldenausgleich') || e.title.includes('Ausgleich');
        return `
        <div class="card ${isSettlement ? 'settlement-card' : ''}" style="${isSettlement ? 'border-left: 3px solid var(--success);' : ''}">
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
      function openSettleModal() {
        const members = window.app.state.members;
        const expenses = window.app.state.expenses;
        const splits = window.app.state.splits;
        
        const balances = members.map(m => {
          const paid = expenses.filter(e => e.paid_by === m.id).reduce((a, e) => a + e.amount, 0);
          const owed = splits.filter(sp => sp.user_id === m.id).reduce((a, sp) => a + sp.amount, 0);
          return { id: m.id, name: m.name, balance: paid - owed };
        });

        const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b, amount: -b.balance })).sort((a, b) => b.amount - a.amount);
        const creditors = balances.filter(b => b.balance > 0.01).map(b => ({ ...b, amount: b.balance })).sort((a, b) => b.amount - a.amount);
        
        const transfers = [];
        let dIdx = 0, cIdx = 0;
        while (dIdx < debtors.length && cIdx < creditors.length) {
          const debtor = debtors[dIdx];
          const creditor = creditors[cIdx];
          const amt = Math.min(debtor.amount, creditor.amount);
          
          transfers.push({
            fromId: debtor.id,
            fromName: debtor.name,
            toId: creditor.id,
            toName: creditor.name,
            amount: amt
          });
          
          debtor.amount -= amt;
          creditor.amount -= amt;
          if (debtor.amount < 0.01) dIdx++;
          if (creditor.amount < 0.01) cIdx++;
        }

        if (!transfers.length) {
          window.app.toast('Alle Konten sind bereits ausgeglichen!');
          return;
        }

        const transfersHtml = transfers.map((t, idx) =>
          '<div class="card" style="margin-bottom:8px; padding:12px; display:flex; justify-content:space-between; align-items:center;">' +
            '<div><strong>' + t.fromName + '</strong> <i class="ph ph-arrow-right" style="vertical-align:middle; margin:0 4px;"></i> <strong>' + t.toName + '</strong></div>' +
            '<div style="font-weight:700; color:var(--success);">' + t.amount.toFixed(2) + ' €</div>' +
          '</div>'
        ).join('');

        window.app.showModal('settleModal',
          '<div class="modal-header"><div class="modal-title"><i class="ph ph-scales"></i> Schulden ausgleichen</div><button class="close-btn" onclick="window.app.closeModal(\\'settleModal\\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<p style="margin-bottom:12px; font-size:0.9rem; color:var(--text-soft);">Um alle Konten auf 0,00 € zu setzen, sind folgende Überweisungen nötig:</p>' +
            transfersHtml +
            '<div style="margin-top:16px;">' +
              '<button class="btn" style="width:100%; justify-content:center;" onclick="executeSettlement()"><i class="ph-bold ph-check"></i> Als bezahlt markieren (Ausgleich verbuchen)</button>' +
            '</div>' +
          '</div>'
        );

        window._pendingTransfers = transfers;
      }

      async function executeSettlement() {
        const transfers = window._pendingTransfers;
        if (!transfers || !transfers.length) return;
        
        try {
          for (const t of transfers) {
            await window.api.expenses.create({
              household_id: window.app.state.householdId,
              title: '💸 Schuldenausgleich (' + t.fromName + ' an ' + t.toName + ')',
              amount: t.amount,
              paid_by: t.fromId,
              split_type: 'custom',
              splits: [{ user_id: t.toId, amount: t.amount }]
            });
          }
          window.app.closeModal('settleModal');
          await window.app.loadData();
          window.app.render();
          window.app.toast('Schulden erfolgreich ausgeglichen!');
        } catch (e) {
          window.app.toast('Fehler beim Ausgleichen');
        }
      }

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
          '<div class="modal-header"><div class="modal-title">Ausgabe hinzufügen</div><button class="close-btn" onclick="window.app.closeModal(\\'expenseModal\\')"><i class="ph ph-x"></i></button></div>' +
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
          const paid_by = document.getElementById('expPayer').value;
          
          if (!title || isNaN(amount) || amount <= 0) {
            return window.app.toast('Bitte gültige Daten eingeben');
          }

          const checked = Array.from(document.querySelectorAll('.split-check:checked')).map(el => el.getAttribute('data-id'));
          if (checked.length === 0) return window.app.toast('Mindestens eine Person muss ausgewählt sein');

          const splitAmount = amount / checked.length;
          const splits = checked.map(id => ({ user_id: id, amount: splitAmount }));

          const res = await window.api.expenses.create({
            household_id: window.app.state.householdId,
            title,
            amount,
            paid_by,
            split_type: 'custom',
            splits
          });

          window.app.closeModal('expenseModal');
          await window.app.loadData();
          window.app.render();
          window.app.toast('Gespeichert');
        } catch (e) {
          window.app.toast('Fehler beim Speichern');
        }
      }

      async function deleteExpense(id) {
        const exp = window.app.state.expenses.find(e => e.id === id);
        if (!exp) return;
        window.app.scheduleSoftDelete('expense', exp, window.app.state.expenses, '"' + exp.title + '"', async () => {
          await window.api.expenses.delete(id);
        });
      }
    </script>
  `;
}
