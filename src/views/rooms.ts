import type { App } from '../app';
import type { Location } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';
import { CATEGORY_META, formatDate, getDays, getItemIcon, locationPath, locationSelectOptions } from './inventory';
import {
  itemsAtLocation,
  itemsWithNoLocation,
  itemCountInSubtree as itemCountInSubtreeStock,
  lowStockAlertCountInSubtree,
} from '../utils/roomStock';
import { t } from '../i18n';

const ROOM_ICON = 'door-open';
const CONTAINER_ICON = 'archive';

function childrenOf(locations: Location[], parentId: string | null): Location[] {
  return locations
    .filter(l => (l.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function renderRoomsView(app: App) {
  const s = app.state;
  const nav = s.roomsNav;

  if (nav.containerId) {
    const container = s.locations.find(l => l.id === nav.containerId);
    if (container) return renderContainerLevel(app, container);
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
      <h1><i class="ph ph-grid-four"></i> ${t('rooms.title')}</h1>
      <button class="icon-btn" onclick="openAddRoomModal(null)" title="${t('rooms.newRoom')}"><i class="ph ph-plus"></i></button>
    </div>

    ${renderBreadcrumb(app, [{ label: t('rooms.title'), onclick: null }])}

    <div class="room-search">
      <i class="ph ph-magnifying-glass"></i>
      <input type="text" id="roomsSearch" placeholder="${t('rooms.search')}" oninput="filterRoomsSearch(this.value)">
    </div>
    <div id="roomsSearchResults"></div>

    ${renderExpiryCheckSection(app)}

    ${roots.length ? `
    <div class="room-grid" id="roomsGrid">
      ${roots.map(r => {
        const count = itemCountInSubtreeStock(s.items, s.batches, s.locations, r.id);
        const alerts = lowStockAlertCountInSubtree(s.items, s.batches, s.locations, r.id);
        return `
        <button class="room-tile" onclick="navigateToRoom('${escapeJsAttr(r.id)}')">
          ${alerts ? `<span class="rt-badge">${alerts}</span>` : ''}
          <span class="rt-icon"><i class="ph ph-${ROOM_ICON}"></i></span>
          <span>
            <div class="rt-name">${escapeHtml(r.name)}</div>
            <div class="rt-meta">${t('rooms.items', { count })}</div>
          </span>
        </button>`;
      }).join('')}
      <button class="room-tile add-tile" onclick="openAddRoomModal(null)">
        <i class="ph ph-plus" style="font-size:26px;"></i>
        <span>${t('rooms.addRoom')}</span>
      </button>
    </div>` : `
    <div class="empty-state">
      ${t('rooms.noRooms')}
      <div style="margin-top:12px;"><button class="btn" style="width:auto; padding:12px 20px;" onclick="openAddRoomModal(null)"><i class="ph-bold ph-plus"></i> ${t('rooms.createFirst')}</button></div>
    </div>`}

    ${renderNoLocationSection(app)}
  `;
}

// A wider-window (30-day) "check the use-by date soon" list -- distinct
// from (and in addition to) Home's urgent feed, which only surfaces
// batches expiring within 3 days. This is a straight port of the old
// standalone Vorrat page's "Check MHD" section (same 30-day window, same
// sort-soonest-first order, same danger/warning color thresholds) so
// nothing about that longer-lead-time visibility is lost now that page
// is gone -- someone doing a weekly room tidy-up still wants to spot a
// batch expiring in 3 weeks, not just the ones already urgent enough for
// Home's feed.
function renderExpiryCheckSection(app: App) {
  const s = app.state;
  const expiring = s.batches
    .filter((b: any) => b.quantity > 0 && b.expiry && getDays(b.expiry) <= 30)
    .map(b => ({ ...b, item: s.items.find((i: any) => i.id === b.item_id), days: getDays(b.expiry) }))
    .filter((x: any) => x.item)
    .sort((a: any, b: any) => a.days - b.days);
  if (!expiring.length) return '';
  return `
    <div class="section">
      <div class="section-header">
        <div class="section-title"><i class="ph ph-clock"></i> ${t('rooms.expiryCheck')}</div>
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
              <div class="card-meta">${b.days < 0 ? t('rooms.expired') : t('rooms.days', { count: b.days })} · ${formatDate(b.expiry)}</div>
            </div>
          </div>
        </div>
      `}).join('')}
    </div>`;
}

// A catch-all bucket for items that have never been given any location at
// all (no item-level location_id and no per-batch override) -- without
// this, such an item would be invisible in this location-indexed view
// entirely, since every other section here is keyed by room/container.
function renderNoLocationSection(app: App) {
  const s = app.state;
  const orphans = itemsWithNoLocation(s.items, s.batches);
  if (!orphans.length) return '';
  return `
    <div class="section">
      <div class="section-header"><div class="section-title">${t('rooms.noFixedPlace')}</div><span class="badge">${orphans.length}</span></div>
      ${orphans.map(({ item, quantity }) => renderRoomItemRow(item, quantity, null)).join('')}
    </div>`;
}

function renderRoomLevel(app: App, room: Location) {
  const s = app.state;
  const containers = childrenOf(s.locations, room.id);
  const directItems = itemsAtLocation(s.items, s.batches, room.id);

  return `
    <div class="header">
      <h1><i class="ph ph-${ROOM_ICON}"></i> ${escapeHtml(room.name)}</h1>
      <button class="icon-btn" onclick="openAddRoomModal('${escapeJsAttr(room.id)}')" title="${t('hh.addSubLocation')}"><i class="ph ph-plus"></i></button>
    </div>

    ${renderBreadcrumb(app, [
      { label: t('rooms.title'), onclick: 'navigateToRoot()' },
      { label: room.name, onclick: null },
    ])}

    ${containers.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">${t('rooms.areas')}</div></div>
      ${containers.map(c => {
        const count = itemCountInSubtreeStock(s.items, s.batches, s.locations, c.id);
        return `
        <div class="container-row" onclick="navigateToContainer('${escapeJsAttr(c.id)}')">
          <div class="cr-icon"><i class="ph ph-${CONTAINER_ICON}"></i></div>
          <div class="cr-text">
            <div class="cr-title">${escapeHtml(c.name)}</div>
            <div class="cr-sub">${t('rooms.items', { count })}</div>
          </div>
          <i class="ph ph-caret-right" style="color:var(--text-soft);"></i>
        </div>`;
      }).join('')}
    </div>` : ''}

    <button class="add-row-dashed" onclick="openAddRoomModal('${escapeJsAttr(room.id)}')"><i class="ph ph-plus"></i> ${t('rooms.addArea')}</button>

    <div class="section">
      <div class="section-header"><div class="section-title">${t('rooms.itemsHere')}</div><span class="badge">${directItems.length}</span></div>
      ${directItems.length ? directItems.map(({ item, quantity }) => renderRoomItemRow(item, quantity, room.id)).join('') : `<div class="empty-state">${t('rooms.noItems', { name: escapeHtml(room.name) })}</div>`}
    </div>
  `;
}

function renderContainerLevel(app: App, container: Location) {
  const s = app.state;
  const room = s.locations.find(l => l.id === container.parent_id);
  const directItems = itemsAtLocation(s.items, s.batches, container.id);
  const subContainers = childrenOf(s.locations, container.id);

  return `
    <div class="header">
      <h1><i class="ph ph-${CONTAINER_ICON}"></i> ${escapeHtml(container.name)}</h1>
      <button class="icon-btn" onclick="openAddRoomModal('${escapeJsAttr(container.id)}')" title="${t('hh.addSubLocation')}"><i class="ph ph-plus"></i></button>
    </div>

    ${renderBreadcrumb(app, [
      { label: t('rooms.title'), onclick: 'navigateToRoot()' },
      { label: room ? room.name : '…', onclick: room ? `navigateToRoom('${escapeJsAttr(room.id)}')` : null },
      { label: container.name, onclick: null },
    ])}

    ${subContainers.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">${t('rooms.areas')}</div></div>
      ${subContainers.map(c => `
        <div class="container-row" onclick="navigateToContainer('${escapeJsAttr(c.id)}')">
          <div class="cr-icon"><i class="ph ph-${CONTAINER_ICON}"></i></div>
          <div class="cr-text">
            <div class="cr-title">${escapeHtml(c.name)}</div>
            <div class="cr-sub">${t('rooms.items', { count: itemCountInSubtreeStock(s.items, s.batches, s.locations, c.id) })}</div>
          </div>
          <i class="ph ph-caret-right" style="color:var(--text-soft);"></i>
        </div>
      `).join('')}
    </div>` : ''}

    <button class="add-row-dashed" onclick="openAddRoomModal('${escapeJsAttr(container.id)}')"><i class="ph ph-plus"></i> ${t('rooms.addArea')}</button>

    <div class="section">
      <div class="section-header"><div class="section-title">${t('rooms.itemsHere')}</div><span class="badge">${directItems.length}</span></div>
      ${directItems.length ? directItems.map(({ item, quantity }) => renderRoomItemRow(item, quantity, container.id)).join('') : `<div class="empty-state">${t('rooms.noItemsHere')}</div>`}
    </div>
  `;
}

// `locationId` is where this row is being rendered (the room/container
// currently on screen) -- distinct from the item's own (global)
// location_id, since a batch can sit somewhere different (see
// Batch.location_id). Every action on this row (steppers, move) is
// scoped to exactly this location, not the item as a whole.
function renderRoomItemRow(item: any, quantity: number, locationId: string | null) {
  const icon = escapeAttr(getItemIcon(item));
  const itemId = escapeJsAttr(item.id);
  // A real (quoted) JS string for an actual location, vs. the bare
  // `null` literal for "no location" -- these functions all distinguish
  // "empty string" from "null" (see e.g. functions/api/batches/move.ts's
  // `from_location_id ?? null`), so this must NOT collapse to `''` the
  // way wrapping escapeJsAttr(null) in quotes would.
  const locArg = locationId === null ? 'null' : `'${escapeJsAttr(locationId)}'`;
  return `
    <div class="room-item-row">
      <div class="ir-icon" style="cursor:pointer;" onclick="openItemDetail('${itemId}')"><i class="ph ph-${icon}"></i></div>
      <div class="ir-text" style="cursor:pointer;" onclick="openItemDetail('${itemId}')">
        <div class="ir-title">${escapeHtml(item.name)}</div>
        <div class="ir-sub">${escapeHtml(t(`inventory.cat.${item.category}`) || CATEGORY_META[item.category]?.label || item.category)}${quantity < item.threshold ? ' · <span style="color:var(--warning); font-weight:700;">' + t('rooms.low') + '</span>' : ''}</div>
      </div>
      <button class="icon-btn" style="width:34px; height:34px; font-size:15px;" onclick="openMoveItemModal('${itemId}', ${locArg})" title="${t('rooms.move')}" aria-label="${t('rooms.moveItem', { name: escapeHtml(item.name) })}"><i class="ph ph-arrows-out-cardinal"></i></button>
      <div class="room-stepper">
        <button onclick="removeOneAt('${itemId}', ${locArg})" aria-label="${t('rooms.takeOne')}"><i class="ph ph-minus"></i></button>
        <span class="rs-qty">${quantity}</span>
        <button onclick="openAddStock('${itemId}', null, ${locArg})" aria-label="${t('rooms.addStock')}"><i class="ph ph-plus"></i></button>
      </div>
    </div>`;
}

// ── Navigation ─────────────────────────────────────────────────────

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

// ── Search ──────────────────────────────────────────────────────────

export function filterRoomsSearch(term: string) {
  const app = (window as any).app as App;
  const el = document.getElementById('roomsSearchResults');
  if (!el) return;
  const q = term.trim().toLowerCase();
  if (!q) { el.innerHTML = ''; return; }

  const matches = app.state.items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
  if (!matches.length) {
    el.innerHTML = `<div class="empty-state">${t('rooms.noResults')}</div>`;
    return;
  }
  el.innerHTML = matches.map(i => {
    const loc = i.location_id ? app.state.locations.find(l => l.id === i.location_id) : null;
    const path = loc ? locationPath(loc.id, app.state.locations) : t('rooms.noLocation');
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

// ── Add room / container modal ──────────────────────────────────────

export function openAddRoomModal(parentId: string | null) {
  const app = (window as any).app as App;
  const parent = parentId ? app.state.locations.find(l => l.id === parentId) : null;
  (window as any)._addRoomParentId = parentId;
  app.showModal('addRoomModal', `
    <div class="modal-header">
      <div class="modal-title">${parent ? t('rooms.addArea') : t('rooms.newRoom')}</div>
      <button class="close-btn" onclick="window.app.closeModal('addRoomModal')"><i class="ph ph-x"></i></button>
    </div>
    <div class="modal-body">
      ${parent ? `<div style="margin-bottom:12px; color:var(--text-soft); font-size:13px;">${t('rooms.inParent', { name: escapeHtml(parent.name) })}</div>` : ''}
      <div class="form-group"><label>${t('rooms.name')}</label><input type="text" id="newRoomName" placeholder="${parent ? t('rooms.placeArea') : t('rooms.placeRoom')}"></div>
      <button class="btn" onclick="saveAddRoomModal()"><i class="ph-bold ph-check"></i> ${t('action.save')}</button>
    </div>
  `);
}

export async function saveAddRoomModal() {
  const app = (window as any).app as App;
  const api = (window as any).api;
  const name = (document.getElementById('newRoomName') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast(t('rooms.nameRequired'));
  const parentId = (window as any)._addRoomParentId as string | null;
  try {
    const res = await api.locations.create({ household_id: app.state.householdId, name, parent_id: parentId });
    app.state.locations.push(res.location);
    app.closeModal('addRoomModal');
    app.render();
    app.toast(parentId ? t('rooms.areaAdded') : t('rooms.roomAdded'));
  } catch (e) {
    app.toast(t('rooms.addError'));
  }
}

// ── Move item between locations ────────────────────────────────────

export function openMoveItemModal(itemId: string, fromLocationId: string | null) {
  const app = (window as any).app as App;
  const item = app.state.items.find(i => i.id === itemId);
  if (!item) return;
  const available = fromLocationId
    ? (itemsAtLocation([item], app.state.batches, fromLocationId)[0]?.quantity ?? 0)
    : (itemsWithNoLocation([item], app.state.batches)[0]?.quantity ?? 0);
  const fromPath = fromLocationId ? (locationPath(fromLocationId, app.state.locations) || t('rooms.noPlace')) : t('rooms.noPlace');

  // Default the destination to any location OTHER than where the item
  // already is -- defaulting to no location would make the common case
  // (moving to another room) require an extra deliberate selection.
  const defaultTarget = app.state.locations.find(l => l.id !== fromLocationId)?.id ?? null;

  const fromArg = fromLocationId === null ? 'null' : `'${escapeJsAttr(fromLocationId)}'`;
  app.showModal('moveItemModal', `
    <div class="modal-header">
      <div class="modal-title"><i class="ph ph-arrows-out-cardinal"></i> ${t('rooms.moveItem', { name: escapeHtml(item.name) })}</div>
      <button class="close-btn" onclick="window.app.closeModal('moveItemModal')"><i class="ph ph-x"></i></button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:14px; color:var(--text-soft); font-size:13px;">${t('rooms.moveFrom', { path: '<strong>' + escapeHtml(fromPath) + '</strong>', count: String(available) })}</div>
      <div class="form-group"><label>${t('rooms.moveQty')}</label><input type="number" id="moveQty" value="${Math.min(1, available) || 1}" min="1" max="${available || 1}"></div>
      <div class="form-group"><label>${t('rooms.moveTo')}</label><select id="moveToLocation">${locationSelectOptions(app.state.locations, defaultTarget)}</select></div>
      <button class="btn" onclick="commitMoveItem('${escapeJsAttr(itemId)}', ${fromArg})"><i class="ph-bold ph-check"></i> ${t('rooms.moveConfirm')}</button>
    </div>
  `);
}

export async function commitMoveItem(itemId: string, fromLocationId: string | null) {
  const app = (window as any).app as App;
  const api = (window as any).api;
  try {
    const qty = parseInt((document.getElementById('moveQty') as HTMLInputElement)?.value) || 0;
    const toLocationId = (document.getElementById('moveToLocation') as HTMLSelectElement)?.value || null;
    if (qty <= 0) return app.toast(t('rooms.moveQtyError'));
    if (toLocationId === fromLocationId) return app.toast(t('rooms.moveSameLocation'));

    const result = await api.batches.move({
      item_id: itemId,
      from_location_id: fromLocationId || null,
      to_location_id: toLocationId,
      quantity: qty,
    });
    app.state.batches = app.state.batches.filter(b => b.item_id !== itemId).concat(result.batches);
    app.closeModal('moveItemModal');
    app.render();
    app.toast(result.moved < qty ? t('rooms.movePartial', { moved: String(result.moved), qty: String(qty) }) : t('rooms.moved'));
  } catch (e) {
    app.toast(t('rooms.moveError'));
  }
}

Object.assign(window as any, {
  navigateToRoot,
  navigateToRoom,
  navigateToContainer,
  filterRoomsSearch,
  openAddRoomModal,
  saveAddRoomModal,
  openMoveItemModal,
  commitMoveItem,
});
