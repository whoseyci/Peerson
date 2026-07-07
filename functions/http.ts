// Shared small HTTP helpers for Pages Functions. These intentionally preserve
// the existing error response shape used throughout functions/api/*:
// `{ error: string }` JSON with only a status code option.
export function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status });
}
