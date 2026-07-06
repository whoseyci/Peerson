import type { App } from '../app';

// The floating "+" capture button's options sheet -- the single universal
// entry point for adding anything to the household, replacing the old
// per-tab "+" icon buttons that only ever knew how to add one kind of
// thing. Uses App.showSheet()/closeSheet() (the new bottom-sheet
// component, see main.css's .sheet/.sheet-backdrop) rather than the
// existing .modal system, matching the approved UX-vision mock's capture
// sheet, which is deliberately visually distinct from a form modal --
// it's a menu, not a form.
export function openCaptureSheet() {
  const app = (window as any).app as App;
  app.showSheet('sheetCapture', 'Was möchtest du tun?', `
    <div class="capture-grid">
      <button class="capture-opt featured" onclick="window.app.closeSheet('sheetCapture'); openShoppingTrip();">
        <span class="co-icon"><i class="ph-bold ph-shopping-cart-simple"></i></span>
        <span>
          <div class="co-title">Einkaufstour starten</div>
          <div class="co-sub">Liste abhaken &amp; Preise loggen</div>
        </span>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); startScanFlow();">
        <span class="co-icon"><i class="ph ph-barcode"></i></span>
        <div class="co-title">Scannen</div>
        <div class="co-sub">Barcode erfassen</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddItemModal();">
        <span class="co-icon"><i class="ph ph-package"></i></span>
        <div class="co-title">Artikel</div>
        <div class="co-sub">Manuell hinzufügen</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddTaskModal();">
        <span class="co-icon"><i class="ph ph-check-circle"></i></span>
        <div class="co-title">Aufgabe</div>
        <div class="co-sub">Neue Aufgabe anlegen</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddExpenseModal();">
        <span class="co-icon"><i class="ph ph-currency-eur"></i></span>
        <div class="co-title">Ausgabe</div>
        <div class="co-sub">Kosten festhalten</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddShoppingModal();">
        <span class="co-icon"><i class="ph ph-list-plus"></i></span>
        <div class="co-title">Zur Liste</div>
        <div class="co-sub">Ohne Tour hinzufügen</div>
      </button>
    </div>
  `);
}

Object.assign(window as any, { openCaptureSheet });
