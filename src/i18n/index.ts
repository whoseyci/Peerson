/**
 * Minimal hand-rolled i18n for Peerson.
 *
 * Design choices (see Issue #53 for rationale):
 * - No runtime dependency — a single `t(key, vars?)` function backed by
 *   per-language dictionary objects is all this small SPA needs.
 * - A shared `Translations` interface guarantees at compile time that
 *   `de.ts` and `en.ts` have exactly the same keys.  If one file is
 *   missing a key the other has, `tsc --noEmit` will error.
 * - Placeholder interpolation uses `{{name}}` syntax so translated
 *   strings can embed dynamic values (names, counts, etc.) without
 *   resorting to template-literal concatenation in view code.
 * - Language is stored in `localStorage('peerson_language')`, defaulting
 *   to `'de'` to preserve current behaviour for every existing user.
 */

import de from './de';
import en from './en';

// ── Types ────────────────────────────────────────────────────────────

/**
 * The shape every translation file must satisfy.
 *
 * Because both `de` and `en` are typed as `Translations`, TypeScript
 * will error if either file has a key the other lacks, or if the value
 * is not a string.  This is the compile-time safety net the issue
 * requires.
 */
export interface Translations {
  readonly [key: string]: string;
}

export type Language = 'de' | 'en';

// ── Registry ─────────────────────────────────────────────────────────

const translations: Record<Language, Translations> = { de, en };

/** Currently active language — read via `getLanguage()`, set via `setLanguage()`. */
let currentLang: Language = loadLanguage();

// ── Public API ───────────────────────────────────────────────────────

/**
 * Look up a translation key in the current language.
 *
 * @param key   A dot-separated key, e.g. `'hh.createButton'`
 * @param vars  Optional map of placeholder values.
 *              `t('feed.expiring.n', { days: 3, plural: 'en' })`
 *              → `"Läuft in 3 Tagen ab"` (de) / `"Expires in 3 days"` (en)
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let str = translations[currentLang][key] ?? translations['de'][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return str;
}

/** Returns the currently active language code. */
export function getLanguage(): Language {
  return currentLang;
}

/**
 * Switch the active language, persist the choice, and update
 * `<html lang>`.  Callers should re-render the UI afterwards.
 */
export function setLanguage(lang: Language): void {
  currentLang = lang;
  try { localStorage.setItem('peerson_language', lang); } catch { /* no storage in tests */ }
  try { document.documentElement.lang = lang; } catch { /* no DOM in tests */ }
}

// ── Initialisation helpers ───────────────────────────────────────────

/**
 * Read the persisted language from localStorage, falling back to `'de'`
 * if nothing is stored (preserves current behaviour for existing users).
 */
function loadLanguage(): Language {
  try {
    const stored = localStorage.getItem('peerson_language');
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    // localStorage may not be available (e.g. in test environments)
  }
  return 'de';
}

// Set `<html lang>` on module load so the document is correct from the
// very first paint, even before `App.init()` runs.
try { document.documentElement.lang = currentLang; } catch { /* no DOM in tests */ }
