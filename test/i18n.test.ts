import { describe, it, expect, beforeEach } from 'vitest';
import { t, getLanguage, setLanguage } from '../src/i18n';

describe('i18n', () => {
  beforeEach(() => {
    // Reset to German default before each test
    setLanguage('de');
  });

  describe('t() lookup', () => {
    it('returns the German string by default', () => {
      expect(t('hh.createButton')).toBe('Neuen Haushalt starten');
    });

    it('returns the English string when language is set to en', () => {
      setLanguage('en');
      expect(t('hh.createButton')).toBe('Start new household');
    });

    it('returns the key itself for an unknown key (fallback)', () => {
      expect(t('nonexistent.key.here')).toBe('nonexistent.key.here');
    });

    it('interpolates placeholders in German', () => {
      const result = t('hh.joinedSince', { date: '01.01.2025' });
      expect(result).toBe('Dabei seit 01.01.2025');
    });

    it('interpolates placeholders in English', () => {
      setLanguage('en');
      const result = t('hh.joinedSince', { date: '2025-01-01' });
      expect(result).toBe('Member since 2025-01-01');
    });

    it('interpolates multiple placeholders', () => {
      const result = t('rooms.moveFrom', { path: 'Küche', count: '5' });
      expect(result).toContain('Küche');
      expect(result).toContain('5');
    });

    it('handles numeric placeholder values', () => {
      const result = t('home.headline.n', { count: 3 });
      expect(result).toContain('3');
      expect(result).toContain('Dinge');
    });
  });

  describe('getLanguage() / setLanguage()', () => {
    it('defaults to de', () => {
      expect(getLanguage()).toBe('de');
    });

    it('switches to en and back', () => {
      setLanguage('en');
      expect(getLanguage()).toBe('en');
      setLanguage('de');
      expect(getLanguage()).toBe('de');
    });
  });

  describe('TypeScript-level sync enforcement', () => {
    // The Translations interface is the mechanism that enforces key sync.
    // If de.ts and de.ts have different keys, tsc --noEmit will fail.
    // We verify this indirectly: both files import Translations and both
    // are typed as Translations, so a missing key is a compile error.
    it('both de and en files satisfy the Translations interface (compile-time check)', () => {
      // If this test file compiles at all, the interface constraint held.
      // We also spot-check a few keys from different sections to confirm
      // both languages have them.
      const keys = [
        'hh.createButton',
        'home.headline.ok',
        'rooms.title',
        'people.title',
        'app.loading',
        'feed.task.overdue',
        'settings.language',
      ];
      for (const key of keys) {
        // Both languages should return a string that is NOT the key itself
        // (which would indicate a missing translation)
        setLanguage('de');
        const deVal = t(key);
        expect(deVal).not.toBe(key);

        setLanguage('en');
        const enVal = t(key);
        expect(enVal).not.toBe(key);

        // They should be different from each other (sanity check)
        expect(deVal).not.toBe(enVal);
      }
    });
  });
});
