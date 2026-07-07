import { test, expect } from '@playwright/test';

test.describe('i18n language switching', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any persisted language preference
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('peerson_language');
    });
  });

  test('defaults to German, switches to English, persists after reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // 1) Load the app — should be German by default
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Verify <html lang="de">
    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('de');

    // Verify German welcome text is visible
    await expect(page.locator('text=Dein Haushalt')).toBeVisible();
    await expect(page.locator('text=Neuen Haushalt starten')).toBeVisible();
    await expect(page.locator('text=Haushalt beitreten')).toBeVisible();

    // Verify German feature cards
    await expect(page.locator('text=Vorrat tracken')).toBeVisible();
    await expect(page.locator('text=Einkäufe planen')).toBeVisible();
    await expect(page.locator('text=Aufgaben teilen')).toBeVisible();
    await expect(page.locator('text=Kosten splitten')).toBeVisible();

    // 2) No console errors so far
    expect(errors).toEqual([]);

    // 3) Switch to English via the language toggle
    // The language toggle is in the profile section, which only shows when
    // a household exists. Since we're on the welcome screen, we'll switch
    // via localStorage and reload.
    await page.evaluate(() => {
      localStorage.setItem('peerson_language', 'en');
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // Verify <html lang="en">
    const langEn = await page.getAttribute('html', 'lang');
    expect(langEn).toBe('en');

    // Verify English welcome text
    await expect(page.locator('text=Your household, finally in sync')).toBeVisible();
    await expect(page.locator('text=Start new household')).toBeVisible();
    await expect(page.locator('text=Join household')).toBeVisible();

    // Verify English feature cards
    await expect(page.locator('text=Track pantry')).toBeVisible();
    await expect(page.locator('text=Plan shopping')).toBeVisible();
    await expect(page.locator('text=Share tasks')).toBeVisible();
    await expect(page.locator('text=Split costs')).toBeVisible();

    // 4) Reload again to confirm persistence
    await page.reload();
    await page.waitForTimeout(1000);

    const langPersisted = await page.getAttribute('html', 'lang');
    expect(langPersisted).toBe('en');
    await expect(page.locator('text=Your household, finally in sync')).toBeVisible();

    // 5) Switch back to German
    await page.evaluate(() => {
      localStorage.setItem('peerson_language', 'de');
    });
    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.locator('text=Dein Haushalt')).toBeVisible();

    // 6) Zero console errors throughout
    expect(errors).toEqual([]);
  });

  test('German stays default when no preference is stored', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('peerson_language');
    });
    await page.reload();
    await page.waitForTimeout(1000);

    const lang = await page.getAttribute('html', 'lang');
    expect(lang).toBe('de');
    await expect(page.locator('text=Neuen Haushalt starten')).toBeVisible();
  });

  test('existing German Playwright assertions still work (backward compat)', async ({ page }) => {
    // These are the specific German strings that other Playwright scripts
    // in this project assert on. They MUST still be present since German
    // is the default language.
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Key strings from the welcome/onboarding screen
    await expect(page.locator('text=Neuen Haushalt starten')).toBeVisible();
    await expect(page.locator('text=Haushalt beitreten')).toBeVisible();
    await expect(page.locator('text=Haushalt erstellen')).toBeVisible();
    await expect(page.locator('text=Mit Code beitreten')).toBeVisible();
    await expect(page.locator('text=Account von anderem Gerät wiederherstellen')).toBeVisible();
  });
});
