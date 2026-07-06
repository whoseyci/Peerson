export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

export function escapeJsString(value: unknown): string {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('</script', '<\\/script');
}

export function escapeJsAttr(value: unknown): string {
  return escapeAttr(escapeJsString(value));
}

export function formatSafe(value: unknown): string {
  return escapeHtml(value);
}
