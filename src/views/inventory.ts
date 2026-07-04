import type { App } from '../app';
import type { Item, Batch } from '../types';

const CATEGORY_META: Record<string, { icon: string; label: string }> = {
  sonstiges: { icon: 'package', label: 'Sonstiges' },
  getraenke: { icon: 'bottle', label: 'Getränke' },
  getreide: { icon: 'bread', label: 'Getreide' },
  gemuese: { icon: 'carrot', label: 'Gemüse' },
  obst: { icon: 'apple-logo', label: 'Obst' },
  milch: { icon: 'drop', label: 'Milch' },
  proteine: { icon: 'egg', label: 'Proteine' },
  fette: { icon: 'drop-half-bottom', label: 'Fette' },
  fertig: { icon: 'can', label: 'Fertig' },
};

function getItemIcon(item: Item) {
  return item.icon || CATEGORY_META[item.category]?.icon || 'package';
}

function getTotal(itemId: string, batches: Batch[]) {
  return batches.filter(b => b.item_id === itemId).reduce((a, b) => a + b.quantity, 0);
}

function formatDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function getDays(d?: string) {
  if (!d) return 999;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

export function renderInventoryView(app: App) {
  const s = app.state;
  const lowStock = s.items.filter(i => getTotal(i.id, s.batches) < i.threshold);
  const expiring = s.batches
    .filter(b => b.expiry && getDays(b.expiry) <= 30)
    .map(b => ({ ...b, item: s.items.find(i => i.id === b.item_id), days: getDays(b.expiry) }))
    .filter(x => x.item)
    .sort((a, b) => a.days - b.days);

  return `
    <div class="header">
      <h1><i class="ph ph-package"></i> Vorrat</h1>
      <button class="icon-btn" onclick="openAddItemModal()"><i class="ph ph-plus"></i></button>
    </div>

    ${expiring.length ? `
    <div class="section">
      <div class="section-header">
        <div class="section-title"><i class="ph ph-clock"></i> Check MHD</div>
        <span class="badge">${expiring.length}</span>
      </div>
      ${expiring.map(b => `
        <div class="card ${b.days < 0 ? 'danger' : b.days < 14 ? 'warning' : ''}">
          <div class="card-content" onclick="openItemDetail('${b.item!.id}')">
            <div class="card-icon"><i class="ph ph-${getItemIcon(b.item!)}"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${b.item!.name}</div><div class="item-qty">${b.quantity}</div></div>
              <div class="card-meta">${b.days < 0 ? 'Abgelaufen' : b.days + ' Tage'} · ${formatDate(b.expiry)}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="section">
      <div class="section-header">
        <div class="section-title"><i class="ph ph-shopping-cart-simple"></i> Nachkaufen</div>
        <span class="badge" style="${lowStock.length ? '' : 'display:none'}">${lowStock.length}</span>
      </div>
      ${lowStock.length ? lowStock.map(i => {
        const needed = i.threshold - getTotal(i.id, s.batches);
        return `
        <div class="card danger">
          <div class="card-content" onclick="openAddStock('${i.id}')">
            <div class="card-icon"><i class="ph ph-${getItemIcon(i)}"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${i.name}</div><div class="item-qty">+${needed}</div></div>
              <div class="card-meta">${getTotal(i.id, s.batches)} vorrätig · Min. ${i.threshold}</div>
            </div>
          </div>
        </div>`;
      }).join('') : `<div class="empty-state">Alles ausreichend vorhanden</div>`}
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title"><i class="ph ph-list"></i> Alle Artikel</div>
      </div>
      <div class="form-group">
        <input type="text" id="invSearch" placeholder="Artikel suchen..." onkeyup="filterInventory()">
      </div>
      <div id="inventoryList">
        ${renderInventoryList(app, '')}
      </div>
    </div>

    <div id="modals"></div>
    <script>
      function filterInventory() {
        const term = document.getElementById('invSearch').value.toLowerCase();
        document.getElementById('inventoryList').innerHTML = window.renderInventoryList(window.app, term);
      }
      async function openAddItemModal() {
        const categories = ${JSON.stringify(Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: v.label })))};
        window.app.showModal('itemModal',
          '<div class="modal-header"><div class="modal-title">Neuer Artikel</div><button class="close-btn" onclick="window.app.closeModal(\'itemModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Name</label><input type="text" id="newItemName" placeholder="z. B. Hafermilch"></div>' +
            '<div class="form-group"><label>Kategorie</label><select id="newItemCategory">' + categories.map(c => '<option value="' + c.value + '">' + c.label + '</option>').join('') + '</select></div>' +
            '<div class="form-group"><label>Mindestmenge</label><input type="number" id="newItemThreshold" value="2" min="0"></div>' +
            '<div class="form-group"><label>Barcode</label><input type="text" id="newItemBarcode" placeholder="Optional"></div>' +
            '<button class="btn" onclick="saveNewItem()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function saveNewItem() {
        try {
          const name = document.getElementById('newItemName').value.trim();
          if (!name) return window.app.toast('Name erforderlich');
          const item = await window.api.items.create({
            household_id: window.app.state.householdId,
            name,
            category: document.getElementById('newItemCategory').value,
            threshold: parseInt(document.getElementById('newItemThreshold').value) || 0,
            barcodes: document.getElementById('newItemBarcode').value ? [{ code: document.getElementById('newItemBarcode').value, grams: 0 }] : []
          });
          window.app.state.items.push(item.item);
          window.app.closeModal('itemModal');
          window.app.render();
          window.app.toast('Artikel erstellt');
        } catch (e) {
          window.app.toast('Fehler: ' + (e.message || 'Unbekannter Fehler'));
        }
      }
      async function openItemDetail(id) {
        try {
          const item = window.app.state.items.find(i => i.id === id);
          if (!item) return;
          const batches = window.app.state.batches.filter(b => b.item_id === id).sort((a, b) => (a.expiry || '').localeCompare(b.expiry || ''));
          const catOptions = ${JSON.stringify(Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: v.label })))};
          window.app.showModal('itemModal',
            '<div class="modal-header"><div class="modal-title">' + item.name + '</div><button class="close-btn" onclick="window.app.closeModal(\'itemModal\')"><i class="ph ph-x"></i></button></div>' +
            '<div class="modal-body">' +
              '<div class="form-group"><label>Kategorie</label><select id="editCategory">' + catOptions.map(c => '<option value="' + c.value + '"' + (c.value === item.category ? ' selected' : '') + '>' + c.label + '</option>').join('') + '</select></div>' +
              '<div class="form-group"><label>Mindestmenge</label><input type="number" id="editThreshold" value="' + item.threshold + '"></div>' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><label style="margin:0">Chargen</label><button class="btn btn-small" onclick="openAddStock(\'' + item.id + '\')">+ Bestand</button></div>' +
              '<div class="detail-batch-list" style="margin-bottom:16px;">' +
                (batches.length ? batches.map(b =>
                  '<div class="detail-batch-item" style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border);">' +
                    '<span style="font-weight:700; width:32px; text-align:center;">' + b.quantity + '</span>' +
                    '<span style="flex:1; font-size:13px;">' + (b.expiry ? new Date(b.expiry).toLocaleDateString('de-DE') : 'Kein MHD') + '</span>' +
                    '<button class="batch-del-btn" onclick="removeBatch(\'' + b.id + '\')"><i class="ph ph-minus"></i></button>' +
                  '</div>'
                ).join('') : '<div class="empty-state" style="padding:16px;">Keine Chargen</div>') +
              '</div>' +
              '<button class="btn" onclick="saveItemDetail(\'' + item.id + '\')"><i class="ph-bold ph-floppy-disk"></i> Speichern</button>' +
              '<button class="btn btn-secondary" onclick="deleteItem(\'' + item.id + '\')" style="margin-top:8px;"><i class="ph-bold ph-trash"></i> Löschen</button>' +
            '</div>'
          );
        } catch (e) {
          window.app.toast('Fehler beim Öffnen');
        }
      }
      async function saveItemDetail(id) {
        try {
          const threshold = parseInt(document.getElementById('editThreshold').value) || 0;
          const category = document.getElementById('editCategory').value;
          await window.api.items.update(id, { threshold, category });
          const item = window.app.state.items.find(i => i.id === id);
          if (item) { item.threshold = threshold; item.category = category; }
          window.app.closeModal('itemModal');
          window.app.render();
          window.app.toast('Gespeichert');
        } catch (e) {
          window.app.toast('Fehler beim Speichern');
        }
      }
      async function deleteItem(id) {
        if (!confirm('Wirklich löschen?')) return;
        try {
          await window.api.items.delete(id);
          window.app.state.items = window.app.state.items.filter(i => i.id !== id);
          window.app.state.batches = window.app.state.batches.filter(b => b.item_id !== id);
          window.app.closeModal('itemModal');
          window.app.render();
          window.app.toast('Gelöscht');
        } catch (e) {
          window.app.toast('Fehler beim Löschen');
        }
      }
      async function openAddStock(itemId) {
        window.app.showModal('stockModal',
          '<div class="modal-header"><div class="modal-title">Bestand hinzufügen</div><button class="close-btn" onclick="window.app.closeModal(\'stockModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Menge</label><input type="number" id="addQty" value="1" min="1"></div>' +
            '<div class="form-group"><label>MHD (optional)</label><input type="date" id="addExpiry"></div>' +
            '<button class="btn" onclick="commitAddStock(\'' + itemId + '\')"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function commitAddStock(itemId) {
        try {
          const qty = parseInt(document.getElementById('addQty').value) || 0;
          const expiry = document.getElementById('addExpiry').value;
          if (qty <= 0) return;
          const batch = await window.api.batches.create({ item_id: itemId, quantity: qty, expiry: expiry || null });
          window.app.state.batches.push(batch.batch);
          window.app.closeModal('stockModal');
          window.app.render();
          window.app.toast('Hinzugefügt');
        } catch (e) {
          window.app.toast('Fehler beim Hinzufügen');
        }
      }
      async function removeBatch(batchId) {
        try {
          const b = window.app.state.batches.find(x => x.id === batchId);
          if (!b) return;
          if (b.quantity > 1) {
            await window.api.batches.update(batchId, { quantity: b.quantity - 1 });
            b.quantity -= 1;
          } else {
            await window.api.batches.delete(batchId);
            window.app.state.batches = window.app.state.batches.filter(x => x.id !== batchId);
          }
          window.app.render();
          window.app.toast('Entnommen');
        } catch (e) {
          window.app.toast('Fehler beim Entnehmen');
        }
      }
      async function removeOne(itemId) {
        const batches = window.app.state.batches.filter(b => b.item_id === itemId).sort((a, b) => (a.expiry || '').localeCompare(b.expiry || ''));
        if (!batches.length) return window.app.toast('Kein Bestand');
        await removeBatch(batches[0].id);
      }
    </script>
  `;
}

function renderInventoryList(app: App, filter: string) {
  const sorted = [...app.state.items]
    .filter(i => !filter || i.name.toLowerCase().includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!sorted.length) return `<div class="empty-state">Keine Artikel</div>`;

  return sorted.map(i => {
    const total = getTotal(i.id, app.state.batches);
    return `
      <div class="card">
        <div class="card-content" onclick="openItemDetail('${i.id}')">
          <div class="card-icon"><i class="ph ph-${getItemIcon(i)}"></i></div>
          <div class="card-text">
            <div class="card-header"><div class="item-name">${i.name}</div><div class="item-qty">${total}</div></div>
            <div class="card-meta">${CATEGORY_META[i.category]?.label || i.category} · Min. ${i.threshold}</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="action-btn add" onclick="openAddStock('${i.id}')"><i class="ph ph-plus"></i></button>
          <button class="action-btn remove" onclick="removeOne('${i.id}')"><i class="ph ph-minus"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

(window as any).renderInventoryList = renderInventoryList;
