import type { App } from '../app';
import type { ReceiptScanLineItem } from '../api/client';
import { escapeAttr, escapeHtml } from '../utils/html';

// Photo-a-receipt capture flow. Deliberately NOT plain OCR (see
// functions/api/receipt-scan.ts's doc comment for why) -- a photo goes to
// a vision-capable LLM (Gemini via Google AI Studio) and comes back as a
// draft list of {name, price, quantity} the user reviews and edits before
// anything is actually written to the shopping list or logged as an
// expense. If the household hasn't configured a GEMINI_API_KEY yet, this
// degrades to an explanatory message rather than a broken/silent failure
// -- exactly like the bug-report button's behavior when GITHUB_PAT isn't
// configured (see functions/api/bug-report.ts).

// The current in-progress scan's draft state, edited in place as the user
// checks/unchecks and edits rows before committing. 'var' (not
// 'let'/'const') for the same re-injected-<script>-tag reason as
// inventory.ts's detailBarcodeDraft/addStockSelectedBarcode.
let receiptDraftItems: Array<ReceiptScanLineItem & { checked: boolean }> = [];

export function openReceiptScanModal() {
  const app = (window as any).app as App;
  app.showModal('receiptScanModal', `
    <div class="modal-header">
      <div class="modal-title"><i class="ph ph-receipt"></i> Beleg scannen</div>
      <button class="close-btn" onclick="window.app.closeModal('receiptScanModal')"><i class="ph ph-x"></i></button>
    </div>
    <div class="modal-body" id="receiptScanBody">
      <p style="color:var(--text-soft); font-size:13.5px; margin-bottom:16px;">
        Foto vom Kassenbon aufnehmen oder auswählen -- die Artikel werden automatisch erkannt und können danach geprüft werden.
      </p>
      <input type="file" id="receiptFileInput" accept="image/*" capture="environment" style="display:none;" onchange="handleReceiptFileSelected(event)">
      <button class="btn" onclick="document.getElementById('receiptFileInput').click()"><i class="ph-bold ph-camera"></i> Foto aufnehmen / auswählen</button>
    </div>
  `);
}

export function handleReceiptFileSelected(event: Event) {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const body = document.getElementById('receiptScanBody');
  if (body) {
    body.innerHTML = `
      <div style="text-align:center; padding:30px 10px;">
        <div class="spinner" style="margin:0 auto 16px; width:32px; height:32px;"></div>
        <div style="color:var(--text-soft); font-size:13.5px;">Beleg wird analysiert...</div>
      </div>`;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const dataUrl = reader.result as string;
      const result = await api.receipts.scan(dataUrl);
      if (!result.configured) {
        renderNotConfigured();
        return;
      }
      receiptDraftItems = result.items.map((i: ReceiptScanLineItem) => ({ ...i, checked: true }));
      renderReceiptReview(result.merchant, result.total);
    } catch (e) {
      app.toast('Beleg konnte nicht analysiert werden');
      const b = document.getElementById('receiptScanBody');
      if (b) b.innerHTML = `<div class="empty-state" style="padding:24px;">Fehler beim Analysieren -- bitte erneut versuchen.</div>`;
    }
  };
  reader.readAsDataURL(file);
}

function renderNotConfigured() {
  const body = document.getElementById('receiptScanBody');
  if (!body) return;
  body.innerHTML = `
    <div style="text-align:center; padding:20px 10px;">
      <i class="ph ph-gear-six" style="font-size:36px; color:var(--text-soft);"></i>
      <p style="margin-top:14px; font-size:13.5px; color:var(--text-soft);">
        Beleg-Scan ist serverseitig noch nicht eingerichtet. Eine Admin-Person muss einen
        <code style="background:var(--bg); padding:1px 5px; border-radius:4px;">GEMINI_API_KEY</code>
        (von <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>)
        als Umgebungsvariable im Cloudflare-Pages-Projekt hinterlegen.
      </p>
    </div>`;
}

function renderReceiptReview(merchant: string | null, total: number | null) {
  const body = document.getElementById('receiptScanBody');
  if (!body) return;

  if (!receiptDraftItems.length) {
    body.innerHTML = `<div class="empty-state" style="padding:24px;">Keine Artikel erkannt -- bitte manuell hinzufügen.</div>`;
    return;
  }

  body.innerHTML = `
    ${merchant ? `<div style="font-weight:700; margin-bottom:4px;">${escapeHtml(merchant)}</div>` : ''}
    <div style="color:var(--text-soft); font-size:12.5px; margin-bottom:14px;">${receiptDraftItems.length} Artikel erkannt${total !== null ? ` · Summe lt. Beleg: ${total.toFixed(2)} €` : ''} -- bitte prüfen:</div>
    <div id="receiptItemRows">${renderReceiptItemRows()}</div>
    <button class="btn mt-3" onclick="commitReceiptItems()"><i class="ph-bold ph-check"></i> Ausgewählte zur Einkaufsliste (gekauft)</button>
  `;
}

function renderReceiptItemRows(): string {
  return receiptDraftItems.map((item, idx) => `
    <div class="barcode-row" style="align-items:center;">
      <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="toggleReceiptItem(${idx})" style="flex-shrink:0;">
      <input type="text" value="${escapeAttr(item.name)}" oninput="updateReceiptItemName(${idx}, this.value)" style="flex:2;">
      <input type="number" step="0.01" min="0" value="${item.price ?? ''}" placeholder="€" oninput="updateReceiptItemPrice(${idx}, this.value)" style="flex:1;">
    </div>
  `).join('');
}

export function toggleReceiptItem(idx: number) {
  if (receiptDraftItems[idx]) receiptDraftItems[idx].checked = !receiptDraftItems[idx].checked;
}

// Real function calls routed through window (not inline
// `oninput="receiptDraftItems[idx].name = this.value"` property-write
// expressions) -- see src/views/inventory.ts's updateDetailBarcodeCode/
// updateDetailBarcodeGrams for the full root-cause writeup of why the
// latter silently doesn't work at all: inline HTML event-handler
// attributes run in global scope and can only see `window.*` properties,
// never a module-scoped `let`/`var` binding, however that variable is
// declared. Deliberately not re-rendering the row list here (unlike
// toggleReceiptItem, which doesn't need to touch a live input) so typing
// doesn't destroy/recreate the <input> mid-keystroke and steal focus.
export function updateReceiptItemName(idx: number, value: string) {
  if (receiptDraftItems[idx]) receiptDraftItems[idx].name = value;
}

export function updateReceiptItemPrice(idx: number, value: string) {
  if (receiptDraftItems[idx]) receiptDraftItems[idx].price = value ? parseFloat(value) : null;
}


export async function commitReceiptItems() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const checked = receiptDraftItems.filter(i => i.checked && i.name.trim());
  if (!checked.length) return app.toast('Nichts ausgewählt');

  try {
    for (const draftItem of checked) {
      // Match against an existing pantry item by name so a repeat
      // purchase (e.g. "Milch" bought again) links to the same item
      // record rather than creating an unlinked duplicate -- same
      // matching approach shopping.ts's saveBoughtDetails already uses.
      const linked = app.state.items.find(i => i.name.trim().toLowerCase() === draftItem.name.trim().toLowerCase());
      const shop = await api.shopping.create({
        household_id: app.state.householdId,
        name: draftItem.name.trim(),
        status: 'bought',
        price: draftItem.price,
        linked_item_id: linked ? linked.id : undefined,
      });
      app.state.shopping.push(shop.item);
      if (linked) {
        const batch = await api.batches.create({ item_id: linked.id, quantity: 1, price: draftItem.price });
        app.state.batches.push(batch.batch);
      }
    }
    app.closeModal('receiptScanModal');
    app.render();
    app.toast(`${checked.length} Artikel übernommen`);
  } catch (e) {
    app.toast('Fehler beim Übernehmen');
  }
}

Object.assign(window as any, {
  openReceiptScanModal,
  handleReceiptFileSelected,
  toggleReceiptItem,
  updateReceiptItemName,
  updateReceiptItemPrice,
  commitReceiptItems,
});
