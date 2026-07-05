import type { App } from '../app';

export function renderShoppingView(app: App) {
  const s = app.state;
  const open = s.shopping.filter(x => x.status === 'open');
  const bought = s.shopping.filter(x => x.status === 'bought');

  const lowStockItems = s.items.filter(i => {
    const total = s.batches.filter(b => b.item_id === i.id).reduce((a, b) => a + b.quantity, 0);
    return total < i.threshold;
  });
  const missingLowStock = lowStockItems.filter(i => !s.shopping.some(sh => sh.linked_item_id === i.id && sh.status === 'open'));

  return `
    <div class="header">
      <h1><i class="ph ph-shopping-cart"></i> Einkaufen</h1>
      <button class="icon-btn" onclick="openAddShoppingModal()"><i class="ph ph-plus"></i></button>
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
      <div class="section-header"><div class="section-title">Offen</div><span class="badge">${open.length}</span></div>
      ${open.length ? open.map(item => `
        <div class="card">
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
            </div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}

    <script>
      async function openAddShoppingModal() {
        window.app.showModal('shopModal',
          '<div class="modal-header"><div class="modal-title">Zur Liste hinzufügen</div><button class="close-btn" onclick="window.app.closeModal(\\'shopModal\\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Artikel</label><input type="text" id="shopName" placeholder="Was wird gebraucht?"></div>' +
            '<div class="form-group"><label>Menge (optional)</label><input type="text" id="shopQty" placeholder="z. B. 2 Packungen"></div>' +
            '<button class="btn" onclick="saveShoppingItem()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }
      async function saveShoppingItem() {
        try {
          const name = document.getElementById('shopName').value.trim();
          if (!name) return window.app.toast('Name erforderlich');
          const item = await window.api.shopping.create({
            household_id: window.app.state.householdId,
            name,
            quantity: document.getElementById('shopQty').value || null
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
          const shop = await window.api.shopping.create({
            household_id: window.app.state.householdId,
            name: item.name,
            quantity: needed + ' Stk',
            linked_item_id: itemId
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
        try {
          await window.api.shopping.delete(id);
          window.app.state.shopping = window.app.state.shopping.filter(s => s.id !== id);
          window.app.render();
          window.app.toast('Entfernt');
        } catch (e) {
          window.app.toast('Fehler beim Entfernen');
        }
      }
    </script>
  `;
}
