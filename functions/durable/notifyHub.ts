// Lightweight helper for API endpoints to notify a household's Durable Object sync hub.
// Degrades gracefully when HOUSEHOLD_SYNC is not bound (e.g. in pure Pages Functions
// or test environments) without throwing errors or failing the database transaction.

export async function notifyHouseholdSync(
  env: any,
  householdId: string,
  event: { type: string; householdId: string; payload?: any }
): Promise<boolean> {
  try {
    if (!env || !env.HOUSEHOLD_SYNC) return false;
    const id = env.HOUSEHOLD_SYNC.idFromName(householdId);
    const stub = env.HOUSEHOLD_SYNC.get(id);
    await stub.fetch('http://durable/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return true;
  } catch (e) {
    // Silently ignore notification failures so primary CRUD responses never fail
    return false;
  }
}
