import type { App } from '../app';
import type { Location } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';
import { CATEGORY_META, getItemIcon, getTotal, locationPath } from './inventory';

// Icon shown for a room/container tile itself (distinct from an item's own
// category icon) -- kept intentionally simple/generic since a household's
// location names are freeform ("Küche", "Balkon", "Rollcontainer") and
// there's no reliable way to guess a more specific icon from the name
// alone. Root-level locations get the house-y "door-open" icon; anything
// nested one level deeper (a container within a room) gets a plain box.
const ROOM_ICON = 'door-open';
const CONTAINER_ICON = 'archive';

function childrenOf(locations: Location[], parentId: string | null): Location[] {
  return locations
    .filter(l => (l.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

// Every item directly assigned to this exact location id (not its
// descendants) plus a running low-stock count for the alert badge.
function itemsAt(app: App, locationId: string | null) {
  return app.state.items.filter(i => (i.location_id ?? null) === locationId);
}

function alertCountFor(app: App, locationId: string): number {
  // Counts low-stock items anywhere within this location's subtree (the
  // room itself plus every nested container), since a badge on the root
  // "Küche" tile should reflect a low-stock item sitting inside its
  // "Kühlschrank" container too -- otherwise the household has to drill
  // in just to discover there's anything to see.
  const descendantIds = new Set<string>([locationId]);
  let changed = true;
  while (changed) {
    changed = false;
    app.state.locations.forEach(l => {
      if (l.parent_id && descendantIds.has(l.parent_id) && !descendantIds.has(l.id)) {
        descendantIds.add(l.id);
        changed = true;
      }
    });
  }
  return app.state.items.filter(i => i.location_id && descendantIds.has(i.location_id) && getTotal(i.id, app.state.batches) < i.threshold).length;
}

function itemCountInSubtree(app: App, locationId: string): number {
  const descendantIds = new Set<string>([locationId]);
  let changed = true;
  while (changed) {
    changed = false;
    app.state.locations.forEach(l => {
      if (l.parent_id && descendantIds.has(l.parent_id) && !descendantIds.has(l.id)) {
        descendantIds.add(l.id);
        changed = true;
      }
    });
  }
  return app.state.items.filter(i => i.location_id && descendantIds.has(i.location_id)).length;
}

export function renderRoomsView(app: App) {
  const s = app.state;
  const nav = s.roomsNav;

  if (nav.containerId) {
    const container = s.locations.find(l => l.id === nav.containerId);
    if (container) return renderContainerLevel(app, container);
    // Container vanished (deleted elsewhere) -- fall back up a level
    // rather than rendering a broken/empty screen.
    s.roomsNav = { roomId: nav.roomId, containerId: null };
  }
  if (s.roomsNav.roomId) {
    const room = s.locations.find(l => l.id === s.roomsNav.roomId);
    if (room) return renderRoomLevel(app, room);
    s.roomsNav = { roomId: null, containerId: null };
  }
  return renderRootLevel(app);
}

function renderBreadcrumb(app: App, trail: Array<{ label: string; onclick: string | null }>) {
  return `
    <div class="breadcrumb-nav">
      ${trail.map((t, i) => `
        ${i > 0 ? '<span class="bc-sep">/</span>' : ''}
        ${t.onclick ? `<button onclick="${t.onclick}">${escapeHtml(t.label)}</button>` : `<button class="current">${escapeHtml(t.label)}</button>`}
      `).join('')}
    </div>`;
}

function renderRootLevel(app: App) {
  const s = app.state;
  const roots = childrenOf(s.locations, null);

  return `
    <div class="header">
      <h1><i class="ph ph-grid-four"></i> Räume</h1>
      <button class="icon-btn" onclick="openAddRoomModal(null)" title="Neuer Raum"><i class="ph ph-plus"></i></button>
    </div>

    ${renderBreadcrumb(app, [{ label: 'Räume', onclick: null }])}

    <div class="room-search">
      <i class="ph ph-magnifying-glass"></i>
      <input type="text" id="roomsSearch" placeholder="Artikel suchen..." oninput="filterRoomsSearch(this.value)">
    </div>
    <div id="roomsSearchResults"></div>

    ${roots.length ? `
    <div class="room-grid" id="roomsGrid">
      ${roots.map(r => {
        const count = itemCountInSubtree(app, r.id);
        const alerts = alertCountFor(app, r.id);
        return `
        <button class="room-tile" onclick="navigateToRoom('${escapeJsAttr(r.id)}')">
          ${alerts ? `<span class="rt-badge">${alerts}</span>` : ''}
          <span class="rt-icon"><i class="ph ph-${ROOM_ICON}"></i></span>
          <span>
            <div class="rt-name">${escapeHtml(r.name)}</div>
            <div class="rt-meta">${count} Artikel</div>
          </span>
        </button>`;
      }).join('')}
      <button class="room-tile add-tile" onclick="openAddRoomModal(null)">
        <i class="ph ph-plus" style="font-size:26px;"></i>
        <span>Raum hinzufügen</span>
      </button>
    </div>` : `
    <div class="empty-state">
      Noch keine Räume angelegt.
      <div style="margin-top:12px;"><button class="btn" style="width:auto; padding:12px 20px;" onclick="openAddRoomModal(null)"><i class="ph-bold ph-plus"></i> Ersten Raum anlegen</button></div>
    </div>`}
  `;
}

function renderRoomLevel(app: App, room: Location) {
  const s = app.state;
  const containers = childrenOf(s.locations, room.id);
  const directItems = itemsAt(app, room.id);

  return `
    <div class="header">
      <h1><i class="ph ph-${ROOM_ICON}"></i> ${escapeHtml(room.name)}</h1>
      <button class="icon-btn" onclick="openAddRoomModal('${escapeJsAttr(room.id)}')" title="Unterbereich hinzufügen"><i class="ph ph-plus"></i></button>
    </div>

    ${renderBreadcrumb(app, [
      { label: 'Räume', onclick: 'navigateToRoot()' },
      { label: room.name, onclick: null },
    ])}

    ${containers.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">Bereiche</div></div>
      ${containers.map(c => {
        const count = itemCountInSubtree(app, c.id);
        return `
        <div class="container-row" onclick="navigateToContainer('${escapeJsAttr(c.id)}')">
          <div class="cr-icon"><i class="ph ph-${CONTAINER_ICON}"></i></div>
          <div class="cr-text">
            <div class="cr-title">${escapeHtml(c.name)}</div>
            <div class="cr-sub">${count} Artikel</div>
          </div>
          <i class="ph ph-caret-right" style="color:var(--text-soft);"></i>
        </div>`;
      }).join('')}
    </div>` : ''}

    <button class="add-row-dashed" onclick="openAddRoomModal('${escapeJsAttr(room.id)}')"><i class="ph ph-plus"></i> Bereich hinzufügen</button>

    <div class="section">
      <div class="section-header"><div class="section-title">Artikel hier</div><span class="badge">${directItems.length}</span></div>
      ${directItems.length ? directItems.map(i => renderRoomItemRow(app, i)).join('') : `<div class="empty-state">Keine Artikel direkt in ${escapeHtml(room.name)}</div>`}
    </div>
  `;
}

function renderContainerLevel(app: App, container: Location) {
  const s = app.state;
  const room = s.locations.find(l => l.id === container.parent_id);
  const directItems = itemsAt(app, container.id);
  const subContainers = childrenOf(s.locations, container.id);

  return `
    <div class="header">
      <h1><i class="ph ph-${CONTAINER_ICON}"></i> ${escapeHtml(container.name)}</h1>
      <button class="icon-btn" onclick="openAddRoomModal('${escapeJsAttr(container.id)}')" title="Unterbereich hinzufügen"><i class="ph ph-plus"></i></button>
    </div>

    ${renderBreadcrumb(app, [
      { label: 'Räume', onclick: 'navigateToRoot()' },
      { label: room ? room.name : '…', onclick: room ? `navigateToRoom('${escapeJsAttr(room.id)}')` : null },
      { label: container.name, onclick: null },
    ])}

    ${subContainers.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">Bereiche</div></div>
      ${subContainers.map(c => `
        <div class="container-row" onclick="navigateToContainer('${escapeJsAttr(c.id)}')">
          <div class="cr-icon"><i class="ph ph-${CONTAINER_ICON}"></i></div>
          <div class="cr-text">
            <div class="cr-title">${escapeHtml(c.name)}</div>
            <div class="cr-sub">${itemCountInSubtree(app, c.id)} Artikel</div>
          </div>
          <i class="ph ph-caret-right" style="color:var(--text-soft);"></i>
        </div>
      `).join('')}
    </div>` : ''}

    <button class="add-row-dashed" onclick="openAddRoomModal('${escapeJsAttr(container.id)}')"><i class="ph ph-plus"></i> Bereich hinzufügen</button>

    <div class="section">
      <div class="section-header"><div class="section-title">Artikel hier</div><span class="badge">${directItems.length}</span></div>
      ${directItems.length ? directItems.map(i => renderRoomItemRow(app, i)).join('') : `<div class="empty-state">Keine Artikel hier</div>`}
    </div>
  `;
}

function renderRoomItemRow(app: App, item: any) {
  const total = getTotal(item.id, app.state.batches);
  const icon = escapeAttr(getItemIcon(item));
  const itemId = escapeJsAttr(item.id);
  return `
    <div class="room-item-row">
      <div class="ir-icon" style="cursor:pointer;" onclick="openItemDetail('${itemId}')"><i class="ph ph-${icon}"></i></div>
      <div class="ir-text" style="cursor:pointer;" onclick="openItemDetail('${itemId}')">
        <div class="ir-title">${escapeHtml(item.name)}</div>
        <div class="ir-sub">${escapeHtml(CATEGORY_META[item.category]?.label || item.category)}${total < item.threshold ? ' · <span style="color:var(--warning); font-weight:700;">niedrig</span>' : ''}</div>
      </div>
      <div class="room-stepper">
        <button onclick="removeOne('${itemId}')" aria-label="Eine Einheit entnehmen"><i class="ph ph-minus"></i></button>
        <span class="rs-qty">${total}</span>
        <button onclick="openAddStock('${itemId}')" aria-label="Bestand hinzufügen"><i class="ph ph-plus"></i></button>
      </div>
    </div>`;
}

// --- Navigation -----------------------------------------------------------

export function navigateToRoot() {
  const app = (window as any).app as App;
  app.state.roomsNav = { roomId: null, containerId: null };
  app.render();
}

export function navigateToRoom(roomId: string) {
  const app = (window as any).app as App;
  app.state.roomsNav = { roomId, containerId: null };
  app.render();
}

export function navigateToContainer(containerId: string) {
  const app = (window as any).app as App;
  const container = app.state.locations.find(l => l.id === containerId);
  // Keep the top-level room set to whichever root ancestor this container
  // belongs under, so the breadcrumb's middle segment is always correct
  // even when jumping straight to a container from search.
  let roomId = app.state.roomsNav.roomId;
  if (container) {
    let current: Location | undefined = container;
    let hops = 0;
    while (current && current.parent_id && hops < 20) {
      current = app.state.locations.find(l => l.id === current!.parent_id);
      hops++;
    }
    if (current) roomId = current.id;
  }
  app.state.roomsNav = { roomId, containerId };
  app.render();
}

// --- Search (jumps straight to an item's room/container) -----------------

export function filterRoomsSearch(term: string) {
  const app = (window as any).app as App;
  const el = document.getElementById('roomsSearchResults');
  if (!el) return;
  const q = term.trim().toLowerCase();
  if (!q) { el.innerHTML = ''; return; }

  const matches = app.state.items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) {
    el.innerHTML = `<div class="empty-state">Keine Treffer</div>`;
    return;
  }
  el.innerHTML = matches.map(i => {
    const loc = i.location_id ? app.state.locations.find(l => l.id === i.location_id) : null;
    const path = loc ? locationPath(loc.id, app.state.locations) : 'Kein Ort zugewiesen';
    const jumpTarget = loc ? (loc.parent_id ? `navigateToContainer('${escapeJsAttr(loc.id)}')` : `navigateToRoom('${escapeJsAttr(loc.id)}')`) : '';
    return `
      <div class="room-item-row" ${jumpTarget ? `onclick="${jumpTarget}"` : ''} style="${jumpTarget ? 'cursor:pointer;' : ''}">
        <div class="ir-icon"><i class="ph ph-${escapeAttr(getItemIcon(i))}"></i></div>
        <div class="ir-text">
          <div class="ir-title">${escapeHtml(i.name)}</div>
          <div class="ir-sub">${escapeHtml(path)}</div>
        </div>
        ${jumpTarget ? `<i class="ph ph-caret-right" style="color:var(--text-soft);"></i>` : ''}
      </div>`;
  }).join('');
}

// --- Add room / container modal -------------------------------------------

export function openAddRoomModal(parentId: string | null) {
  const app = (window as any).app as App;
  const parent = parentId ? app.state.locations.find(l => l.id === parentId) : null;
  (window as any)._addRoomParentId = parentId;
  app.showModal('addRoomModal', `
    <div class="modal-header">
      <div class="modal-title">${parent ? 'Bereich hinzufügen' : 'Neuer Raum'}</div>
      <button class="close-btn" onclick="window.app.closeModal('addRoomModal')"><i class="ph ph-x"></i></button>
    </div>
    <div class="modal-body">
      ${parent ? `<div style="margin-bottom:12px; color:var(--text-soft); font-size:13px;">In ${escapeHtml(parent.name)}</div>` : ''}
      <div class="form-group"><label>Name</label><input type="text" id="newRoomName" placeholder="${parent ? 'z. B. Kühlschrank' : 'z. B. Küche'}"></div>
      <button class="btn" onclick="saveAddRoomModal()"><i class="ph-bold ph-check"></i> Anlegen</button>
    </div>
  `);
}

export async function saveAddRoomModal() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const name = (document.getElementById('newRoomName') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast('Name erforderlich');
  const parentId = (window as any)._addRoomParentId as string | null;
  try {
    const res = await api.locations.create({ household_id: app.state.householdId, name, parent_id: parentId });
    app.state.locations.push(res.location);
    app.closeModal('addRoomModal');
    app.render();
    app.toast(parentId ? 'Bereich hinzugefügt' : 'Raum hinzugefügt');
  } catch (e) {
    app.toast('Fehler beim Anlegen');
  }
}

Object.assign(window as any, {
  navigateToRoot,
  navigateToRoom,
  navigateToContainer,
  filterRoomsSearch,
  openAddRoomModal,
  saveAddRoomModal,
});
