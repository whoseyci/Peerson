import type { App } from '../app';
import type { ShoppingItem } from '../types';

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

function getItemAisle(item: ShoppingItem, app: App) {
  const pantryItem = app.state.items.find(i => 
    i.id === item.linked_item_id || i.name.trim().toLowerCase() === item.name.trim().toLowerCase()
  );
  const cat = pantryItem?.category || 'sonstiges';
  return AISLE_META[cat] || AISLE_META.sonstiges;
}

export function renderShoppingView(app: App) {
  const s = app.state;
  const open = s.shopping.filter(x => x.status === 'open');
  const bought = s.shopping.filter(x => x.status === 'bought');

  const lowStockItems = s.items.filter(i => {
    const total = s.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0);
    return total < i.threshold;
  });
  const missingLowStock = lowStockItems.filter(i => !s.shopping.some(sh => sh.linked_item_id === i.id && sh.status === 'open'));

  // Group open items by supermarket aisle
  const groupedOpen = new Map<string, { label: string; icon: string; order: number; items: ShoppingItem[] }>();
  open.forEach(item => {
    const aisle = getItemAisle(item, app);
    if (!groupedOpen.has(aisle.label)) {
      groupedOpen.set(aisle.label, { ...aisle, items: [] });
    }
    groupedOpen.get(aisle.label)!.items.push(item);
  });
  const sortedAisles = Array.from(groupedOpen.values()).sort((a, b) => a.order - b.order);

  return `
    <div class="header">
      <h1><i class="ph ph-shopping-cart"></i> Einkaufen</h1>
      <div style="display:flex; gap:8px;">
        <button class="icon-btn" onclick="scanForShopping()" title="Barcode scannen"><i class="ph ph-barcode"></i></button>
        <button class="icon-btn" onclick="openAddShoppingModal()" title="Manuell hinzufügen"><i class="ph ph-plus"></i></button>
      </div>
    </div>

    ${missingLowStock.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title"><i class="ph ph-warning"></i> Automatisch vorgeschlagen</div></div>
      ${missingLowStock.map(i => {
        const needed = i.threshold - s.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0);
        return `
        <div class="card warning">
          <div class="card-content" onclick="autoAddShopping('${i.id}', ${needed})">
            <div class="card-icon"><i class="ph ph-${i.icon || 'package'}"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${i.name}</div><div class="item-qty">+${needed}</div></div>
              <div class="card-meta">Unter Mindestbestand</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="section">
      <div class="section-header">
        <div class="section-title">Offen (nach Supermarkt-Regal)</div>
        <span class="badge">${open.length}</span>
      </div>
      ${open.length ? sortedAisles.map(aisle => `
        <div style="margin-top: 12px; margin-bottom: 6px; font-weight: 700; font-size: 0.85rem; color: var(--text-soft); display: flex; align-items: center; gap: 6px;">
          <i class="ph ph-${aisle.icon}"></i> <span>${aisle.label}</span>
        </div>
        ${aisle.items.map(item => `
          <div class="card" style="margin-bottom: 8px;">
            <div class="card-content" style="align-items: center;">
              <button class="shopping-check" onclick="toggleShopping('${item.id}')"></button>
              <div class="card-text" style="margin-left: 8px;">
                <div class="card-header"><div class="item-name">${item.name}</div></div>
                ${item.quantity ? `<div class="card-meta">${item.quantity}</div>` : ''}
              </div>
            </div>
            <div class="card-actions">
              <button class="action-btn remove" onclick="deleteShopping('${item.id}')"><i class="ph ph-trash"></i></button>
            </div>
          </div>
        `).join('')}
      `).join('') : `<div class="empty-state">Nichts auf der Liste</div>`}
    </div>

    ${bought.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">Erledigt</div></div>
      ${bought.map(item => `
        <div class="card" style="opacity: 0.7;">
          <div class="card-content" style="align-items: center;">
            <button class="shopping-check checked" onclick="toggleShopping('${item.id}')"><i class="ph-bold ph-check"></i></button>
            <div class="card-text" style="margin-left: 8px;">
              <div class="card-header"><div class="item-name" style="text-decoration: line-through;">${item.name}</div></div>
              ${item.price ? `<div class="card-meta" style="color:var(--success); font-weight:700;">${item.price.toFixed(2)} €</div>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <script>
      async function openAddShoppingModal(prefillName) {
        window.app.showModal('shopModal',
          '<div class="modal-header"><div class="modal-title">Zur Liste hinzufügen</div><button class="close-btn" onclick="window.app.closeModal(\\'shopModal\\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Artikel</label><input type="text" id="shopName" placeholder="Was wird gebraucht?" value="' + (prefillName ? prefillName.replace(/"/g, '&quot;') : '') + '"></div>' +
            '<div class="form-group"><label>Menge (optional)</label><input type="text" id="shopQty" placeholder="z. B. 2 Packungen"></div>' +
            '<div class="form-group"><label>Preis (€, optional)</label><input type="number" id="shopPrice" step="0.01" min="0" placeholder="z. B. 1.99"></div>' +
            '<button class="btn" onclick="saveShoppingItem()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function scanForShopping() {
        const handle = window.openBarcodeScanner();
        const code = await handle.result;
        if (!code) return;

        const pantryItem = window.app.state.items.find(i =>
          Array.isArray(i.barcodes) && i.barcodes.some(b => b.code === code)
        );
        if (pantryItem) {
          const alreadyOpen = window.app.state.shopping.some(s => s.status === 'open' && s.name.trim().toLowerCase() === pantryItem.name.trim().toLowerCase());
          if (alreadyOpen) {
            window.app.toast('"' + pantryItem.name + '" steht schon auf der Liste');
            return;
          }
          openAddShoppingModal(pantryItem.name);
          return;
        }

        window.app.toast('Suche Produkt...');
        try {
          const product = await window.api.products.lookup(code);
          openAddShoppingModal(product.found ? product.name : null);
          if (!product.found) window.app.toast('Produkt nicht gefunden — bitte Namen eingeben');
        } catch (e) {
          openAddShoppingModal(null);
        }
      }
      async function saveShoppingItem() {
        try {
          const name = document.getElementById('shopName').value.trim();
          if (!name) return window.app.toast('Name erforderlich');
          const priceVal = document.getElementById('shopPrice') ? document.getElementById('shopPrice').value : null;
          const price = priceVal ? parseFloat(priceVal) || null : null;
          const item = await window.api.shopping.create({
            household_id: window.app.state.householdId,
            name,
            quantity: document.getElementById('shopQty').value || null,
            price: price
          });
          window.app.state.shopping.push(item.item);
          window.app.closeModal('shopModal');
          window.app.render();
          window.app.toast('Hinzugefügt');
        } catch (e) {
          window.app.toast('Fehler beim Hinzufügen');
        }
      }
      async function autoAddShopping(itemId, needed) {
        try {
          const item = window.app.state.items.find(i => i.id === itemId);
          if (!item) return;
          const latestBatch = window.app.state.batches.filter(b => b.item_id === itemId && typeof b.price === 'number' && b.price > 0).sort((a,b) => b.date_added - a.date_added)[0];
          const shop = await window.api.shopping.create({
            household_id: window.app.state.householdId,
            name: item.name,
            quantity: needed + ' Stk',
            linked_item_id: itemId,
            price: latestBatch ? latestBatch.price : null
          });
          window.app.state.shopping.push(shop.item);
          window.app.render();
          window.app.toast('Zur Einkaufsliste hinzugefügt');
        } catch (e) {
          window.app.toast('Fehler beim Hinzufügen');
        }
      }
      async function toggleShopping(id) {
        try {
          const item = window.app.state.shopping.find(s => s.id === id);
          if (!item) return;
          const newStatus = item.status === 'open' ? 'bought' : 'open';
          await window.api.shopping.update(id, { status: newStatus });
          item.status = newStatus;
          window.app.render();
        } catch (e) {
          window.app.toast('Fehler beim Aktualisieren');
        }
      }
      async function deleteShopping(id) {
        const item = window.app.state.shopping.find(s => s.id === id);
        if (!item) return;
        window.app.scheduleSoftDelete('shopping', item, window.app.state.shopping, '"' + item.name + '"', async () => {
          await window.api.shopping.delete(id);
        });
      }
      async function openUpdateShopPrice(id, name, currentPrice) {
        window.app.showModal('shopPriceModal',
          '<div class="modal-header"><div class="modal-title">Preis für "' + name + '"</div><button class="close-btn" onclick="window.app.closeModal(\'shopPriceModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Preis (€)</label><input type="number" id="quickShopPrice" step="0.01" min="0" value="' + (currentPrice || '') + '" placeholder="z. B. 1.99"></div>' +
            '<button class="btn" onclick="saveShopPrice(\'' + id + '\')"><i class="ph-bold ph-check"></i> Speichern</button>' +
          '</div>'
        );
      }
      async function saveShopPrice(id) {
        try {
          const val = document.getElementById('quickShopPrice').value;
          const price = val ? parseFloat(val) || null : null;
          await window.api.shopping.update(id, { price });
          const item = window.app.state.shopping.find(s => s.id === id);
          if (item) item.price = price;
          window.app.closeModal('shopPriceModal');
          window.app.render();
          window.app.toast('Preis aktualisiert');
        } catch (e) {
          window.app.toast('Fehler beim Aktualisieren');
        }
      }
    </script>
  `;
}
