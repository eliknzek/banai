import { expect, test } from './fixtures.js';

// A first-time visitor (no saved choice) gets the app in Hebrew, right to left.
test.use({ uiLocale: 'default' });

async function openBasic(page) {
  await page.goto('/');
  await page.getByTestId('entry-basic').click();
  await page.waitForFunction(() => window.__banai?.viewer.meshOf('shf_l1'));
}

test.describe('Hebrew interface', () => {
  test('opens in Hebrew, right to left, with a language switch on the start screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByTestId('start-screen')).toContainText('בוא נעצב את הארון שלך');
    await expect(page.getByTestId('entry-basic')).toContainText('לפתוח ארון בסיסי');
    await expect(page.getByTestId('start-screen').getByTestId('lang-he')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the workspace is laid out right to left and fully in Hebrew', async ({ page }) => {
    await openBasic(page);
    const chat = await page.locator('#chat-panel').boundingBox();
    const properties = await page.locator('#properties-panel').boundingBox();
    expect(chat.x).toBeGreaterThan(properties.x); // the chat column is on the right
    await expect(page.locator('#properties-panel')).toContainText('מאפיינים');
    await expect(page.locator('#properties-panel')).toContainText('רוחב');
    await expect(page.locator('#properties-panel')).toContainText('לוח מלמין');
    await expect(page.getByText('רוחב 200.0 ס״מ', { exact: true })).toBeVisible(); // 3D dimension label
    await expect(page.getByTestId('open-save')).toHaveText('שמירה');

    // No English left on screen, apart from names and keys that stay Latin.
    const leftovers = await page.evaluate(() => {
      const allowed = /\b(BanAI|AI|MDF|PDF|EN|Enter|Shift)\b/g;
      return (document.body.innerText.replace(allowed, '').match(/[A-Za-z]{2,}/g) ?? []);
    });
    expect(leftovers).toEqual([]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('proposal card rows are worded in Hebrew', async ({ page }) => {
    await openBasic(page);
    await page.getByTestId('chat-input').fill('Make it 240 cm wide with sliding doors');
    await page.getByTestId('chat-send').click();
    const card = page.getByTestId('proposal-card');
    await expect(card).toContainText('שינויים מוצעים');
    await expect(card).toContainText('רוחב 240.0 ס״מ');
    await expect(card).toContainText('הזזה, 2 כנפיים');
    await expect(card).toContainText('77.6 · 77.6 · 77.6 ס״מ');
    await expect(page.getByTestId('proposal-confirm')).toContainText('אישור');
  });

  test('switching language is live, keeps the design and the chat, and is remembered', async ({ page }) => {
    await openBasic(page);
    await page.getByTestId('chat-input').fill('Make it 240 cm wide');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-card')).toContainText('רוחב 240.0 ס״מ');
    const before = await page.evaluate(() => ({ revision: window.__banai.store.getState().revision, messages: window.__banai.chat.getMessages().length }));

    await page.locator('.topbar').getByTestId('lang-en').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByTestId('proposal-card')).toContainText('Width 240.0 cm');
    await expect(page.locator('#properties-panel')).toContainText('Properties');
    await expect(page.getByText('W 200.0 cm', { exact: true })).toBeVisible();
    const after = await page.evaluate(() => ({ revision: window.__banai.store.getState().revision, messages: window.__banai.chat.getMessages().length }));
    expect(after).toEqual(before);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByTestId('entry-basic')).toContainText('Open basic wardrobe');
  });

  test('editor messages are in Hebrew', async ({ page }) => {
    await openBasic(page);
    await page.getByTestId('dim-width').fill('abc');
    await page.getByTestId('dim-width').press('Enter');
    await expect(page.locator('#properties-panel')).toContainText('הקלד מספר בס״מ');
    await page.getByTestId('dim-width').fill('10');
    await page.getByTestId('dim-width').press('Enter');
    await expect(page.locator('#properties-panel')).toContainText('הערך מחוץ לטווח המותר');
  });
});

test('the render dialog and the carpenter spec are in Hebrew, and the PDF is asked for in Hebrew', async ({ page }) => {
  await openBasic(page);
  await page.getByTestId('open-render').click();
  await expect(page.getByTestId('render-generate')).toHaveText('צור הדמיה');
  await page.getByTestId('render-generate').click();
  await expect(page.getByTestId('render-image')).toBeVisible();
  await expect(page.getByTestId('spec-download')).toHaveText('הורד מפרט (PDF)');
  await expect(page.getByTestId('spec-share')).toHaveText('שלח מפרט לנגר');
  const specRequest = page.waitForRequest((r) => r.url().endsWith('/api/spec'));
  const download = page.waitForEvent('download');
  await page.getByTestId('spec-download').click();
  expect((await specRequest).postDataJSON().locale).toBe('he');
  await download;
});
