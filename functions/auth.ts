// Shared Pages Function authorization helpers. Kept inside the functions/
// tree so Cloudflare Pages Functions can import it without reaching into
// client-side src/ code, and so test/build.test.ts's functions-boundary guard
// stays satisfied.
export async function requireMember(db: D1Database, userId: string, householdId: string) {
  const row = await db.prepare('SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?')
    .bind(householdId, userId).first();
  if (!row) throw new Error('Forbidden');
}
