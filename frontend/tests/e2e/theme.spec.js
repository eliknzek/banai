import AxeBuilder from '@axe-core/playwright';
import { test, expect, openDesigner } from './fixtures.js';

const THEMES = ['Terracotta', 'Sage', 'Slate', 'Midnight', 'Neon'];
const htmlTheme = (page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

test.describe('theme slider', () => {
  test.beforeEach(async ({ page }) => openDesigner(page));

  test('starts on the original look, labelled, with five stops', async ({ page }) => {
    const slider = page.getByRole('slider', { name: 'Theme' });
    await expect(slider).toHaveAttribute('min', '0');
    await expect(slider).toHaveAttribute('max', '4');
    await expect(slider).toHaveValue('0');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Terracotta');
    await expect(page.locator('#theme-name')).toHaveText('Terracotta');
    expect(await htmlTheme(page)).toBeNull();
  });

  test('each stop applies its theme to the page and the 3D view', async ({ page }) => {
    const slider = page.getByRole('slider', { name: 'Theme' });
    const backgrounds = new Set();
    for (const [index, name] of THEMES.entries()) {
      await slider.fill(String(index));
      await expect(page.locator('#theme-name')).toHaveText(name);
      await expect(slider).toHaveAttribute('aria-valuetext', name);
      expect(await htmlTheme(page)).toBe(index === 0 ? null : name.toLowerCase());
      backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
      const sceneColour = await page.evaluate(() => {
        const { viewer } = window.__banai;
        let scene = viewer.camera;
        while (scene.parent) scene = scene.parent;
        return scene.background ? `#${scene.background.getHexString()}` : null;
      });
      const cssColour = await page.evaluate(() => getComputedStyle(document.getElementById('viewer')).getPropertyValue('--md-sys-color-viewer').trim().toLowerCase());
      if (sceneColour) expect(sceneColour).toBe(cssColour);
    }
    expect(backgrounds.size).toBe(THEMES.length);
  });

  test('the keyboard moves between themes', async ({ page }) => {
    const slider = page.getByRole('slider', { name: 'Theme' });
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#theme-name')).toHaveText('Sage');
    await page.keyboard.press('End');
    await expect(page.locator('#theme-name')).toHaveText('Neon');
  });

  test('the choice is remembered after a reload', async ({ page }) => {
    await page.getByRole('slider', { name: 'Theme' }).fill('3');
    await page.reload();
    await expect(page.locator('#theme-name')).toHaveText('Midnight');
    expect(await htmlTheme(page)).toBe('midnight');
  });

  test('changing the theme never changes the design', async ({ page }) => {
    const snapshot = () => page.evaluate(() => JSON.stringify(window.__banai.store.getState().design));
    const before = await snapshot();
    for (let index = 0; index < THEMES.length; index += 1) await page.getByRole('slider', { name: 'Theme' }).fill(String(index));
    expect(await snapshot()).toBe(before);
  });
});

// IS 5568 / WCAG 2.1 AA in every theme, including the two extreme ones.
test.describe('accessibility in every theme (axe)', () => {
  for (const [index, name] of THEMES.entries()) {
    test(name, async ({ page }) => {
      await openDesigner(page);
      await page.getByRole('slider', { name: 'Theme' }).fill(String(index));
      await page.getByTestId('part-shf_l1').click(); // with a selection, so the selected styles are checked too
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(', ')}`);
      expect(summary, summary.join('\n')).toEqual([]);
    });
  }
});
