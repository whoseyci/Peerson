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
      <div style="display:flex; gap:8px;">
        <button class="icon-btn" onclick="startScanFlow()" title="Barcode scannen"><i class="ph ph-barcode"></i></button>
        <button class="icon-btn" onclick="openAddItemModal()" title="Manuell hinzufügen"><i class="ph ph-plus"></i></button>
      </div>
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
      async function openAddItemModal(prefill) {
        prefill = prefill || {};
        const categories = ${JSON.stringify(Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: v.label })))};
        const preview = prefill.imageUrl || prefill.quantity ? (
          '<div class="product-preview">' +
            (prefill.imageUrl
              ? '<img src="' + prefill.imageUrl + '" alt="">'
              : '<div class="product-preview-icon"><i class="ph ph-package"></i></div>') +
            '<div class="product-preview-text">' +
              '<div class="product-preview-name">' + (prefill.name || 'Unbekanntes Produkt') + '</div>' +
              '<div class="product-preview-meta">' + (prefill.quantity || 'Über Barcode gefunden') + '</div>' +
            '</div>' +
          '</div>'
        ) : '';
        window.app.showModal('itemModal',
          '<div class="modal-header"><div class="modal-title">Neuer Artikel</div><button class="close-btn" onclick="window.app.closeModal(\\'itemModal\\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            preview +
            '<div class="form-group"><label>Name</label><input type="text" id="newItemName" placeholder="z. B. Hafermilch" value="' + (prefill.name ? prefill.name.replace(/"/g, '&quot;') : '') + '"></div>' +
            '<div class="form-group"><label>Kategorie</label><select id="newItemCategory">' + categories.map(c => '<option value="' + c.value + '"' + (c.value === prefill.category ? ' selected' : '') + '>' + c.label + '</option>').join('') + '</select></div>' +
            '<div class="form-group"><label>Mindestmenge</label><input type="number" id="newItemThreshold" value="2" min="0"></div>' +
            '<div class="form-group"><label>Barcode</label>' +
              '<div style="display:flex; gap:8px;">' +
                '<input type="text" id="newItemBarcode" placeholder="Optional" value="' + (prefill.barcode || '') + '" style="flex:1;">' +
                '<button class="btn btn-secondary btn-small" style="width:auto; padding:0 14px;" onclick="scanIntoBarcodeField()"><i class="ph ph-barcode"></i></button>' +
              '</div>' +
            '</div>' +
            '<button class="btn" onclick="saveNewItem()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function scanIntoBarcodeField() {
        const handle = window.openBarcodeScanner();
        const code = await handle.result;
        if (code) document.getElementById('newItemBarcode').value = code;
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
          maybeCheckOffShoppingList(name);
        } catch (e) {
          window.app.toast('Fehler: ' + (e.message || 'Unbekannter Fehler'));
        }
      }
      function findItemByBarcode(code) {
        return window.app.state.items.find(i =>
          Array.isArray(i.barcodes) && i.barcodes.some(b => b.code === code)
        );
      }
      // Any item (other than itself) that already has this barcode linked --
      // used to enforce cross-item barcode uniqueness when editing an item's
      // barcode list, mirroring the old storage-inventory.html prototype's
      // "Barcode bereits mit X verknüpft" validation.
      function findOtherItemWithBarcode(code, excludeItemId) {
        return window.app.state.items.find(i =>
          i.id !== excludeItemId && Array.isArray(i.barcodes) && i.barcodes.some(b => b.code === code)
        );
      }
      // If something matching this name is still open on the shopping list,
      // mark it bought automatically -- scanning an item into the pantry
      // means it was just bought, so keeping it "open" on the list would be
      // a lie the user has to go clean up manually.
      async function maybeCheckOffShoppingList(name) {
        const normalized = name.trim().toLowerCase();
        const match = window.app.state.shopping.find(s =>
          s.status === 'open' && s.name.trim().toLowerCase() === normalized
        );
        if (!match) return;
        try {
          await window.api.shopping.update(match.id, { status: 'bought' });
          match.status = 'bought';
          window.app.toast('"' + name + '" von Einkaufsliste abgehakt');
        } catch (e) {
          // Non-critical -- the item was still added to inventory successfully.
        }
      }
      async function startScanFlow() {
        const handle = window.openBarcodeScanner();
        const code = await handle.result;
        if (!code) return;

        const existing = findItemByBarcode(code);
        if (existing) {
          window.app.toast('"' + existing.name + '" erkannt');
          // Pass the scanned code through so, if the item has multiple
          // linked barcodes (different pack sizes), the matching variant
          // chip is preselected instead of defaulting to the first one.
          openAddStock(existing.id, code);
          return;
        }

        window.app.toast('Suche Produkt...');
        try {
          const product = await window.api.products.lookup(code);
          if (product.found) {
            openAddItemModal({
              name: product.name,
              category: product.category,
              barcode: code,
              imageUrl: product.imageUrl,
              quantity: product.quantity,
            });
          } else {
            window.app.toast('Produkt nicht gefunden — bitte manuell ausfüllen');
            openAddItemModal({ barcode: code });
          }
        } catch (e) {
          window.app.toast('Produktsuche fehlgeschlagen — bitte manuell ausfüllen');
          openAddItemModal({ barcode: code });
        }
      }
      // A "working draft" of the item's barcodes, edited in the detail modal
      // and only committed on save. Kept outside the DOM (rather than
      // re-reading every input on every render) so add/remove-row clicks can
      // just re-render the list from this array.
      // NOTE: must be 'var', not 'let'/'const'. This whole <script> block is
      // re-injected into the DOM on every render() (see App.setHtml(), which
      // clones and re-executes the view's <script> tag each time). Top-level
      // 'let'/'const' create bindings in the shared global lexical
      // environment, so re-running the script a second time throws
      // "Identifier '...' has already been declared" and view scripts never
      // came back to life -- verified via a debug Playwright run that showed
      // pageerror events firing with exactly that message on the 2nd+
      // openItemDetail() call. 'var' re-declares safely in that scope.
      var detailBarcodeDraft = [];

      function renderDetailBarcodeRows() {
        if (!detailBarcodeDraft.length) {
          return '<div class="empty-state" style="padding:12px;">Keine Barcodes verknüpft</div>';
        }
        return detailBarcodeDraft.map((b, idx) =>
          '<div class="barcode-row">' +
            '<input type="text" class="detail-barcode-code" placeholder="Barcode" value="' + (b.code || '').replace(/"/g, '&quot;') + '" oninput="detailBarcodeDraft[' + idx + '].code = this.value">' +
            '<input type="number" class="detail-barcode-grams" placeholder="Gramm" min="0" value="' + (b.grams || 0) + '" oninput="detailBarcodeDraft[' + idx + '].grams = parseInt(this.value) || 0">' +
            '<button class="barcode-row-del" onclick="removeDetailBarcodeRow(' + idx + ')" title="Entfernen"><i class="ph ph-x"></i></button>' +
          '</div>'
        ).join('');
      }

      function addDetailBarcodeRow() {
        detailBarcodeDraft.push({ code: '', grams: 0 });
        document.getElementById('detailBarcodeRows').innerHTML = renderDetailBarcodeRows();
      }

      function removeDetailBarcodeRow(idx) {
        detailBarcodeDraft.splice(idx, 1);
        document.getElementById('detailBarcodeRows').innerHTML = renderDetailBarcodeRows();
      }

      async function scanIntoDetailBarcodeRow() {
        const handle = window.openBarcodeScanner();
        const code = await handle.result;
        if (!code) return;
        if (detailBarcodeDraft.length && !detailBarcodeDraft[detailBarcodeDraft.length - 1].code) {
          detailBarcodeDraft[detailBarcodeDraft.length - 1].code = code;
        } else {
          detailBarcodeDraft.push({ code, grams: 0 });
        }
        document.getElementById('detailBarcodeRows').innerHTML = renderDetailBarcodeRows();
      }

      async function openItemDetail(id) {
        try {
          const item = window.app.state.items.find(i => i.id === id);
          if (!item) return;
          const batches = window.app.state.batches.filter(b => b.item_id === id).sort((a, b) => (a.expiry || '').localeCompare(b.expiry || ''));
          const catOptions = ${JSON.stringify(Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: v.label })))};
          detailBarcodeDraft = (Array.isArray(item.barcodes) ? item.barcodes : []).map(b => ({ code: b.code, grams: b.grams || 0 }));
          window.app.showModal('itemModal',
            '<div class="modal-header"><div class="modal-title">' + item.name + '</div><button class="close-btn" onclick="window.app.closeModal(\\'itemModal\\')"><i class="ph ph-x"></i></button></div>' +
            '<div class="modal-body">' +
              '<div class="form-group"><label>Kategorie</label><select id="editCategory">' + catOptions.map(c => '<option value="' + c.value + '"' + (c.value === item.category ? ' selected' : '') + '>' + c.label + '</option>').join('') + '</select></div>' +
              '<div class="form-group"><label>Mindestmenge</label><input type="number" id="editThreshold" value="' + item.threshold + '"></div>' +
              '<div class="form-group">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><label style="margin:0">Barcodes</label><button class="btn btn-small" onclick="scanIntoDetailBarcodeRow()"><i class="ph ph-barcode"></i></button></div>' +
                '<div id="detailBarcodeRows">' + renderDetailBarcodeRows() + '</div>' +
                '<button class="barcode-add-row" onclick="addDetailBarcodeRow()"><i class="ph ph-plus"></i> Barcode hinzufügen</button>' +
              '</div>' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><label style="margin:0">Chargen</label><button class="btn btn-small" onclick="openAddStock(\\'' + item.id + '\\')">+ Bestand</button></div>' +
              '<div class="detail-batch-list" style="margin-bottom:16px;">' +
                (batches.length ? batches.map(b =>
                  '<div class="detail-batch-item" style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border);">' +
                    '<span style="font-weight:700; width:32px; text-align:center;">' + b.quantity + '</span>' +
                    '<span style="flex:1; font-size:13px;">' + (b.expiry ? new Date(b.expiry).toLocaleDateString('de-DE') : 'Kein MHD') + '</span>' +
                    '<button class="batch-del-btn" onclick="removeBatch(\\'' + b.id + '\\')"><i class="ph ph-minus"></i></button>' +
                  '</div>'
                ).join('') : '<div class="empty-state" style="padding:16px;">Keine Chargen</div>') +
              '</div>' +
              '<button class="btn" onclick="saveItemDetail(\\'' + item.id + '\\')"><i class="ph-bold ph-floppy-disk"></i> Speichern</button>' +
              '<button class="btn btn-secondary" onclick="deleteItem(\\'' + item.id + '\\')" style="margin-top:8px;"><i class="ph-bold ph-trash"></i> Löschen</button>' +
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

          // Clean the draft: drop rows the user left empty, trim codes.
          const cleaned = detailBarcodeDraft
            .map(b => ({ code: (b.code || '').trim(), grams: b.grams || 0 }))
            .filter(b => b.code);

          // Reject duplicate barcodes within this item's own list.
          const seen = new Set();
          for (const b of cleaned) {
            if (seen.has(b.code)) return window.app.toast('Barcode doppelt: ' + b.code);
            seen.add(b.code);
          }
          // Reject a barcode already linked to a *different* item -- a
          // barcode should identify exactly one product across the household.
          for (const b of cleaned) {
            const owner = findOtherItemWithBarcode(b.code, id);
            if (owner) return window.app.toast('Barcode bereits mit "' + owner.name + '" verknüpft');
          }

          await window.api.items.update(id, { threshold, category, barcodes: cleaned });
          const item = window.app.state.items.find(i => i.id === id);
          if (item) { item.threshold = threshold; item.category = category; item.barcodes = cleaned; }
          window.app.closeModal('itemModal');
          window.app.render();
          window.app.toast('Gespeichert');
        } catch (e) {
          window.app.toast('Fehler beim Speichern');
        }
      }
      async function deleteItem(id) {
        const item = window.app.state.items.find(i => i.id === id);
        if (!item) return;
        window.app.closeModal('itemModal');
        window.app.scheduleSoftDelete('item', item, window.app.state.items, '"' + item.name + '"', async () => {
          await window.api.items.delete(id);
          window.app.state.batches = window.app.state.batches.filter(b => b.item_id !== id);
        });
      }
      // When an item has more than one linked barcode (e.g. two different
      // pack sizes of the same product), show a row of "variant chips" so
      // the user can say which barcode/pack-size they're adding stock for.
      // Selecting a variant auto-fills its known gram weight as a hint.
      // Same var-not-let reasoning as detailBarcodeDraft above.
      var addStockSelectedBarcode = null;

      function getAddStockBarcodeOptions(item) {
        return Array.isArray(item.barcodes) ? item.barcodes.filter(b => b.code) : [];
      }

      function renderAddStockVariantChips(itemId) {
        const item = window.app.state.items.find(i => i.id === itemId);
        if (!item) return '';
        const options = getAddStockBarcodeOptions(item);
        if (options.length < 2) return '';
        return '<div class="form-group">' +
          '<label>Variante</label>' +
          '<div class="barcode-variant-row">' +
            options.map((b, idx) =>
              '<div class="barcode-variant-chip' + (addStockSelectedBarcode === b.code ? ' active' : '') + '" onclick="setAddStockVariant(\\'' + itemId + '\\', ' + idx + ')">' +
                b.code + (b.grams ? ' · ' + b.grams + 'g' : '') +
              '</div>'
            ).join('') +
          '</div>' +
        '</div>';
      }

      function setAddStockVariant(itemId, idx) {
        const item = window.app.state.items.find(i => i.id === itemId);
        if (!item) return;
        const options = getAddStockBarcodeOptions(item);
        const chosen = options[idx];
        if (!chosen) return;
        addStockSelectedBarcode = chosen.code;
        document.getElementById('stockVariantChips').innerHTML = renderAddStockVariantChips(itemId);
      }

      async function openAddStock(itemId, preselectBarcode) {
        addStockSelectedBarcode = preselectBarcode || null;
        // If nothing was preselected but the item has variants, default to
        // the first one so commitAddStock always has something to record.
        if (!addStockSelectedBarcode) {
          const item = window.app.state.items.find(i => i.id === itemId);
          const options = item ? getAddStockBarcodeOptions(item) : [];
          if (options.length) addStockSelectedBarcode = options[0].code;
        }
        window.app.showModal('stockModal',
          '<div class="modal-header"><div class="modal-title">Bestand hinzufügen</div><button class="close-btn" onclick="window.app.closeModal(\\'stockModal\\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div id="stockVariantChips">' + renderAddStockVariantChips(itemId) + '</div>' +
            '<div class="form-group"><label>Menge</label><input type="number" id="addQty" value="1" min="1"></div>' +
            '<div class="form-group"><label>MHD (optional)</label><input type="date" id="addExpiry"></div>' +
            '<button class="btn" onclick="commitAddStock(\\'' + itemId + '\\')"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function commitAddStock(itemId) {
        try {
          const qty = parseInt(document.getElementById('addQty').value) || 0;
          const expiry = document.getElementById('addExpiry').value;
          if (qty <= 0) return;
          const item = window.app.state.items.find(i => i.id === itemId);
          const options = item ? getAddStockBarcodeOptions(item) : [];
          const variant = options.find(b => b.code === addStockSelectedBarcode);
          const batch = await window.api.batches.create({
            item_id: itemId,
            quantity: qty,
            expiry: expiry || null,
            barcode_code: variant ? variant.code : null,
            grams_per_unit: variant ? (variant.grams || 0) : 0,
          });
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
