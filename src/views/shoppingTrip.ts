import type { App } from '../app';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';
import { t } from '../i18n';

interface TripState {
  ids: string[];
  checkedIds: Set<string>;
  spentById: Map<string, number>;
  totalSpent: number;
  summary: boolean;
}

let trip: TripState | null = null;

export function openShoppingTrip() {
  const app = (window as any).app as App;
  const open = app.state.shopping.filter(s => s.status === 'open');
  trip = { ids: open.map(s => s.id), checkedIds: new Set(), spentById: new Map(), totalSpent: 0, summary: false };
  app.setShoppingPresence(true);
  renderTripScreen();
  requestAnimationFrame(() => {
    document.getElementById('tripScreen')?.classList.add('show');
  });
}

export function closeShoppingTrip() {
  const app = (window as any).app as App;
  app.setShoppingPresence(false);
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
  syncTripWithShoppingState(app);
  const done = tripDoneCount(app);
  const allDone = total > 0 && done === total;

  let el = document.getElementById('tripScreen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tripScreen';
    el.className = 'trip-screen';
    document.body.appendChild(el);
  }

  if (trip.summary || allDone) {
    renderTripSummary(el, done, total);
    return;
  }

  el.innerHTML = `
    <div class="trip-head">
      <button class="icon-btn" onclick="closeShoppingTrip()" aria-label="Einkaufstour schließen"><i class="ph ph-x"></i></button>
      <h2>Einkaufstour · ${done}/${total}</h2>
      <button class="btn btn-small btn-secondary" style="width:auto; margin-top:0;" onclick="finishShoppingTrip()">Beenden</button>
    </div>
    <div class="trip-progress-track"><div class="trip-progress-fill" style="width:${total ? (done / total) * 100 : 0}%"></div></div>
    ${renderTripPresenceBand(app)}
    <div class="trip-body">
      <div class="trip-actions">
        <button class="btn btn-secondary btn-small" onclick="scanTripExtra()"><i class="ph ph-barcode"></i> Barcode</button>
        <button class="btn btn-secondary btn-small" onclick="openTripManualAdd()"><i class="ph ph-plus"></i> Ohne Barcode</button>
      </div>
      ${total ? trip.ids.map(id => {
        const item = app.state.shopping.find(s => s.id === id);
        if (!item) return '';
        const checked = isTripItemChecked(app, id);
        return `
          <div class="trip-item-card ${checked ? 'checked' : ''}" onclick="${checked ? `untickTripItem('${escapeJsAttr(id)}')` : `openTripQuickLog('${escapeJsAttr(id)}')`}">
            <div class="check-circle">${checked ? '<i class="ph-bold ph-check"></i>' : ''}</div>
            <div style="flex:1; min-width:0;">
              <div style="font-weight:700; font-size:14.5px;">${escapeHtml(item.name)}</div>
              ${item.quantity ? `<div style="font-size:12px; color:var(--text-soft);">${escapeHtml(item.quantity)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('') : `
        <div class="empty-state" style="padding:22px;">
          Noch nichts in dieser Tour. Scanne einen Artikel oder füge etwas ohne Barcode hinzu.
        </div>`}
      <button class="btn mt-3" onclick="finishShoppingTrip()"><i class="ph-bold ph-check"></i> Einkauf beenden (${total - done} offen lassen)</button>
    </div>
  `;
}

function syncTripWithShoppingState(app: App) {
  if (!trip) return;
  trip.ids.forEach(id => {
    const item = app.state.shopping.find(s => s.id === id);
    if (item?.status === 'bought') trip!.checkedIds.add(id);
    else trip!.checkedIds.delete(id);
  });
}

function isTripItemChecked(app: App, id: string) {
  const item = app.state.shopping.find(s => s.id === id);
  return item?.status === 'bought' || !!trip?.checkedIds.has(id);
}

function tripDoneCount(app: App) {
  if (!trip) return 0;
  return trip.ids.filter(id => isTripItemChecked(app, id)).length;
}

export function refreshShoppingTripRealtime() {
  if (trip) renderTripScreen();
}

function renderTripPresenceBand(app: App) {
  const shoppers = (app.realtimePresence || []).filter(u => u.shopping);
  if (!shoppers.length) return '';
  const names = shoppers.map(u => escapeHtml(u.name || 'Someone')).join(', ');
  const text = shoppers.length === 1
    ? t('presence.shoppingAlsoOne', { name: names })
    : t('presence.shoppingAlsoMany', { names });
  return `<div class="status-card" style="margin:12px 20px 0;"><i class="ph ph-shopping-cart-simple"></i> ${text}</div>`;
}

function renderTripSummary(el: HTMLElement, done: number, total: number) {
  if (!trip) return;
  const leftOpen = Math.max(0, total - done);
  el.innerHTML = `
    <div class="trip-head">
      <button class="icon-btn" onclick="closeShoppingTrip()" aria-label="Einkaufstour schließen"><i class="ph ph-x"></i></button>
      <h2>Einkauf beendet</h2>
      <div style="width:38px;"></div>
    </div>
    <div class="trip-progress-track"><div class="trip-progress-fill" style="width:${total ? (done / total) * 100 : 0}%"></div></div>
    <div class="trip-body">
      <div class="trip-summary">
        <div class="ts-icon"><i class="ph-bold ph-check"></i></div>
        <div class="ts-total">${trip.totalSpent.toFixed(2)} €</div>
        <div style="color:var(--text-soft); font-weight:600;">Aus den abgehakten Artikeln</div>
        <div class="form-group" style="margin-top:18px; text-align:left;">
          <label>Gezahlt an der Kasse (€)</label>
          <input type="number" id="tripFinalTotal" step="0.01" min="0" value="${trip.totalSpent.toFixed(2)}" placeholder="z. B. nach Rabatt">
          <div style="font-size:12px; color:var(--text-soft); margin-top:6px;">Hier kannst du Rabatte oder Kassendifferenzen korrigieren, bevor es in die Ausgaben geht.</div>
        </div>
        <div style="color:var(--text-soft); font-size:13px; margin:12px 0;">${done} gekauft · ${leftOpen} bleiben offen</div>
        <button class="btn mt-3" onclick="logTripAsExpense()"><i class="ph-bold ph-currency-eur"></i> Als Ausgabe verbuchen</button>
        ${leftOpen ? `<button class="btn btn-secondary" onclick="continueShoppingTrip()">Zurück zur Tour</button>` : ''}
        <button class="btn btn-secondary" onclick="closeShoppingTrip()">Ohne Ausgabe schließen</button>
      </div>
    </div>
  `;
}

export function finishShoppingTrip() {
  if (!trip) return;
  trip.summary = true;
  renderTripScreen();
}

export function continueShoppingTrip() {
  if (!trip) return;
  trip.summary = false;
  renderTripScreen();
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
    <div class="form-group"><label>Preis gezahlt (€)</label><input type="number" id="qlPrice" step="0.01" min="0" placeholder="z. B. 2.49" value="${item.price ? item.price.toFixed(2) : ''}"></div>
    <button class="btn" onclick="confirmTripQuickLog()"><i class="ph-bold ph-check"></i> Abhaken &amp; weiter</button>
  `);
}


export async function untickTripItem(shopItemId: string) {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const shopItem = app.state.shopping.find(s => s.id === shopItemId);
  if (!shopItem || !trip) return;
  try {
    await api.shopping.update(shopItemId, { status: 'open' });
    shopItem.status = 'open';
    trip.checkedIds.delete(shopItemId);
    const spent = trip.spentById.get(shopItemId) || 0;
    if (spent) {
      trip.totalSpent = Math.max(0, trip.totalSpent - spent);
      trip.spentById.delete(shopItemId);
    }
    trip.summary = false;
    renderTripScreen();
  } catch (e) {
    app.toast('Fehler beim Aktualisieren');
  }
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

    if (!trip.checkedIds.has(shopItemId) && price) {
      trip.totalSpent += price;
      trip.spentById.set(shopItemId, price);
    }
    trip.checkedIds.add(shopItemId);

    app.closeSheet('sheetQuickLog');
    renderTripScreen();
  } catch (e) {
    app.toast('Fehler beim Verbuchen');
  }
}

async function addTripShoppingItem(data: { name: string; quantity?: string | null; linked_item_id?: string | null; price?: number | null }) {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const created = await api.shopping.create({
    household_id: app.state.householdId,
    name: data.name,
    quantity: data.quantity || null,
    linked_item_id: data.linked_item_id || null,
    price: data.price || null,
  });
  app.state.shopping.push(created.item);
  if (trip && !trip.ids.includes(created.item.id)) trip.ids.push(created.item.id);
  renderTripScreen();
  return created.item;
}

export function openTripManualAdd() {
  const app = (window as any).app as App;
  app.showSheet('sheetTripManualAdd', 'Zusatzkauf hinzufügen', `
    <div class="form-group"><label>Artikel</label><input type="text" id="tripAddName" placeholder="z. B. Butter"></div>
    <div class="form-group"><label>Menge (optional)</label><input type="text" id="tripAddQty" placeholder="z. B. 2 Packungen"></div>
    <button class="btn" onclick="saveTripManualAdd()"><i class="ph-bold ph-plus"></i> Zur Tour hinzufügen</button>
  `);
}

export async function saveTripManualAdd() {
  const app = (window as any).app as App;
  const name = (document.getElementById('tripAddName') as HTMLInputElement)?.value.trim();
  const quantity = (document.getElementById('tripAddQty') as HTMLInputElement)?.value.trim() || null;
  if (!name) return app.toast('Name erforderlich');
  try {
    const item = await addTripShoppingItem({ name, quantity });
    app.closeSheet('sheetTripManualAdd');
    app.toast('Zur Tour hinzugefügt');
    openTripQuickLog(item.id);
  } catch (e) {
    app.toast('Fehler beim Hinzufügen');
  }
}

export async function scanTripExtra() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const handle = (window as any).openBarcodeScanner();
  const code = await handle.result;
  if (!code) return;

  try {
    const pantryItem = app.state.items.find(i => Array.isArray(i.barcodes) && i.barcodes.some((b: any) => b.code === code));
    let itemName = pantryItem?.name || '';
    let linkedId = pantryItem?.id || null;

    if (!itemName) {
      app.toast('Suche Produkt...');
      const product = await api.products.lookup(code);
      itemName = product.found && product.name ? product.name : `Barcode ${code}`;
    }

    const existingOpen = app.state.shopping.find(s => s.status === 'open' && (s.linked_item_id === linkedId || s.name.trim().toLowerCase() === itemName.trim().toLowerCase()));
    const item = existingOpen || await addTripShoppingItem({ name: itemName, quantity: '1 Stk', linked_item_id: linkedId });
    if (trip && !trip.ids.includes(item.id)) trip.ids.push(item.id);
    renderTripScreen();
    app.toast('Zur Tour hinzugefügt');
    openTripQuickLog(item.id);
  } catch (e) {
    app.toast('Fehler beim Scannen');
  }
}

export async function logTripAsExpense() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  if (!trip) return;
  const finalRaw = (document.getElementById('tripFinalTotal') as HTMLInputElement)?.value;
  const finalTotal = finalRaw ? parseFloat(finalRaw.replace(',', '.')) : trip.totalSpent;
  if (!Number.isFinite(finalTotal) || finalTotal <= 0) {
    app.toast('Kein Betrag zum Verbuchen');
    return;
  }
  try {
    const members = app.state.members;
    const share = finalTotal / Math.max(1, members.length);
    await api.expenses.create({
      household_id: app.state.householdId,
      title: 'Einkaufstour',
      amount: finalTotal,
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


if (typeof window !== 'undefined') {
  window.addEventListener('peerson:realtime-presence', refreshShoppingTripRealtime);
  window.addEventListener('peerson:data-updated', refreshShoppingTripRealtime);
}

Object.assign(window as any, {
  openShoppingTrip,
  closeShoppingTrip,
  finishShoppingTrip,
  continueShoppingTrip,
  openTripQuickLog,
  adjustTripQty,
  confirmTripQuickLog,
  openTripManualAdd,
  saveTripManualAdd,
  scanTripExtra,
  logTripAsExpense,
});
