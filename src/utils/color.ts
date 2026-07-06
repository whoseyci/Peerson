// Deterministic color-hashing for avatars and the People view's balance
// bar -- the same household member should always render with the same
// color across sessions/devices without needing to store a color choice
// anywhere server-side. Six colors is enough to keep same-household
// members usually visually distinct while staying within the app's
// otherwise-restrained (mostly monochrome + one accent) palette.
const PALETTE = ['#FF6A3D', '#3D7AFF', '#1F8A5C', '#8A5CFF', '#D64545', '#C98A00'];

export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

// "Max Mustermann" -> "MM", "Anna" -> "A". Falls back to "?" for an empty
// name so an avatar circle never renders completely blank.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
