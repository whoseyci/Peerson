import type { App } from '../app';
import { escapeHtml, escapeJsAttr } from '../utils/html';

// Full-screen guided "Einkaufstour" flow -- walks through every open
// shopping-list entry one at a time. Deliberately reuses the shopping
// list's existing purchase-logging plumbing (openBoughtDetailsModal /
// saveBoughtDetails from shopping.ts) rather than re-implementing
// "convert a shopping-list line into inventory batches" a second time;
// this view only adds the step-through/progress-bar/summary chrome around
// that already-tested logic, plus a lighter-weight "quick log" sheet for
// the common case of just wanting to check something off (with
// quantity+price) without diving into the fuller bought-details modal.

interface TripState {
  ids: string[];
  checkedIds: Set<string>;
  totalSpent: number;
}

let trip: TripState | null = null;

export function openShoppingTrip() {
  const app = (window as any).app as App;
  const open = app.state.shopping.filter(s => s.status === 'open');
  if (!open.length) {
    app.toast('Die Einkaufsliste ist leer');
    return;
  }
  trip = { ids: open.map(s => s.id), checkedIds: new Set(), totalSpent: 0 };
  renderTripScreen();
  requestAnimationFrame(() => {
    document.getElementById('tripScreen')?.classList.add('show');
  });
}

export function closeShoppingTrip() {
  document.getElementById('tripScreen')?.classList.remove('show');
  setTimeout(() => {
    document.getElementById('tripScreen')?.remove();
    trip = null;
  }, 320);
}

function renderTripScreen() {
  const app = (window as any).app as App;
  if (!trip) return;
  const total = trip.ids.length;
  const done = trip.checkedIds.size;
  const allDone = done === total;

  let el = document.getElementById('tripScreen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tripScreen';
    el.className = 'trip-screen';
    document.body.appendChild(el);
  }

  if (allDone) {
    el.innerHTML = `
      <div class="trip-head">
        <button class="icon-btn" onclick="closeShoppingTrip()"><i class="ph ph-x"></i></button>
        <h2>Einkaufstour</h2>
        <div style="width:38px;"></div>
      </div>
      <div class="trip-progress-track"><div class="trip-progress-fill" style="width:100%"></div></div>
      <div class="trip-body">
        <div class="trip-summary">
          <div class="ts-icon"><i class="ph-bold ph-check"></i></div>
          <div class="ts-total">${trip.totalSpent.toFixed(2)} €</div>
          <div style="color:var(--text-soft); font-weight:600;">Insgesamt ausgegeben</div>
          <button class="btn mt-3" onclick="logTripAsExpense()"><i class="ph-bold ph-currency-eur"></i> Als Ausgabe verbuchen (gleichmäßig teilen)</button>
          <button class="btn btn-secondary" onclick="closeShoppingTrip()">Fertig</button>
        </div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="trip-head">
      <button class="icon-btn" onclick="closeShoppingTrip()"><i class="ph ph-x"></i></button>
      <h2>Einkaufstour · ${done}/${total}</h2>
      <div style="width:38px;"></div>
    </div>
    <div class="trip-progress-track"><div class="trip-progress-fill" style="width:${(done / total) * 100}%"></div></div>
    <div class="trip-body">
      ${trip.ids.map(id => {
        const item = app.state.shopping.find(s => s.id === id);
        if (!item) return '';
        const checked = trip!.checkedIds.has(id);
        return `
          <div class="trip-item-card ${checked ? 'checked' : ''}" onclick="${checked ? '' : `openTripQuickLog('${escapeJsAttr(id)}')`}">
            <div class="check-circle">${checked ? '<i class="ph-bold ph-check"></i>' : ''}</div>
            <div style="flex:1;">
              <div style="font-weight:700; font-size:14.5px;">${escapeHtml(item.name)}</div>
              ${item.quantity ? `<div style="font-size:12px; color:var(--text-soft);">${escapeHtml(item.quantity)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function openTripQuickLog(shopItemId: string) {
  const app = (window as any).app as App;
  const item = app.state.shopping.find(s => s.id === shopItemId);
  if (!item) return;
  (window as any)._tripQuickLogId = shopItemId;
  (window as any)._tripQuickLogQty = 1;
  app.showSheet('sheetQuickLog', escapeHtml(item.name), `
    <div class="field" style="margin-bottom:14px;">
      <label style="display:block; font-size:11.5px; font-weight:800; color:var(--text-soft); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Menge</label>
      <div class="qty-stepper">
        <button onclick="adjustTripQty(-1)">−</button>
        <div class="qty-big" id="qlQtyDisplay">1</div>
        <button onclick="adjustTripQty(1)">+</button>
      </div>
    </div>
    <div class="form-group"><label>Preis (€)</label><input type="number" id="qlPrice" step="0.01" min="0" placeholder="z. B. 2.49" value="${item.price ? item.price.toFixed(2) : ''}"></div>
    <button class="btn" onclick="confirmTripQuickLog()"><i class="ph-bold ph-check"></i> Abhaken &amp; weiter</button>
  `);
}

export function adjustTripQty(delta: number) {
  const current = (window as any)._tripQuickLogQty || 1;
  const next = Math.max(1, current + delta);
  (window as any)._tripQuickLogQty = next;
  const display = document.getElementById('qlQtyDisplay');
  if (display) display.textContent = String(next);
}

export async function confirmTripQuickLog() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const shopItemId = (window as any)._tripQuickLogId as string;
  const qty = (window as any)._tripQuickLogQty || 1;
  const priceVal = (document.getElementById('qlPrice') as HTMLInputElement)?.value;
  const price = priceVal ? parseFloat(priceVal) || null : null;

  const shopItem = app.state.shopping.find(s => s.id === shopItemId);
  if (!shopItem || !trip) return;

  try {
    // Reuse the exact same "mark bought + push a batch into inventory"
    // logic the plain shopping list already uses, rather than
    // duplicating it -- see shopping.ts's saveBoughtDetails for the full
    // rationale (barcode/variant carry-through etc).
    let linkedId = shopItem.linked_item_id || null;
    if (!linkedId) {
      const pItem = app.state.items.find(i => i.name.trim().toLowerCase() === shopItem.name.trim().toLowerCase());
      if (pItem) linkedId = pItem.id;
    }

    await api.shopping.update(shopItemId, { status: 'bought', price });
    shopItem.status = 'bought';
    shopItem.price = price;

    if (linkedId) {
      const pItem = app.state.items.find(i => i.id === linkedId);
      const barcodeCode = (pItem && Array.isArray(pItem.barcodes) && pItem.barcodes.length > 0) ? pItem.barcodes[0].code : null;
      const batch = await api.batches.create({
        item_id: linkedId,
        quantity: qty,
        price,
        barcode_code: barcodeCode,
        grams_per_unit: 0,
      });
      app.state.batches.push(batch.batch);
    }

    trip.checkedIds.add(shopItemId);
    if (price) trip.totalSpent += price;

    app.closeSheet('sheetQuickLog');
    renderTripScreen();
  } catch (e) {
    app.toast('Fehler beim Verbuchen');
  }
}

export async function logTripAsExpense() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  if (!trip || trip.totalSpent <= 0) {
    app.toast('Kein Betrag zum Verbuchen');
    return;
  }
  try {
    const members = app.state.members;
    const share = trip.totalSpent / Math.max(1, members.length);
    await api.expenses.create({
      household_id: app.state.householdId,
      title: 'Einkaufstour',
      amount: trip.totalSpent,
      paid_by: app.state.userId,
      split_type: 'equal',
      category: 'groceries',
      splits: members.map(m => ({ user_id: m.id, amount: share })),
    });
    await app.loadData();
    app.toast('Als Ausgabe verbucht');
    closeShoppingTrip();
    app.render();
  } catch (e) {
    app.toast('Fehler beim Verbuchen');
  }
}

Object.assign(window as any, {
  openShoppingTrip,
  closeShoppingTrip,
  openTripQuickLog,
  adjustTripQty,
  confirmTripQuickLog,
  logTripAsExpense,
});
