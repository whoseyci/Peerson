import type { App } from '../app';
import type { Item, Batch, Location } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';

// Matches the shape functions/api/product-lookup.ts already fetches from
// Open Food Facts (per-100g values) -- Item.nutrition just needs to store
// exactly these keys, whether they came from a barcode lookup or manual
// entry.
const NUTRITION_FIELDS: Array<{ key: string; label: string; unit: string }> = [
  { key: 'energy_kcal_100g', label: 'Energie', unit: 'kcal' },
  { key: 'fat_100g', label: 'Fett', unit: 'g' },
  { key: 'saturated_fat_100g', label: ' davon gesättigt', unit: 'g' },
  { key: 'carbohydrates_100g', label: 'Kohlenhydrate', unit: 'g' },
  { key: 'sugars_100g', label: ' davon Zucker', unit: 'g' },
  { key: 'fiber_100g', label: 'Ballaststoffe', unit: 'g' },
  { key: 'proteins_100g', label: 'Eiweiß / Protein', unit: 'g' },
  { key: 'salt_100g', label: 'Salz', unit: 'g' },
];

// Exported (not just module-local) so src/views/rooms.ts -- the new
// spatial location browser -- can render the exact same category icon
// each item already shows in the flat Vorrat list, rather than
// duplicating this map or inventing a second, possibly-inconsistent one.
export const CATEGORY_META: Record<string, { icon: string; label: string }> = {
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

export function getItemIcon(item: Item) {
  return item.icon || CATEGORY_META[item.category]?.icon || 'package';
}

export function getTotal(itemId: string, batches: Batch[]) {
  return batches.filter((b: any) => b.item_id === itemId).reduce((a, b) => a + b.quantity, 0);
}

export function formatDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function getDays(d?: string) {
  if (!d) return 999;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function formatPrice(cents: any) {
  if (cents === null || cents === undefined) return null;
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

// "Küche > Rollcontainer > oben" style breadcrumb for a location id, walking
// parent_id pointers up to the root. Used both for the item detail picker's
// option labels and any place an item's current location needs to be shown
// in full context (a bare "oben" is meaningless without its ancestors).
export function locationPath(locationId: string | null | undefined, locations: Location[]): string {
  if (!locationId) return '';
  const byId = new Map(locations.map(l => [l.id, l]));
  const parts: string[] = [];
  let current = byId.get(locationId);
  let hops = 0;
  while (current && hops < 20) {
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
    hops++;
  }
  return parts.join(' > ');
}

// Flattened, depth-indented <option> list for a <select> location picker --
// every node in the tree (not just leaves), each labeled with its full
// breadcrumb path so "oben" appearing under two different rooms is never
// ambiguous.
export function locationSelectOptions(locations: Location[], selectedId: string | null | undefined): string {
  const byParent = new Map<string | null, Location[]>();
  locations.forEach((l: any) => {
    const key = l.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(l);
  });
  byParent.forEach(list => list.sort((a: any, b: any) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));

  const options: string[] = ['<option value="">Kein Ort</option>'];
  const walk = (parentId: string | null, depth: number) => {
    (byParent.get(parentId) || []).forEach(node => {
      const indent = '\u00A0\u00A0\u00A0\u00A0'.repeat(depth);
      const selected = node.id === selectedId ? ' selected' : '';
      options.push(`<option value="${escapeAttr(node.id)}"${selected}>${indent}${escapeHtml(node.name)}</option>`);
      walk(node.id, depth + 1);
    });
  };
  walk(null, 0);
  return options.join('');
}

export function renderInventoryView(app: App) {
  const s = app.state;
  const lowStock = s.items.filter(i => getTotal(i.id, s.batches) < i.threshold);
  const expiring = s.batches
    .filter((b: any) => b.expiry && getDays(b.expiry) <= 30)
    .map(b => ({ ...b, item: s.items.find((i: any) => i.id === b.item_id), days: getDays(b.expiry) }))
    .filter((x: any) => x.item)
    .sort((a: any, b: any) => a.days - b.days);

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
      ${expiring.map(b => {
        const itemId = escapeJsAttr(b.item!.id);
        const itemName = escapeHtml(b.item!.name);
        const icon = escapeAttr(getItemIcon(b.item!));
        return `
        <div class="card ${b.days < 0 ? 'danger' : b.days < 14 ? 'warning' : ''}">
          <div class="card-content" onclick="openItemDetail('${itemId}')">
            <div class="card-icon"><i class="ph ph-${icon}"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${itemName}</div><div class="item-qty">${escapeHtml(b.quantity)}</div></div>
              <div class="card-meta">${b.days < 0 ? 'Abgelaufen' : escapeHtml(b.days) + ' Tage'} · ${formatDate(b.expiry)}</div>
            </div>
          </div>
        </div>
      `}).join('')}
    </div>` : ''}


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
  `;
}


      // Injected once per render from the TS-level NUTRITION_FIELDS const --
      // this whole block runs as a real <script> tag in the browser's
      // global scope, which is NOT the same scope as this .ts module, so
      // module-level consts aren't visible here; they must be serialized in.
      // Declared with 'var' (not 'const') for the same reason detailBarcodeDraft
      // and addStockSelectedBarcode are below: App.setHtml() re-injects and
      // re-executes this <script> tag on every render(), and re-declaring a
      // top-level 'const' the second time throws.
      

      export function filterInventory() {
        const term = (document.getElementById('invSearch') as any).value.toLowerCase();
        (document.getElementById('inventoryList') as any).innerHTML = (window as any).renderInventoryList((window as any).app, term);
      }
      export async function openAddItemModal(prefill: any = {}) {
        prefill = prefill || {};
        (window as any)._pendingNutrition = prefill.nutrition || {};
        (window as any)._newItemNutritionPrefill = prefill.nutrition || {};
        const categories = Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: v.label }));
        const preview = prefill.imageUrl || prefill.quantity ? (
          '<div class="product-preview">' +
            (prefill.imageUrl
              ? '<img src="' + escapeAttr(prefill.imageUrl) + '" alt="">'
              : '<div class="product-preview-icon"><i class="ph ph-package"></i></div>') +
            '<div class="product-preview-text">' +
              '<div class="product-preview-name">' + escapeHtml(prefill.name || 'Unbekanntes Produkt') + '</div>' +
              '<div class="product-preview-meta">' + escapeHtml(prefill.quantity || 'Über Barcode gefunden') + '</div>' +
            '</div>' +
          '</div>'
        ) : '';
        (window as any).app.showModal('itemModal',
          '<div class="modal-header"><div class="modal-title">Neuer Artikel</div><button class="close-btn" onclick="(window as any).app.closeModal(\'itemModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            preview +
            '<div class="form-group"><label>Name</label><input type="text" id="newItemName" placeholder="z. B. Hafermilch" value="' + (escapeAttr(prefill.name || '')) + '"></div>' +
            '<div class="form-group"><label>Kategorie</label><select id="newItemCategory">' + categories.map((c: any) => '<option value="' + c.value + '"' + (c.value === prefill.category ? ' selected' : '') + '>' + c.label + '</option>').join('') + '</select></div>' +
            '<div class="form-group"><label>Mindestmenge</label><input type="number" id="newItemThreshold" value="2" min="0"></div>' +
            ((window as any).app.state.locations.length ? '<div class="form-group"><label>Ort</label><select id="newItemLocation">' + (window as any).locationSelectOptions((window as any).app.state.locations, null) + '</select></div>' : '') +
            '<div class="form-group"><label>Preis (optional)</label><input type="text" inputmode="decimal" id="newItemPrice" placeholder="z. B. 2,49"></div>' +
            '<div class="form-group"><label>Barcode</label>' +
              '<div style="display:flex; gap:8px;">' +
                '<input type="text" id="newItemBarcode" placeholder="Optional" value="' + escapeAttr(prefill.barcode || '') + '" style="flex:1;">' +
                '<button class="btn btn-secondary btn-small" style="width:auto; padding:0 14px;" onclick="scanIntoBarcodeField()"><i class="ph ph-barcode"></i></button>' +
              '</div>' +
            '</div>' +
            '<button class="btn" onclick="saveNewItem()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      export async function scanIntoBarcodeField() {
        const handle = (window as any).openBarcodeScanner();
        const code = await handle.result;
        if (code) (document.getElementById('newItemBarcode') as any).value = code;
      }
      export async function saveNewItem() {
        try {
          const name = (document.getElementById('newItemName') as any).value.trim();
          if (!name) return (window as any).app.toast('Name erforderlich');
          const priceInput = (document.getElementById('newItemPrice') as any);
          const priceEuros = priceInput ? parseFloat(priceInput.value.replace(',', '.')) : NaN;
          const item = await (window as any).api.items.create({
            household_id: (window as any).app.state.householdId,
            name,
            category: (document.getElementById('newItemCategory') as any).value,
            threshold: parseInt((document.getElementById('newItemThreshold') as any).value) || 0,
            location_id: (document.getElementById('newItemLocation') as any) ? ((document.getElementById('newItemLocation') as any).value || null) : null,
            barcodes: (document.getElementById('newItemBarcode') as any).value ? [{ code: (document.getElementById('newItemBarcode') as any).value, grams: 0 }] : [],
            nutrition: (window as any)._pendingNutrition || (window as any)._newItemNutritionPrefill || {},
            price_cents: !isNaN(priceEuros) ? Math.round(priceEuros * 100) : null,
          });
          (window as any).app.state.items.push(item.item);
          (window as any).app.closeModal('itemModal');
          (window as any).app.render();
          (window as any).app.toast('Artikel erstellt');
          maybeCheckOffShoppingList(name);
        } catch (e: any) {
          (window as any).app.toast('Fehler: ' + (e.message || 'Unbekannter Fehler'));
        }
      }
      export function findItemByBarcode(code: string) {
        return (window as any).app.state.items.find((i: any) =>
          Array.isArray(i.barcodes) && i.barcodes.some((b: any) => b.code === code)
        );
      }
      // Any item (other than itself) that already has this barcode linked --
      // used to enforce cross-item barcode uniqueness when editing an item's
      // barcode list, mirroring the old storage-inventory.html prototype's
      // "Barcode bereits mit X verknüpft" validation.
      export function findOtherItemWithBarcode(code: string, excludeItemId: string) {
        return (window as any).app.state.items.find((i: any) =>
          i.id !== excludeItemId && Array.isArray(i.barcodes) && i.barcodes.some((b: any) => b.code === code)
        );
      }
      // If something matching this name is still open on the shopping list,
      // mark it bought automatically -- scanning an item into the pantry
      // means it was just bought, so keeping it "open" on the list would be
      // a lie the user has to go clean up manually.
      export async function maybeCheckOffShoppingList(name: string) {
        const normalized = name.trim().toLowerCase();
        const match = (window as any).app.state.shopping.find((s: any) =>
          s.status === 'open' && s.name.trim().toLowerCase() === normalized
        );
        if (!match) return;
        try {
          await (window as any).api.shopping.update(match.id, { status: 'bought' });
          match.status = 'bought';
          (window as any).app.toast('"' + name + '" von Einkaufsliste abgehakt');
        } catch (e: any) {
          // Non-critical -- the item was still added to inventory successfully.
        }
      }
      export async function startScanFlow() {
        const handle = (window as any).openBarcodeScanner();
        const code = await handle.result;
        if (!code) return;

        const existing = findItemByBarcode(code);
        if (existing) {
          (window as any).app.toast('"' + existing.name + '" erkannt');
          // Pass the scanned code through so, if the item has multiple
          // linked barcodes (different pack sizes), the matching variant
          // chip is preselected instead of defaulting to the first one.
          openAddStock(existing.id, code);
          return;
        }

        (window as any).app.toast('Suche Produkt...');
        try {
          const product = await (window as any).api.products.lookup(code);
          if (product.found) {
            openAddItemModal({
              name: product.name,
              category: product.category,
              barcode: code,
              imageUrl: product.imageUrl,
              quantity: product.quantity,
              nutrition: product.nutrition || null,
            });
          } else {
            (window as any).app.toast('Produkt nicht gefunden — bitte manuell ausfüllen');
            openAddItemModal({ barcode: code });
          }
        } catch (e: any) {
          (window as any).app.toast('Produktsuche fehlgeschlagen — bitte manuell ausfüllen');
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
      let detailBarcodeDraft: any[] = [];

      export function renderDetailBarcodeRows() {
        if (!detailBarcodeDraft.length) {
          return '<div class="empty-state" style="padding:12px;">Keine Barcodes verknüpft</div>';
        }
        return detailBarcodeDraft.map((b, idx) =>
          '<div class="barcode-row">' +
            '<input type="text" class="detail-barcode-code" placeholder="Barcode" value="' + escapeAttr(b.code || '') + '" oninput="detailBarcodeDraft[' + idx + '].code = this.value">' +
            '<input type="number" class="detail-barcode-grams" placeholder="Gramm" min="0" value="' + (b.grams || 0) + '" oninput="detailBarcodeDraft[' + idx + '].grams = parseInt(this.value) || 0">' +
            '<button class="barcode-row-del" onclick="removeDetailBarcodeRow(' + idx + ')" title="Entfernen"><i class="ph ph-x"></i></button>' +
          '</div>'
        ).join('');
      }

      export function addDetailBarcodeRow() {
        detailBarcodeDraft.push({ code: '', grams: 0 });
        (document.getElementById('detailBarcodeRows') as any).innerHTML = renderDetailBarcodeRows();
      }

      export function removeDetailBarcodeRow(idx: number) {
        detailBarcodeDraft.splice(idx, 1);
        (document.getElementById('detailBarcodeRows') as any).innerHTML = renderDetailBarcodeRows();
      }

      export async function scanIntoDetailBarcodeRow() {
        const handle = (window as any).openBarcodeScanner();
        const code = await handle.result;
        if (!code) return;
        if (detailBarcodeDraft.length && !detailBarcodeDraft[detailBarcodeDraft.length - 1].code) {
          detailBarcodeDraft[detailBarcodeDraft.length - 1].code = code;
        } else {
          detailBarcodeDraft.push({ code, grams: 0 });
        }
        (document.getElementById('detailBarcodeRows') as any).innerHTML = renderDetailBarcodeRows();
      }

      // Renders a compact read-only nutrition table (per 100g) if the item
      // has any nutrition values set (from an Open Food Facts lookup or
      // manual entry) -- otherwise a hint + button to fill it in by hand,
      // since not every product a household tracks has a barcode.
      export function renderNutritionSection(item: any) {
        const n = item.nutrition || {};
        const hasAny = NUTRITION_FIELDS.some((f: any) => n[f.key] !== undefined && n[f.key] !== null);
        if (!hasAny) {
          return '<div class="form-group">' +
            '<label>Nährwerte (pro 100g)</label>' +
            '<div class="empty-state" style="padding:12px;">Keine Nährwerte hinterlegt</div>' +
            '<button class="btn btn-secondary btn-small" onclick="openNutritionEditor(\'' + item.id + '\')"><i class="ph ph-pencil-simple"></i> Manuell eintragen</button>' +
          '</div>';
        }
        return '<div class="form-group">' +
          '<label>Nährwerte (pro 100g)</label>' +
          '<div class="nutrition-table">' +
            NUTRITION_FIELDS.map((f: any) =>
              '<div class="nutrition-row"><span>' + f.label + '</span><span>' + (n[f.key] ?? '—') + (n[f.key] != null ? ' ' + f.unit : '') + '</span></div>'
            ).join('') +
          '</div>' +
          '<button class="btn btn-secondary btn-small mt-2" onclick="openNutritionEditor(\'' + item.id + '\')"><i class="ph ph-pencil-simple"></i> Bearbeiten</button>' +
        '</div>';
      }

      export function openNutritionEditor(itemId: string) {
        const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
        if (!item) return;
        const n = item.nutrition || {};
        (window as any).app.showModal('nutritionModal',
          '<div class="modal-header"><div class="modal-title">Nährwerte (pro 100g)</div><button class="close-btn" onclick="(window as any).app.closeModal(\'nutritionModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            NUTRITION_FIELDS.map((f: any) =>
              '<div class="form-group"><label>' + f.label + ' (' + f.unit + ')</label><input type="number" step="0.1" min="0" id="nutrition_' + f.key + '" value="' + (n[f.key] ?? '') + '"></div>'
            ).join('') +
            '<button class="btn" onclick="saveNutritionEditor(\'' + itemId + '\')"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }

      export async function saveNutritionEditor(itemId: string) {
        try {
          const nutrition: Record<string, number> = {};
          NUTRITION_FIELDS.forEach(f => {
            const raw = ((document.getElementById('nutrition_' + f.key) as any)?.value || '');
            if (raw !== '') nutrition[f.key] = parseFloat(raw);
          });
          await (window as any).api.items.update(itemId, { nutrition });
          const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
          if (item) item.nutrition = nutrition;
          (window as any).app.closeModal('nutritionModal');
          openItemDetail(itemId);
          (window as any).app.toast('Nährwerte gespeichert');
        } catch (e: any) {
          (window as any).app.toast('Fehler beim Speichern');
        }
      }

      // Price + inflation history. items.price_cents is always the
      // *current* price; older prices only exist as closed
      // item_price_history rows once the price has actually changed (see
      // functions/api/items/[id].ts for the full design rationale) -- so
      // fetching history is a separate, on-demand call rather than
      // something bundled into every item load.
      export async function openPriceHistory(itemId: string) {
        const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
        if (!item) return;
        let historyHtml = '<div class="empty-state" style="padding:12px;">Lade...</div>';
        (window as any).app.showModal('priceHistoryModal',
          '<div class="modal-header"><div class="modal-title">Preisverlauf</div><button class="close-btn" onclick="(window as any).app.closeModal(\'priceHistoryModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body" id="priceHistoryBody">' + historyHtml + '</div>'
        );
        try {
          const data = await (window as any).api.items.priceHistory(itemId);
          const rows = [...data.history];
          const body = (document.getElementById('priceHistoryBody') as any);
          if (!body) return; // modal was closed before the request finished
          if (!rows.length && (item.price_cents === null || item.price_cents === undefined)) {
            body.innerHTML = '<div class="empty-state" style="padding:12px;">Kein Preis hinterlegt</div>';
            return;
          }
          const fmt = (cents: any) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
          const fmtDate = (unixSeconds: any) => new Date(unixSeconds * 1000).toLocaleDateString('de-DE');
          let html = '<div class="price-history-list">';
          rows.forEach(r => {
            html += '<div class="price-history-row"><span>' + fmtDate(r.effective_from) + ' \u2013 ' + fmtDate(r.effective_until) + '</span><span>' + fmt(r.price_cents) + '</span></div>';
          });
          if (item.price_cents !== null && item.price_cents !== undefined) {
            const since = rows.length ? fmtDate(rows[rows.length - 1].effective_until) : 'Anfang';
            html += '<div class="price-history-row price-history-current"><span>Seit ' + since + '</span><span>' + fmt(item.price_cents) + ' (aktuell)</span></div>';
          }
          html += '</div>';
          if (rows.length) {
            const first = rows[0].price_cents;
            const last = item.price_cents ?? rows[rows.length - 1].price_cents;
            const deltaPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
            html += '<div style="margin-top:12px; font-size:13px; color:var(--text-soft);">' +
              (deltaPct > 0 ? 'Preisanstieg seit erstem bekannten Preis: +' + deltaPct + '%' :
               deltaPct < 0 ? 'Preisrückgang seit erstem bekannten Preis: ' + deltaPct + '%' :
               'Preis unverändert seit erstem bekannten Preis') +
            '</div>';
          }
          body.innerHTML = html;
        } catch (e: any) {
          const body = (document.getElementById('priceHistoryBody') as any);
          if (body) body.innerHTML = '<div class="empty-state" style="padding:12px;">Fehler beim Laden</div>';
        }
      }

      export async function openItemDetail(id: string) {
        try {
          const item = (window as any).app.state.items.find((i: any) => i.id === id);
          if (!item) return;
          const batches = (window as any).app.state.batches.filter((b: any) => b.item_id === id).sort((a: any, b: any) => (a.expiry || '').localeCompare(b.expiry || ''));
          const catOptions = Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: v.label }));
          detailBarcodeDraft = (Array.isArray(item.barcodes) ? item.barcodes : []).map((b: any) => ({ code: b.code, grams: b.grams || 0 }));
          const priceEuros = (item.price_cents !== null && item.price_cents !== undefined) ? (item.price_cents / 100).toFixed(2).replace('.', ',') : '';
          (window as any).app.showModal('itemModal',
            '<div class="modal-header"><div class="modal-title">' +
              '<input type="text" id="editName" value="' + escapeAttr(item.name) + '" style="font-size:18px; font-weight:700; border:none; background:transparent; padding:0; width:100%;">' +
            '</div><button class="close-btn" onclick="(window as any).app.closeModal(\'itemModal\')"><i class="ph ph-x"></i></button></div>' +
            '<div class="modal-body">' +
              '<div class="form-group"><label>Kategorie</label><select id="editCategory">' + catOptions.map((c: any) => '<option value="' + c.value + '"' + (c.value === item.category ? ' selected' : '') + '>' + c.label + '</option>').join('') + '</select></div>' +
              '<div class="form-group"><label>Mindestmenge</label><input type="number" id="editThreshold" value="' + item.threshold + '"></div>' +
              ((window as any).app.state.locations.length ? '<div class="form-group"><label>Ort</label><select id="editLocation">' + (window as any).locationSelectOptions((window as any).app.state.locations, item.location_id || null) + '</select></div>' : '') +
              '<div class="form-group"><label>Preis</label><input type="text" inputmode="decimal" id="editPrice" placeholder="z. B. 2,49" value="' + priceEuros + '">' +
                '<button class="barcode-add-row" onclick="openPriceHistory(\'' + item.id + '\')" style="margin-top:4px;"><i class="ph ph-chart-line"></i> Preisverlauf ansehen</button>' +
              '</div>' +
              renderNutritionSection(item) +
              '<div class="form-group">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><label style="margin:0">Barcodes</label><button class="btn btn-small" onclick="scanIntoDetailBarcodeRow()"><i class="ph ph-barcode"></i></button></div>' +
                '<div id="detailBarcodeRows">' + renderDetailBarcodeRows() + '</div>' +
                '<button class="barcode-add-row" onclick="addDetailBarcodeRow()"><i class="ph ph-plus"></i> Barcode hinzufügen</button>' +
              '</div>' +
              '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><label style="margin:0">Chargen</label><button class="btn btn-small" onclick="openAddStock(\'' + item.id + '\')">+ Bestand</button></div>' +
              '<div class="detail-batch-list" style="margin-bottom:16px;">' +
                (batches.length ? batches.map((b: any) =>
                  '<div class="detail-batch-item" style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border);">' +
                    '<span style="font-weight:700; width:32px; text-align:center;">' + b.quantity + '</span>' +
                    '<input type="date" class="batch-expiry-input" value="' + (b.expiry || '') + '" onchange="updateBatchExpiry(&quot;' + b.id + '&quot;, this.value)" style="width:115px; padding:4px; font-size:12px;">' +
                    (b.price ? '<span style="font-size:12px; font-weight:600; color:var(--success); margin-left:6px;">' + b.price.toFixed(2) + ' €</span>' : '') +
                    '<span style="flex:1;"></span>' +
                    '<button class="batch-del-btn" onclick="removeBatch(\'' + b.id + '\')"><i class="ph ph-minus"></i></button>' +
                  '</div>'
                ).join('') : '<div class="empty-state" style="padding:16px;">Keine Chargen</div>') +
              '</div>' +
              '<button class="btn" onclick="saveItemDetail(\'' + item.id + '\')"><i class="ph-bold ph-floppy-disk"></i> Speichern</button>' +
              '<button class="btn btn-secondary" onclick="deleteItem(\'' + item.id + '\')" style="margin-top:8px;"><i class="ph-bold ph-trash"></i> Löschen</button>' +
            '</div>'
          );
        } catch (e: any) {
          (window as any).app.toast('Fehler beim Öffnen');
        }
      }
      export async function updateBatchExpiry(batchId: string, value: string) {
        try {
          await (window as any).api.batches.update(batchId, { expiry: value || null });
          const b = (window as any).app.state.batches.find((x: any) => x.id === batchId);
          if (b) b.expiry = value || null;
          (window as any).app.toast('MHD aktualisiert');
        } catch (e: any) {
          (window as any).app.toast('Fehler beim Speichern des MHD');
        }
      }
      export async function saveItemDetail(id: string) {
        try {
          const name = (document.getElementById('editName') as any).value.trim();
          if (!name) return (window as any).app.toast('Name erforderlich');
          const threshold = parseInt((document.getElementById('editThreshold') as any).value) || 0;
          const category = (document.getElementById('editCategory') as any).value;
          const locationSelect = (document.getElementById('editLocation') as any);
          const locationId = locationSelect ? (locationSelect.value || null) : undefined;
          const priceInput = (document.getElementById('editPrice') as any);
          const priceRaw = priceInput ? priceInput.value.trim() : '';
          const priceEuros = priceRaw ? parseFloat(priceRaw.replace(',', '.')) : NaN;
          const priceCents = priceRaw === '' ? null : (!isNaN(priceEuros) ? Math.round(priceEuros * 100) : undefined);
          if (priceRaw !== '' && priceCents === undefined) return (window as any).app.toast('Ungültiger Preis');

          // Clean the draft: drop rows the user left empty, trim codes.
          const cleaned = detailBarcodeDraft
            .map(b => ({ code: (b.code || '').trim(), grams: b.grams || 0 }))
            .filter((b: any) => b.code);

          // Reject duplicate barcodes within this item's own list.
          const seen = new Set();
          for (const b of cleaned) {
            if (seen.has(b.code)) return (window as any).app.toast('Barcode doppelt: ' + b.code);
            seen.add(b.code);
          }
          // Reject a barcode already linked to a *different* item -- a
          // barcode should identify exactly one product across the household.
          for (const b of cleaned) {
            const owner = findOtherItemWithBarcode(b.code, id || '');
            if (owner) return (window as any).app.toast('Barcode bereits mit "' + owner.name + '" verknüpft');
          }

          const payload: any = { name, threshold, category, barcodes: cleaned, price_cents: priceCents };
          if (locationId !== undefined) payload.location_id = locationId;
          const res = await (window as any).api.items.update(id, payload);
          const item = (window as any).app.state.items.find((i: any) => i.id === id);
          if (item) {
            item.name = res.item.name;
            item.threshold = threshold;
            item.category = category;
            item.barcodes = cleaned;
            item.price_cents = res.item.price_cents;
            if (locationId !== undefined) item.location_id = locationId;
          }
          (window as any).app.closeModal('itemModal');
          (window as any).app.render();
          (window as any).app.toast('Gespeichert');
        } catch (e: any) {
          (window as any).app.toast('Fehler beim Speichern');
        }
      }
      export async function deleteItem(id: string) {
        const item = (window as any).app.state.items.find((i: any) => i.id === id);
        if (!item) return;
        (window as any).app.closeModal('itemModal');
        (window as any).app.scheduleSoftDelete('item', item, (window as any).app.state.items, '"' + item.name + '"', async () => {
          await (window as any).api.items.delete(id);
          (window as any).app.state.batches = (window as any).app.state.batches.filter((b: any) => b.item_id !== id);
        });
      }
      // When an item has more than one linked barcode (e.g. two different
      // pack sizes of the same product), show a row of "variant chips" so
      // the user can say which barcode/pack-size they're adding stock for.
      // Selecting a variant auto-fills its known gram weight as a hint.
      // Same var-not-let reasoning as detailBarcodeDraft above.
      let addStockSelectedBarcode: string | null = null;

      export function getAddStockBarcodeOptions(item: any) {
        return Array.isArray(item.barcodes) ? item.barcodes.filter((b: any) => b.code) : [];
      }

      export function renderAddStockVariantChips(itemId: string) {
        const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
        if (!item) return '';
        const options = getAddStockBarcodeOptions(item);
        if (options.length < 2) return '';
        return '<div class="form-group">' +
          '<label>Variante</label>' +
          '<div class="barcode-variant-row">' +
            options.map((b: any, idx: number) =>
              '<div class="barcode-variant-chip' + (addStockSelectedBarcode === b.code ? ' active' : '') + '" onclick="setAddStockVariant(\'' + itemId + '\', ' + idx + ')">' +
                escapeHtml(b.code) + (b.grams ? ' · ' + escapeHtml(b.grams) + 'g' : '') +
              '</div>'
            ).join('') +
          '</div>' +
        '</div>';
      }

      export function setAddStockVariant(itemId: string, idx: number) {
        const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
        if (!item) return;
        const options = getAddStockBarcodeOptions(item);
        const chosen = options[idx];
        if (!chosen) return;
        addStockSelectedBarcode = chosen.code;
        (document.getElementById('stockVariantChips') as any).innerHTML = renderAddStockVariantChips(itemId);
      }

      export async function openAddStock(itemId: string, preselectBarcode?: string | null) {
        addStockSelectedBarcode = preselectBarcode || null;
        // If nothing was preselected but the item has variants, default to
        // the first one so commitAddStock always has something to record.
        if (!addStockSelectedBarcode) {
          const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
          const options = item ? getAddStockBarcodeOptions(item) : [];
          if (options.length) addStockSelectedBarcode = options[0].code;
        }
        (window as any).app.showModal('stockModal',
          '<div class="modal-header"><div class="modal-title">Bestand hinzufügen</div><button class="close-btn" onclick="(window as any).app.closeModal(\'stockModal\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div id="stockVariantChips">' + renderAddStockVariantChips(itemId) + '</div>' +
            '<div class="form-group"><label>Menge</label><input type="number" id="addQty" value="1" min="1"></div>' +
            '<div class="form-group"><label>MHD (optional)</label><input type="date" id="addExpiry"></div>' +
            '<div class="form-group"><label>Preis (€, optional)</label><input type="number" id="addPrice" step="0.01" min="0" placeholder="z. B. 1.79"></div>' +
            '<button class="btn" onclick="commitAddStock(\'' + itemId + '\')"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      export async function commitAddStock(itemId: string) {
        try {
          const qty = parseInt((document.getElementById('addQty') as any).value) || 0;
          const expiry = (document.getElementById('addExpiry') as any).value;
          if (qty <= 0) return;
          const item = (window as any).app.state.items.find((i: any) => i.id === itemId);
          const options = item ? getAddStockBarcodeOptions(item) : [];
          const variant = options.find((b: any) => b.code === addStockSelectedBarcode);
          const priceVal = (document.getElementById('addPrice') as any) ? (document.getElementById('addPrice') as any).value : null;
          const price = priceVal ? parseFloat(priceVal) || null : null;
          const batch = await (window as any).api.batches.create({
            item_id: itemId,
            quantity: qty,
            expiry: expiry || null,
            barcode_code: variant ? variant.code : null,
            grams_per_unit: variant ? (variant.grams || 0) : 0,
            price: price,
          });
          (window as any).app.state.batches.push(batch.batch);
          (window as any).app.closeModal('stockModal');
          (window as any).app.render();
          (window as any).app.toast('Hinzugefügt');
        } catch (e: any) {
          (window as any).app.toast('Fehler beim Hinzufügen');
        }
      }
      export async function removeBatch(batchId: string) {
        try {
          const b = (window as any).app.state.batches.find((x: any) => x.id === batchId);
          if (!b) return;
          if (b.quantity > 1) {
            await (window as any).api.batches.update(batchId, { quantity: b.quantity - 1 });
            b.quantity -= 1;
          } else {
            await (window as any).api.batches.delete(batchId);
            (window as any).app.state.batches = (window as any).app.state.batches.filter((x: any) => x.id !== batchId);
          }
          (window as any).app.render();
          (window as any).app.toast('Entnommen');
        } catch (e: any) {
          (window as any).app.toast('Fehler beim Entnehmen');
        }
      }
      export async function removeOne(itemId: string) {
        const batches = (window as any).app.state.batches.filter((b: any) => b.item_id === itemId).sort((a: any, b: any) => (a.expiry || '').localeCompare(b.expiry || ''));
        if (!batches.length) return (window as any).app.toast('Kein Bestand');
        await removeBatch(batches[0].id);
      }
    
// Attach all handlers to window for HTML onclick attributes
Object.assign(window as any, {
  filterInventory,
  openAddItemModal,
  scanIntoBarcodeField,
  saveNewItem,
  findItemByBarcode,
  findOtherItemWithBarcode,
  maybeCheckOffShoppingList,
  startScanFlow,
  renderDetailBarcodeRows,
  addDetailBarcodeRow,
  removeDetailBarcodeRow,
  scanIntoDetailBarcodeRow,
  renderNutritionSection,
  openNutritionEditor,
  saveNutritionEditor,
  openPriceHistory,
  openItemDetail,
  updateBatchExpiry,
  saveItemDetail,
  deleteItem,
  getAddStockBarcodeOptions,
  renderAddStockVariantChips,
  setAddStockVariant,
  openAddStock,
  commitAddStock,
  removeBatch,
  removeOne
});

function renderInventoryList(app: App, filter: string) {
  const sorted = [...app.state.items]
    .filter(i => !filter || i.name.toLowerCase().includes(filter))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  if (!sorted.length) return `<div class="empty-state">Keine Artikel</div>`;

  return sorted.map(i => {
    const total = getTotal(i.id, app.state.batches);
    const kcal = i.nutrition?.energy_kcal_100g || i.nutrition?.['energy-kcal_100g'];
    const nutriScore = i.nutrition?.nutriscore_grade ? String(i.nutrition.nutriscore_grade).toUpperCase() : null;
    const latestBatch = app.state.batches.filter((b: any) => b.item_id === i.id && typeof b.price === 'number' && b.price > 0).sort((a,b) => b.date_added - a.date_added)[0];
    const priceStr = latestBatch ? ` · ca. ${latestBatch.price!.toFixed(2)} €` : '';
    const itemId = escapeJsAttr(i.id);
    const itemName = escapeHtml(i.name);
    const categoryLabel = escapeHtml(CATEGORY_META[i.category]?.label || i.category);
    const icon = escapeAttr(getItemIcon(i));
    const nutriStr = (nutriScore || kcal) ? ` <span style="font-size:0.75rem; background:var(--border); padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:600; display:inline-block; margin-top:2px;">${nutriScore ? `Nutri-Score ${escapeHtml(nutriScore)} ` : ''}${kcal ? `<i class="ph ph-fire"></i> ${escapeHtml(kcal)} kcal` : ''}</span>` : '';
    return `
      <div class="card">
        <div class="card-content" onclick="openItemDetail('${itemId}')">
          <div class="card-icon"><i class="ph ph-${icon}"></i></div>
          <div class="card-text">
            <div class="card-header"><div class="item-name">${itemName}</div><div class="item-qty">${total}</div></div>
            <div class="card-meta">${categoryLabel} · Min. ${escapeHtml(i.threshold)}${priceStr}</div>
            ${nutriStr}
          </div>
        </div>
        <div class="card-actions">
          <button class="action-btn add" onclick="openAddStock('${itemId}')" aria-label="Bestand für ${itemName} hinzufügen"><i class="ph ph-plus"></i></button>
          <button class="action-btn remove" onclick="removeOne('${itemId}')" aria-label="Eine Einheit ${itemName} entnehmen"><i class="ph ph-minus"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

(window as any).renderInventoryList = renderInventoryList;
(window as any).locationSelectOptions = locationSelectOptions;
(window as any).locationPath = locationPath;
