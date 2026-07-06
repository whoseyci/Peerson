import type { Batch, Item, Location } from '../types';

// A batch's *effective* location: its own location_id if explicitly set,
// otherwise its parent item's location_id (see Batch.location_id's doc
// comment in src/types/index.ts). Every Rooms-view stock computation goes
// through this rather than reading batch.location_id directly, so a
// batch that's never been individually relocated still shows up exactly
// where the item itself lives -- the pre-existing single-location-per-item
// behavior, now just expressed as "no override" rather than the only
// possible state.
export function effectiveBatchLocation(batch: Batch, item: Item | undefined): string | null {
  if (batch.location_id !== undefined && batch.location_id !== null) return batch.location_id;
  return item?.location_id ?? null;
}

// Every location id in `rootId`'s subtree, including itself -- walks
// parent_id pointers downward (not upward like inventory.ts's
// locationPath, which walks up to build a breadcrumb). Used to answer
// "does this batch live anywhere inside this room" for a room-level
// (not just exact-location) summary.
export function subtreeLocationIds(locations: Location[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    locations.forEach(l => {
      if (l.parent_id && ids.has(l.parent_id) && !ids.has(l.id)) {
        ids.add(l.id);
        changed = true;
      }
    });
  }
  return ids;
}

// Consistent "use it up in this order" ordering for consuming stock,
// shared by removeOne()/removeOneAt() in inventory.ts, the Rooms view's
// "-" stepper, and the /api/batches/move endpoint. Deliberately matches
// inventory.ts's pre-existing removeOne()/openItemDetail() sort byte for
// byte (`(a.expiry || '').localeCompare(b.expiry || '')`) rather than
// "improving" it here -- that sort treats a batch with NO expiry as
// sorting *before* any dated batch (empty string < any date string),
// i.e. undated stock gets used first. That's an existing, already-shipped
// behavior; this is purely extracting it into one shared place so
// inventory.ts, rooms.ts, and the move endpoint's ordering can never
// silently drift apart, not a chance to quietly change what it does.
export function sortBatchesFifo<T extends { expiry?: string | null }>(batches: T[]): T[] {
  return [...batches].sort((a, b) => (a.expiry || '').localeCompare(b.expiry || ''));
}

export interface ItemStockAtLocation {
  item: Item;
  quantity: number;
}

// Items with stock physically at exactly `locationId` (not its
// descendants) -- the quantity returned is only the portion at this
// specific location, not the item's grand total across everywhere it
// might also have batches. An item that has never had any stock logged
// at all, but is nominally "assigned" to this exact location via its own
// location_id, still appears with quantity 0 -- so creating an item and
// pointing it at a room continues to make it visible there immediately,
// matching the pre-existing single-location behavior, even before any
// batch exists to derive a location from.
export function itemsAtLocation(items: Item[], batches: Batch[], locationId: string): ItemStockAtLocation[] {
  const byItem = new Map(items.map(i => [i.id, i]));
  const totalsAtLocation = new Map<string, number>();
  const hasAnyBatch = new Set<string>();

  for (const batch of batches) {
    const item = byItem.get(batch.item_id);
    if (!item) continue;
    hasAnyBatch.add(batch.item_id);
    if (effectiveBatchLocation(batch, item) === locationId) {
      totalsAtLocation.set(batch.item_id, (totalsAtLocation.get(batch.item_id) || 0) + batch.quantity);
    }
  }

  const result: ItemStockAtLocation[] = [];
  items.forEach(item => {
    if (totalsAtLocation.has(item.id)) {
      result.push({ item, quantity: totalsAtLocation.get(item.id)! });
    } else if (!hasAnyBatch.has(item.id) && (item.location_id ?? null) === locationId) {
      result.push({ item, quantity: 0 });
    }
  });
  return result;
}

// How many distinct items currently have any stock (quantity > 0)
// anywhere within a room's subtree -- used for a room tile's "N Artikel"
// summary, which should count an item once even if it's split across a
// room and one of its own containers.
export function itemCountInSubtree(items: Item[], batches: Batch[], locations: Location[], rootId: string): number {
  const ids = subtreeLocationIds(locations, rootId);
  const byItem = new Map(items.map(i => [i.id, i]));
  const withStock = new Set<string>();
  for (const batch of batches) {
    const item = byItem.get(batch.item_id);
    if (!item || batch.quantity <= 0) continue;
    const loc = effectiveBatchLocation(batch, item);
    if (loc && ids.has(loc)) withStock.add(batch.item_id);
  }
  return withStock.size;
}

// Low-stock alert count for a room tile's badge. "Low stock" is always
// evaluated against an item's *global* total (Item.threshold means "keep
// at least this many in the household overall", not "...in this one
// room") -- but only items that actually have some presence in this
// subtree are counted, so a room's badge only ever points at things
// actually stored there.
export function lowStockAlertCountInSubtree(items: Item[], batches: Batch[], locations: Location[], rootId: string): number {
  const ids = subtreeLocationIds(locations, rootId);
  const byItem = new Map(items.map(i => [i.id, i]));
  const presentInSubtree = new Set<string>();
  const globalTotal = new Map<string, number>();

  for (const batch of batches) {
    const item = byItem.get(batch.item_id);
    if (!item) continue;
    globalTotal.set(batch.item_id, (globalTotal.get(batch.item_id) || 0) + batch.quantity);
    const loc = effectiveBatchLocation(batch, item);
    if (loc && ids.has(loc)) presentInSubtree.add(batch.item_id);
  }

  let count = 0;
  presentInSubtree.forEach(itemId => {
    const item = byItem.get(itemId)!;
    if ((globalTotal.get(itemId) || 0) < item.threshold) count++;
  });
  return count;
}
