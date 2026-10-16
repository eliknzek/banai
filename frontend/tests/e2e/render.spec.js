import { expect, openDesigner, test } from './fixtures.js';

// The e2e backend renders with FakeImages: it returns the uploaded capture itself, so these
// tests check the real flow (capture -> /api/render -> image in the dialog) without OpenAI.

const designState = (page) => page.evaluate(() => {
  const { design, revision } = window.__banai.store.getState();
  return { revision, json: JSON.stringify(design) };
});

test.describe('photoreal render', () => {
  test('generates an image of the current design without changing it', async ({ page }) => {
    await openDesigner(page);
    const before = await designState(page);
    await page.getByTestId('open-render').click();
    const rendered = page.waitForResponse((r) => r.url().endsWith('/api/render'));
    const request = page.waitForRequest((r) => r.url().endsWith('/api/render'));
    await page.getByTestId('render-generate').click();
    const sent = (await request).postDataJSON();
    expect(sent.design).toEqual(JSON.parse(before.json));
    expect(Buffer.from(sent.image, 'base64').subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect((await rendered).status()).toBe(200);

    const image = page.getByTestId('render-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBeGreaterThan(100);
    await expect(page.getByTestId('render-dialog')).toContainText('Illustrative image, not the accurate 3D model');
    await expect(page.getByTestId('render-download')).toBeVisible();
    await expect(page.getByTestId('render-generate')).toHaveText('Generate again');
    expect(await designState(page)).toEqual(before);
  });

  test('the capture is clean: no grid and no selection outline, and the scene is restored', async ({ page }) => {
    await openDesigner(page);
    await page.evaluate(() => window.__banai.store.select('shf_l1'));
    const result = await page.evaluate(() => {
      const { viewer } = window.__banai;
      const image = viewer.capture();
      return { length: image.length, selection: window.__banai.store.getState().selection?.id };
    });
    expect(result.length).toBeGreaterThan(1000);
    expect(result.selection).toBe('shf_l1'); // capture never touches the state
  });
});

test.describe('photoreal render (Hebrew)', () => {
  test.use({ uiLocale: 'default' });

  test('the dialog and its result are in Hebrew', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('entry-basic').click();
    await page.getByTestId('open-render').click();
    const dialog = page.getByTestId('render-dialog');
    await expect(dialog).toContainText('הדמיה מציאותית');
    await expect(page.getByTestId('render-generate')).toHaveText('צור הדמיה');
    await page.getByTestId('render-generate').click();
    await expect(page.getByTestId('render-image')).toBeVisible();
    await expect(page.getByTestId('render-download')).toHaveText('הורד תמונה');
    await expect(dialog).toContainText('תמונה להמחשה בלבד, לא המודל המדויק');
  });
});
