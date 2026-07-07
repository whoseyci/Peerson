import { test, expect, type Page } from '@playwright/test';

const germanLabelPatterns = [
  /\bAufgaben\b/i,
  /Alle Aufgaben ansehen/i,
  /\bAufgabe\b/i,
  /Neue Aufgabe/i,
  /Aufgabe bearbeiten/i,
  /Offen\b/i,
  /Erledigt\b/i,
  /Einmalig|Täglich|Wöchentlich|Monatlich|Nach Bedarf/i,
  /Zugewiesen an|Fällig am|Wiederholung|Beschreibung|Titel\b/i,
  /Checkliste|Unteraufgaben|Schritt hinzufügen/i,
  /\bEinkaufen\b|Einkaufsliste|Einkaufstour|Zur Liste/i,
  /\bAusgabe\b|Ausgaben|Finanzen|Schulden|ausgleichen/i,
  /\bArtikel\b|Bestand|Menge|Preis|MHD|Kategorie|\bOrt\b|\bRaum\b|Bereich/i,
  /Hinzufügen|Speichern|Löschen|Bearbeiten|Entfernen|Abbrechen/i,
  /Noch keine|Keine |Nichts auf der Liste|Fehler beim|Erfolgreich/i,
  /Haushalt|Mitglieder|Einladen|Kopieren/i,
  /Scannen|Beleg|Kassenbon|Foto/i,
];

const allowedGermanFragments = [
  // German is allowed as the visible language names in the language picker.
  'Deutsch',
  // User-created content would be allowed, but the seeded data below is English.
];

async function seedEnglishApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('peerson_language', 'en');
    const now = Math.floor(Date.now() / 1000);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const app = (window as any).app;
    app.state = {
      ...app.state,
      userId: 'u1',
      userName: 'Alice',
      householdId: 'h1',
      household: { id: 'h1', name: 'Shared Flat', invite_code: 'ABCDEFGH', created_at: now },
      members: [
        { id: 'u1', name: 'Alice', role: 'admin', joined_at: now - 10000 },
        { id: 'u2', name: 'Bob', role: 'member', joined_at: now - 8000 },
      ],
      locations: [
        { id: 'room-1', household_id: 'h1', parent_id: null, name: 'Kitchen', sort_order: 0 },
        { id: 'shelf-1', household_id: 'h1', parent_id: 'room-1', name: 'Fridge', sort_order: 0 },
      ],
      items: [
        { id: 'item-1', household_id: 'h1', name: 'Milk', category: 'milch', icon: 'drop', threshold: 2, location_id: 'shelf-1', barcodes: [], nutrition: {}, price_cents: 129 },
        { id: 'item-2', household_id: 'h1', name: 'Rice', category: 'getreide', icon: 'bowl-food', threshold: 1, location_id: null, barcodes: [], nutrition: {}, price_cents: 249 },
      ],
      batches: [
        { id: 'b1', item_id: 'item-1', quantity: 1, expiry: tomorrow, grams_per_unit: 1000, date_added: now - 5000, price: 1.29, location_id: 'shelf-1' },
        { id: 'b2', item_id: 'item-2', quantity: 3, expiry: inFiveDays, grams_per_unit: 500, date_added: now - 5000, price: 2.49, location_id: null },
      ],
      tasks: [
        { id: 'task-1', household_id: 'h1', title: 'Clean kitchen', description: 'Wipe counters', assigned_to: 'u1', status: 'todo', due_date: tomorrow, recurrence: 'weekly', rotation_users: ['u1', 'u2'], subtasks: [{ id: 'st1', text: 'Wipe counter', done: false }] },
        { id: 'task-2', household_id: 'h1', title: 'Take bins out', description: '', assigned_to: null, status: 'done', due_date: '', recurrence: null, rotation_users: null, subtasks: null },
      ],
      taskCompletions: [
        { id: 'tc1', task_id: 'task-2', household_id: 'h1', completed_by: 'u2', completed_at: now - 1000 },
      ],
      expenses: [
        { id: 'e1', household_id: 'h1', title: 'Groceries', amount: 30, paid_by: 'u1', split_type: 'equal', category: 'groceries', created_at: now - 2000 },
      ],
      splits: [
        { id: 'sp1', expense_id: 'e1', user_id: 'u1', amount: 15, settled: 0 },
        { id: 'sp2', expense_id: 'e1', user_id: 'u2', amount: 15, settled: 0 },
      ],
      categoryBudgets: [
        { id: 'cb1', household_id: 'h1', category: 'groceries', monthly_amount: 20, created_at: now - 5000 },
      ],
      shopping: [
        { id: 'shop-1', household_id: 'h1', name: 'Bread', quantity: '1 loaf', requested_by: 'u1', status: 'open', linked_item_id: '', price: null },
        { id: 'shop-2', household_id: 'h1', name: 'Eggs', quantity: '12', requested_by: 'u1', status: 'bought', linked_item_id: '', price: 3.2 },
      ],
      roomsNav: { roomId: null, containerId: null },
      view: 'home',
    };
    app.setAppLanguage('en');
  });
}

async function visibleText(page: Page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
}

function findGerman(text: string) {
  return germanLabelPatterns
    .flatMap((pattern) => {
      const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) || [];
      return matches.map((match) => match.trim());
    })
    .filter((match, index, arr) => arr.indexOf(match) === index)
    .filter((match) => !allowedGermanFragments.some((allowed) => match.includes(allowed)));
}

async function assertNoGerman(page: Page, label: string) {
  const text = await visibleText(page);
  const matches = findGerman(text);
  expect(matches, `${label}\nVisible text:\n${text}`).toEqual([]);
}

test.describe('full visible i18n audit', () => {
  test('English UI has no obvious leftover German labels across reachable surfaces', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await seedEnglishApp(page);
    await assertNoGerman(page, 'home');

    await page.evaluate(() => (window as any).openCaptureSheet());
    await assertNoGerman(page, 'capture sheet');
    await page.evaluate(() => (window as any).app.closeSheet('sheetCapture'));

    await page.evaluate(() => (window as any).app.navigate('tasks'));
    await assertNoGerman(page, 'tasks view');
    await page.evaluate(() => (window as any).openAddTaskModal());
    await assertNoGerman(page, 'add task modal');
    await page.evaluate(() => (window as any).app.closeModal('taskModal'));
    await page.evaluate(() => (window as any).openEditTaskModal('task-1'));
    await assertNoGerman(page, 'edit task modal');
    await page.evaluate(() => (window as any).app.closeModal('taskModal'));

    await page.evaluate(() => (window as any).app.navigate('shopping'));
    await assertNoGerman(page, 'shopping view');
    await page.evaluate(() => (window as any).openAddShoppingModal());
    await assertNoGerman(page, 'add shopping modal');
    await page.evaluate(() => (window as any).app.closeModal('shopModal'));

    await page.evaluate(() => (window as any).app.navigate('rooms'));
    await assertNoGerman(page, 'rooms root');
    await page.evaluate(() => (window as any).navigateToRoom('room-1'));
    await assertNoGerman(page, 'room detail');
    await page.evaluate(() => (window as any).navigateToContainer('shelf-1'));
    await assertNoGerman(page, 'container detail');
    await page.evaluate(() => (window as any).openAddRoomModal('shelf-1'));
    await assertNoGerman(page, 'add area modal');
    await page.evaluate(() => (window as any).app.closeModal('addRoomModal'));
    await page.evaluate(() => (window as any).openMoveItemModal('item-1', 'shelf-1'));
    await assertNoGerman(page, 'move item modal');
    await page.evaluate(() => (window as any).app.closeModal('moveItemModal'));

    await page.evaluate(() => (window as any).app.navigate('people'));
    await assertNoGerman(page, 'people view');
    await page.evaluate(() => (window as any).openPersonDetail('u2'));
    await assertNoGerman(page, 'person detail');
    await page.evaluate(() => (window as any).app.closeModal('personDetailModal'));
    await page.evaluate(() => (window as any).openSettleModal());
    await assertNoGerman(page, 'settle modal');
    await page.evaluate(() => (window as any).app.closeModal('settleModal'));
    await page.evaluate(() => (window as any).openAddExpenseModal());
    await assertNoGerman(page, 'add expense modal');
    await page.evaluate(() => (window as any).app.closeModal('expenseModal'));

    await page.evaluate(() => (window as any).app.navigate('household'));
    await assertNoGerman(page, 'household view');

    expect(errors).toEqual([]);
  });
});
