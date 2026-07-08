import type { App } from '../app';
import type { ShoppingItem } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';
import { t } from '../i18n';

const AISLE_META: Record<string, { label: string; icon: string; order: number }> = {
  obst: { label: 'Obst & Gemüse', icon: 'apple-logo', order: 1 },
  gemuese: { label: 'Obst & Gemüse', icon: 'carrot', order: 1 },
  milch: { label: 'Kühlregal & Milch', icon: 'drop', order: 2 },
  proteine: { label: 'Fleisch & Proteine', icon: 'egg', order: 3 },
  getreide: { label: 'Getreide & Beilagen', icon: 'bread', order: 4 },
  getraenke: { label: 'Getränke', icon: 'bottle', order: 5 },
  fette: { label: 'Öle & Fette', icon: 'drop-half-bottom', order: 6 },
  fertig: { label: 'Konserven & Fertigwaren', icon: 'can', order: 7 },
  sonstiges: { label: 'Sonstiges & Haushalt', icon: 'package', order: 8 },
};

function getItemAisle(item: { linked_item_id?: string; name: string }, app: App) {
  const pantryItem = app.state.items.find(i =>
    i.id === item.linked_item_id || i.name.trim().toLowerCase() === item.name.trim().toLowerCase()
  );
  const cat = pantryItem?.category || 'sonstiges';
  const meta = AISLE_META[cat] || AISLE_META.sonstiges;
  return { ...meta, label: t(`shopping.aisle.${cat}`) };
}

export type ShoppingAisleEntry = { type: 'real' | 'suggested'; data: any };
export interface ShoppingAisleGroup { label: string; icon: string; order: number; items: ShoppingAisleEntry[] }

export function lowStockShoppingSuggestions(app: App) {
  const s = app.state;
  const lowStockItems = s.items.filter(i => {
    const total = s.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0);
    return total < i.threshold;
  });
  const key = `peerson_dismissed_sug_${s.householdId}`;
  let dismissed: string[] = [];
  try { dismissed = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  return lowStockItems
    .filter(i => !s.shopping.some(sh => sh.linked_item_id === i.id && sh.status === 'open') && !dismissed.includes(i.id))
    .map(i => ({
      ...i,
      needed: i.threshold - s.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0),
    }));
}

export function shoppingAisleGroups(app: App, openItems = app.state.shopping.filter(x => x.status === 'open')): ShoppingAisleGroup[] {
  const groupedOpen = new Map<string, ShoppingAisleGroup>();

  openItems.forEach(item => {
    const aisle = getItemAisle(item, app);
    if (!groupedOpen.has(aisle.label)) groupedOpen.set(aisle.label, { ...aisle, items: [] });
    groupedOpen.get(aisle.label)!.items.push({ type: 'real', data: item });
  });

  lowStockShoppingSuggestions(app).forEach(i => {
    const aisleMeta = AISLE_META[i.category] || AISLE_META.sonstiges;
    const aisle = { ...aisleMeta, label: t(`shopping.aisle.${i.category}`) };
    if (!groupedOpen.has(aisle.label)) groupedOpen.set(aisle.label, { ...aisle, items: [] });
    groupedOpen.get(aisle.label)!.items.push({ type: 'suggested', data: i });
  });

  return Array.from(groupedOpen.values()).sort((a, b) => a.order - b.order);
}

export function renderShoppingAisleHeading(aisle: Pick<ShoppingAisleGroup, 'label' | 'icon'>) {
  return `
    <div style="margin-top: 12px; margin-bottom: 6px; font-weight: 700; font-size: 0.85rem; color: var(--text-soft); display: flex; align-items: center; gap: 6px;">
      <i class="ph ph-${aisle.icon}"></i> <span>${aisle.label}</span>
    </div>`;
}

export function renderShoppingSuggestionRow(i: any, mode: 'list' | 'trip' = 'list') {
  const itemId = escapeJsAttr(i.id);
  const itemName = escapeHtml(i.name);
  const itemNameJs = escapeJsAttr(i.name);
  const primaryAction = mode === 'trip'
    ? `addSuggestedToTripAndLog('${itemId}', ${i.needed}, '${itemNameJs}')`
    : `autoAddAndToggleShopping('${itemId}', ${i.needed}, '${itemNameJs}')`;
  return `
    <div class="card warning" style="margin-bottom: 8px;">
      <div class="card-content" style="align-items: center;">
        <button class="shopping-check" onclick="${primaryAction}"></button>
        <div class="card-text" style="margin-left: 8px;">
          <div class="card-header">
            <div class="item-name">${itemName}</div>
            <span class="badge" style="font-size:0.7rem; background:var(--warning); color:#fff;"><i class="ph ph-warning"></i> ${t('shopping.suggestion')}</span>
          </div>
          <div class="card-meta">${t('shopping.lowStockSuggestion', { count: i.needed })}</div>
        </div>
      </div>
      ${mode === 'list' ? `<div class="card-actions" style="width: auto; flex-direction: row; border-left: 1px solid var(--border);">
        <button class="action-btn" onclick="autoAddAndOpenBought('${itemId}', ${i.needed}, '${itemNameJs}')" title="${t('shopping.boughtLog')}" style="width: 44px; border-right: 1px solid var(--border);"><i class="ph ph-bag"></i></button>
        <button class="action-btn remove" onclick="dismissSuggestion('${itemId}')" title="${t('shopping.dismissSuggestion')}" style="width: 44px;"><i class="ph ph-trash"></i></button>
      </div>` : ''}
    </div>`;
}

export function renderShoppingRealRow(item: ShoppingItem, mode: 'list' | 'trip' = 'list') {
  const shopId = escapeJsAttr(item.id);
  const linkedId = escapeJsAttr(item.linked_item_id || '');
  const itemName = escapeHtml(item.name);
  const quantity = escapeHtml(item.quantity || '');
  const checked = item.status === 'bought';
  if (mode === 'trip') {
    return `
      <div class="trip-item-card ${checked ? 'checked' : ''}" onclick="${checked ? `untickTripItem('${shopId}')` : `openTripQuickLog('${shopId}')`}">
        <div class="check-circle">${checked ? '<i class="ph-bold ph-check"></i>' : ''}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:14.5px;">${itemName}</div>
          ${quantity ? `<div style="font-size:12px; color:var(--text-soft);">${quantity}</div>` : ''}
        </div>
      </div>`;
  }
  return `
    <div class="card" style="margin-bottom: 8px;">
      <div class="card-content" style="align-items: center;">
        <button class="shopping-check" onclick="toggleShopping('${shopId}')"></button>
        <div class="card-text" style="margin-left: 8px;">
          <div class="card-header"><div class="item-name">${itemName}</div></div>
          <div class="card-meta">
            ${quantity}
            ${item.price ? ` · <span style="color:var(--success); font-weight:700;">${item.price.toFixed(2)} €</span>` : ''}
          </div>
        </div>
      </div>
      <div class="card-actions" style="width: auto; flex-direction: row; border-left: 1px solid var(--border);">
        <button class="action-btn" onclick="openBoughtDetailsModal('${shopId}', '${linkedId}')" title="${t('shopping.boughtLog')}" style="width: 44px; border-right: 1px solid var(--border);"><i class="ph ph-bag"></i></button>
        <button class="action-btn remove" onclick="deleteShopping('${shopId}')" title="${t('shopping.delete')}" style="width: 44px;"><i class="ph ph-trash"></i></button>
      </div>
    </div>`;
}

export function renderShoppingAisleEntry(entry: ShoppingAisleEntry, mode: 'list' | 'trip' = 'list') {
  return entry.type === 'suggested'
    ? renderShoppingSuggestionRow(entry.data, mode)
    : renderShoppingRealRow(entry.data as ShoppingItem, mode);
}

export function renderShoppingAisleGroups(groups: ShoppingAisleGroup[], mode: 'list' | 'trip' = 'list') {
  return groups.map(aisle => `${renderShoppingAisleHeading(aisle)}${aisle.items.map(entry => renderShoppingAisleEntry(entry, mode)).join('')}`).join('');
}

export function renderShoppingView(app: App) {
  const open = app.state.shopping.filter(x => x.status === 'open');
  const bought = app.state.shopping.filter(x => x.status === 'bought');
  const sortedAisles = shoppingAisleGroups(app, open);
  const openCount = sortedAisles.reduce((sum, aisle) => sum + aisle.items.length, 0);

  return `
    <div class="header">
      <h1><i class="ph ph-shopping-cart-simple"></i> ${t('shopping.title')}</h1>
      <div style="display:flex; gap:8px;">
        <button class="icon-btn" onclick="scanForShopping()" title="${t('shopping.scanBarcode')}"><i class="ph ph-barcode"></i></button>
        <button class="icon-btn" onclick="openAddShoppingModal()" title="${t('shopping.addManual')}"><i class="ph ph-plus"></i></button>
      </div>
    </div>

    ${renderShoppingPresenceBand(app)}

    <div class="section">
      <div class="section-header">
        <div class="section-title">${t('shopping.openByAisle')}</div>
        <span class="badge">${openCount}</span>
      </div>
      ${sortedAisles.length ? renderShoppingAisleGroups(sortedAisles, 'list') : `<div class="empty-state">${t('shopping.empty')}</div>`}
    </div>

    ${bought.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">${t('shopping.done')}</div></div>
      ${bought.map(item => {
        const shopId = escapeJsAttr(item.id);
        const itemName = escapeHtml(item.name);
        return `
        <div class="card" style="opacity: 0.7;">
          <div class="card-content" style="align-items: center;">
            <button class="shopping-check checked" onclick="toggleShopping('${shopId}')" aria-label="${t('shopping.reopen', { name: itemName })}"><i class="ph-bold ph-check"></i></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name" style="text-decoration: line-through;">${itemName}</div></div>
              ${item.price ? `<div class="card-meta" style="color:var(--success); font-weight:700;">${item.price.toFixed(2)} €</div>` : ''}
            </div>
          </div>
          <div class="card-actions">
            <button class="action-btn remove" onclick="deleteShopping('${shopId}')" aria-label="${t('shopping.deleteItem', { name: itemName })}"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `}).join('')}
    </div>` : ''}
  `;
}

function renderShoppingPresenceBand(app: App) {
  const shoppers = (app.realtimePresence || []).filter(u => u.shopping);
  if (!shoppers.length) return '';
  const names = shoppers.map(u => escapeHtml(u.name || 'Someone')).join(', ');
  const text = shoppers.length === 1
    ? t('presence.shoppingAlsoOne', { name: names })
    : t('presence.shoppingAlsoMany', { names });
  return `<div class="status-card" style="margin-bottom:16px;"><i class="ph ph-shopping-cart-simple"></i> ${text}</div>`;
}

export async function openAddShoppingModal(prefillName?: string | null) {
  const app = (window as any).app;
  app.showModal('shopModal', `
    <div class="modal-header"><div class="modal-title">${t('shopping.addToListTitle')}</div><button class="close-btn" onclick="window.app.closeModal('shopModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>${t('shopping.item')}</label><input type="text" id="shopName" placeholder="${t('shopping.needPlaceholder')}" value="${prefillName ? escapeAttr(prefillName) : ''}"></div>
      <div class="form-group"><label>${t('shopping.quantityOptional')}</label><input type="text" id="shopQty" placeholder="${t('shopping.qtyPlaceholder')}"></div>
      <div class="form-group"><label>${t('shopping.priceOptional')}</label><input type="number" id="shopPrice" step="0.01" min="0" placeholder="${t('shopping.pricePlaceholder')}"></div>
      <button class="btn" onclick="saveShoppingItem()"><i class="ph-bold ph-check"></i> ${t('shopping.add')}</button>
    </div>
  `);
}

export async function scanForShopping() {
  const app = (window as any).app;
  const api = (window as any).api;
  const handle = (window as any).openBarcodeScanner();
  const code = await handle.result;
  if (!code) return;

  const pantryItem = app.state.items.find((i: any) =>
    Array.isArray(i.barcodes) && i.barcodes.some((b: any) => b.code === code)
  );
  if (pantryItem) {
    // Found in inventory! Open bought popup immediately (Issue #22)
    const openShopItem = app.state.shopping.find((s: any) => s.status === 'open' && (s.linked_item_id === pantryItem.id || s.name.trim().toLowerCase() === pantryItem.name.trim().toLowerCase()));
    openBoughtDetailsModal(openShopItem ? openShopItem.id : null, pantryItem.id, pantryItem.name);
    return;
  }

  app.toast('Suche Produkt...');
  try {
    const product = await api.products.lookup(code);
    openAddShoppingModal(product.found ? product.name : null);
    if (!product.found) app.toast('Produkt nicht gefunden — bitte Namen eingeben');
  } catch (e) {
    openAddShoppingModal(null);
  }
}

export async function saveShoppingItem() {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const name = (document.getElementById('shopName') as HTMLInputElement)?.value.trim();
    if (!name) return app.toast('Name erforderlich');
    const priceVal = (document.getElementById('shopPrice') as HTMLInputElement)?.value;
    const price = priceVal ? parseFloat(priceVal) || null : null;
    const item = await api.shopping.create({
      household_id: app.state.householdId,
      name,
      quantity: (document.getElementById('shopQty') as HTMLInputElement)?.value || null,
      price
    });
    app.state.shopping.push(item.item);
    app.closeModal('shopModal');
    app.render();
    app.toast('Hinzugefügt');
  } catch (e) {
    app.toast('Fehler beim Hinzufügen');
  }
}

export async function autoAddShopping(itemId: string, needed: number) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const item = app.state.items.find((i: any) => i.id === itemId);
    if (!item) return;
    const latestBatch = app.state.batches.filter((b: any) => b.item_id === itemId && typeof b.price === 'number' && b.price > 0).sort((a: any, b: any) => b.date_added - a.date_added)[0];
    const shop = await api.shopping.create({
      household_id: app.state.householdId,
      name: item.name,
      quantity: needed + ' Stk',
      linked_item_id: itemId,
      price: latestBatch ? latestBatch.price : null
    });
    app.state.shopping.push(shop.item);
    app.render();
    app.toast('Zur Einkaufsliste hinzugefügt');
  } catch (e) {
    app.toast('Fehler beim Hinzufügen');
  }
}

export async function toggleShopping(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const item = app.state.shopping.find((s: any) => s.id === id);
    if (!item) return;
    const newStatus = item.status === 'open' ? 'bought' : 'open';
    await api.shopping.update(id, { status: newStatus });
    item.status = newStatus;
    app.render();
  } catch (e) {
    app.toast('Fehler beim Aktualisieren');
  }
}

export async function deleteShopping(id: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  const item = app.state.shopping.find((s: any) => s.id === id);
  if (!item) return;
  app.scheduleSoftDelete('shopping', item, app.state.shopping, '"' + item.name + '"', async () => {
    await api.shopping.delete(id);
  });
}

export async function openBoughtDetailsModal(shopItemId: string | null, linkedItemId?: string | null, customName?: string) {
  const app = (window as any).app;
  let name = customName || 'Artikel';
  let priceVal = '';
  let linkedId = linkedItemId || null;

  if (shopItemId) {
    const sItem = app.state.shopping.find((s: any) => s.id === shopItemId);
    if (sItem) {
      name = sItem.name;
      if (sItem.price) priceVal = String(sItem.price);
      if (sItem.linked_item_id) linkedId = sItem.linked_item_id;
    }
  }

  if (!linkedId) {
    const pItem = app.state.items.find((i: any) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (pItem) linkedId = pItem.id;
  }

  app.showModal('boughtDetailsModal', `
    <div class="modal-header"><div class="modal-title"><i class="ph ph-bag"></i> Im Laden gekauft</div><button class="close-btn" onclick="window.app.closeModal('boughtDetailsModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div style="font-weight:700; font-size:1.1rem; margin-bottom:12px;">${escapeHtml(name)}</div>
      <div class="form-group"><label>Gekaufte Menge</label><input type="number" id="boughtQty" value="1" min="1"></div>
      <div class="form-group"><label>Preis gezahlt (€)</label><input type="number" id="boughtPrice" step="0.01" min="0" value="${priceVal}" placeholder="z. B. 1.99"></div>
      <div class="form-group"><label>MHD (optional)</label><input type="date" id="boughtExpiry"></div>
      <button class="btn" onclick="saveBoughtDetails('${shopItemId || ''}', '${linkedId || ''}')"><i class="ph-bold ph-check"></i> In Vorrat übernehmen & abhaken</button>
    </div>
  `);
}

export async function saveBoughtDetails(shopItemId: string, linkedItemId: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const qty = parseInt((document.getElementById('boughtQty') as HTMLInputElement)?.value) || 1;
    const priceVal = (document.getElementById('boughtPrice') as HTMLInputElement)?.value;
    const price = priceVal ? parseFloat(priceVal) || null : null;
    const expiry = (document.getElementById('boughtExpiry') as HTMLInputElement)?.value || null;

    if (shopItemId) {
      await api.shopping.update(shopItemId, { status: 'bought', price });
      const sItem = app.state.shopping.find((s: any) => s.id === shopItemId);
      if (sItem) { sItem.status = 'bought'; sItem.price = price; }
    }

    if (linkedItemId) {
      const pItem = app.state.items.find((i: any) => i.id === linkedItemId);
      const barcodeCode = (pItem && Array.isArray(pItem.barcodes) && pItem.barcodes.length > 0) ? pItem.barcodes[0].code : null;
      const batch = await api.batches.create({
        item_id: linkedItemId,
        quantity: qty,
        price,
        expiry,
        barcode_code: barcodeCode,
        grams_per_unit: 0
      });
      app.state.batches.push(batch.batch);
    }

    app.closeModal('boughtDetailsModal');
    app.render();
    app.toast('Erfolgreich verbucht & in Vorrat übertragen!');
  } catch (e) {
    app.toast('Fehler beim Verbuchen');
  }
}

// Attach to window so HTML onclick attributes work without inline script blocks!
Object.assign(window as any, {
  openAddShoppingModal,
  scanForShopping,
  saveShoppingItem,
  autoAddShopping,
  toggleShopping,
  deleteShopping,
  openBoughtDetailsModal,
  saveBoughtDetails,
  autoAddAndToggleShopping,
  autoAddAndOpenBought,
  dismissSuggestion
});

export async function autoAddAndToggleShopping(itemId: string, needed: number, customName: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const item = app.state.items.find((i: any) => i.id === itemId);
    if (!item) return;
    const latestBatch = app.state.batches.filter((b: any) => b.item_id === itemId && typeof b.price === 'number' && b.price > 0).sort((a: any, b: any) => b.date_added - a.date_added)[0];
    const shop = await api.shopping.create({
      household_id: app.state.householdId,
      name: item.name,
      quantity: needed + ' Stk',
      linked_item_id: itemId,
      price: latestBatch ? latestBatch.price : null,
      status: 'bought'
    });
    app.state.shopping.push(shop.item);
    app.render();
    app.toast('Von Liste abgehakt');
  } catch (e) { app.toast('Fehler'); }
}

export async function autoAddAndOpenBought(itemId: string, needed: number, customName: string) {
  const app = (window as any).app;
  const api = (window as any).api;
  try {
    const item = app.state.items.find((i: any) => i.id === itemId);
    if (!item) return;
    const latestBatch = app.state.batches.filter((b: any) => b.item_id === itemId && typeof b.price === 'number' && b.price > 0).sort((a: any, b: any) => b.date_added - a.date_added)[0];
    const shop = await api.shopping.create({
      household_id: app.state.householdId,
      name: item.name,
      quantity: needed + ' Stk',
      linked_item_id: itemId,
      price: latestBatch ? latestBatch.price : null
    });
    app.state.shopping.push(shop.item);
    openBoughtDetailsModal(shop.item.id, itemId, item.name);
  } catch (e) { app.toast('Fehler'); }
}

export function dismissSuggestion(itemId: string) {
  const app = (window as any).app;
  const key = `peerson_dismissed_sug_${app.state.householdId}`;
  let dismissed: string[] = [];
  try { dismissed = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  if (!dismissed.includes(itemId)) dismissed.push(itemId);
  localStorage.setItem(key, JSON.stringify(dismissed));
  app.render();
  app.toast('Vorschlag ausgeblendet');
}
