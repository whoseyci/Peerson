import type { App } from '../app';
import { t } from '../i18n';

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
  app.showSheet('sheetCapture', t('capture.title'), `
    <div class="capture-grid">
      <button class="capture-opt featured" onclick="window.app.closeSheet('sheetCapture'); openShoppingTrip();">
        <span class="co-icon"><i class="ph-bold ph-shopping-cart-simple"></i></span>
        <span>
          <div class="co-title">${t('capture.shoppingTrip')}</div>
          <div class="co-sub">${t('capture.tripSub')}</div>
        </span>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); startScanFlow();">
        <span class="co-icon"><i class="ph ph-barcode"></i></span>
        <div class="co-title">${t('capture.scan')}</div>
        <div class="co-sub">${t('capture.scanSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openReceiptScanModal();">
        <span class="co-icon"><i class="ph ph-receipt"></i></span>
        <div class="co-title">${t('capture.receipt')}</div>
        <div class="co-sub">${t('capture.receiptSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddItemModal();">
        <span class="co-icon"><i class="ph ph-package"></i></span>
        <div class="co-title">${t('capture.item')}</div>
        <div class="co-sub">${t('capture.itemSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddTaskModal();">
        <span class="co-icon"><i class="ph ph-check-circle"></i></span>
        <div class="co-title">${t('capture.task')}</div>
        <div class="co-sub">${t('capture.taskSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddExpenseModal();">
        <span class="co-icon"><i class="ph ph-currency-eur"></i></span>
        <div class="co-title">${t('capture.expense')}</div>
        <div class="co-sub">${t('capture.expenseSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); openAddShoppingModal();">
        <span class="co-icon"><i class="ph ph-list-plus"></i></span>
        <div class="co-title">${t('capture.addToList')}</div>
        <div class="co-sub">${t('capture.addToListSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); window.app.navigate('shopping');">
        <span class="co-icon"><i class="ph ph-list-checks"></i></span>
        <div class="co-title">${t('capture.shoppingList')}</div>
        <div class="co-sub">${t('capture.shoppingListSub')}</div>
      </button>
      <button class="capture-opt" onclick="window.app.closeSheet('sheetCapture'); window.app.navigate('tasks');">
        <span class="co-icon"><i class="ph ph-list-checks"></i></span>
        <div class="co-title">${t('capture.allTasks')}</div>
        <div class="co-sub">${t('capture.allTasksSub')}</div>
      </button>
    </div>
  `);
}

Object.assign(window as any, { openCaptureSheet });
