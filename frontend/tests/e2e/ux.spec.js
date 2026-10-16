import { test, expect, openDesigner } from './fixtures.js';

test.describe('start screen', () => {
  test('is shown first with three entry points and the manufacturing disclaimer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('start-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Design your wardrobe' })).toBeVisible();
    for (const id of ['guided', 'freeText', 'basic']) await expect(page.getByTestId(`entry-${id}`)).toBeVisible();
    await expect(page.getByText('not manufacturing drawings')).toBeVisible();
  });

  test('Escape does not dismiss it (a choice is required)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-screen').waitFor();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('start-screen')).toBeVisible();
  });

  test('"Start from a basic wardrobe" opens the editor with the default wardrobe', async ({ page }) => {
    await openDesigner(page);
    await expect(page.getByTestId('start-screen')).toHaveCount(0);
    await expect(page.getByText('W 200.0 cm', { exact: true })).toBeVisible();
  });

  test('"Describe it" opens the same editor and focuses the chat composer', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('entry-freeText').click();
    await expect(page.getByTestId('chat-input')).toBeFocused();
    await expect(page.getByTestId('chat-input')).toHaveAttribute('placeholder', /240 cm wide/);
    await page.waitForFunction(() => window.__banai?.viewer.meshOf('shf_l1'));
  });
});

test.describe('AI chat panel', () => {
  test('sending a message gets an agent reply and never changes the design by itself', async ({ page }) => {
    await openDesigner(page);
    const before = await page.evaluate(() => window.__banai.store.getState().revision);
    await page.getByTestId('chat-input').fill('make it 3 m wide');
    await page.getByTestId('chat-send').click();
    const messages = page.getByTestId('chat-messages');
    await expect(messages).toContainText('make it 3 m wide');
    // The E2E backend runs a scripted agent: an ambiguous request gets a clarifying question.
    await expect(messages).toContainText('width you need in cm');
    expect(await page.evaluate(() => window.__banai.store.getState().revision)).toBe(before);
  });

  test('a proposal shows Confirm/Cancel, goes stale after a manual edit, and Cancel changes nothing', async ({ page }) => {
    await openDesigner(page);
    await page.evaluate(() => {
      const { chat, store } = window.__banai;
      chat.setProposal({
        id: 'demo', baseRevision: store.getState().revision, summary: 'Widen the wardrobe',
        changes: [{ title: 'Width', detail: '200.0 cm to 240.0 cm' }],
      });
    });
    const card = page.getByTestId('proposal-card');
    await expect(card).toContainText('Proposed changes');
    await expect(page.getByTestId('proposal-confirm')).toBeEnabled();

    await page.getByTestId('dim-width').fill('210');
    await page.getByTestId('dim-width').press('Enter');
    await expect(card).toContainText('Design changed. Ask the agent to re-propose.');
    await expect(page.getByTestId('proposal-confirm')).toBeDisabled();

    const revision = await page.evaluate(() => window.__banai.store.getState().revision);
    await page.getByTestId('proposal-cancel').click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('chat-messages')).toContainText('No changes were made');
    expect(await page.evaluate(() => window.__banai.store.getState().revision)).toBe(revision);
  });
});

test.describe('look and feel', () => {
  test('shows the BanAI logo in the top bar and on the start screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('start-screen').getByRole('img', { name: 'BanAI' })).toBeVisible();
    await page.getByTestId('entry-basic').click();
    await expect(page.locator('.topbar').getByRole('img', { name: 'BanAI' })).toBeVisible();
    await expect(page.locator('.topbar .logo__word')).toHaveText('BanAI');
  });

  test('uses the display and body fonts', async ({ page }) => {
    await openDesigner(page);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        logo: getComputedStyle(document.querySelector('.logo__word')).fontFamily,
        body: getComputedStyle(document.body).fontFamily,
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')),
      };
    });
    expect(fonts.logo).toContain('Bricolage Grotesque');
    expect(fonts.body).toContain('DM Sans');
    expect(fonts.loaded).toEqual(expect.arrayContaining(['Bricolage Grotesque', 'DM Sans']));
  });

  test('dropdowns keep their text clear of the chevron', async ({ page }) => {
    await openDesigner(page);
    await page.evaluate(() => window.__banai.store.select('shf_l1'));
    const select = page.locator('select.field__input').first();
    await expect(select).toBeVisible();
    const padding = await select.evaluate((node) => parseFloat(getComputedStyle(node).paddingRight));
    expect(padding).toBeGreaterThanOrEqual(40);
  });

  test('a starter prompt fills the composer but sends nothing', async ({ page }) => {
    await openDesigner(page);
    await expect(page.getByTestId('chat-welcome')).toBeVisible();
    await page.getByTestId('suggestion').first().click();
    await expect(page.getByTestId('chat-input')).toHaveValue(/240 cm wide/);
    await expect(page.getByTestId('chat-messages')).toBeHidden();
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-welcome')).toBeHidden();
    await expect(page.getByTestId('chat-messages')).toContainText('240 cm wide');
  });

  test('the cursor becomes a pointer over a component and a press shows a ripple that cleans up', async ({ page }) => {
    await openDesigner(page);
    const point = await page.evaluate(() => window.__banai.viewer.screenPointOf('dr_left'));
    await page.mouse.move(point.x, point.y);
    await expect.poll(() => page.locator('#viewer canvas').evaluate((node) => node.style.cursor)).toBe('pointer');
    const save = page.getByTestId('open-save');
    const box = await save.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await expect(save.locator('.ripple')).toHaveCount(1);
    await page.mouse.up();
    await page.getByTestId('save-close').click();
    await expect(save.locator('.ripple')).toHaveCount(0);
  });
});

test.describe('door configurations render with hardware', () => {
  const sceneStats = (page) => page.evaluate(() => {
    const scene = window.__banai.viewer.meshOf('dr_left')?.parent ?? null;
    const kinds = {};
    (scene?.children ?? []).forEach((child) => {
      const key = `${child.userData.kind}${child.userData.part ? `:${child.userData.part}` : ''}`;
      kinds[key] = (kinds[key] ?? 0) + 1;
    });
    return kinds;
  });

  test('hinged doors get a handle each; sliding doors get handles plus two rails; none has no hardware', async ({ page }) => {
    await openDesigner(page);
    expect(await sceneStats(page)).toMatchObject({ door: 3, 'hardware:handle': 3 });

    await page.evaluate(() => window.__banai.store.dispatch([{ op: 'configure_doors', type: 'sliding', ids: ['dr_a', 'dr_b', 'dr_c'] }]));
    await page.waitForFunction(() => window.__banai.viewer.meshOf('dr_a'));
    const sliding = await page.evaluate(() => {
      const scene = window.__banai.viewer.meshOf('dr_a').parent;
      return scene.children.filter((c) => c.userData.kind === 'hardware').map((c) => c.userData.part).sort();
    });
    expect(sliding).toEqual(['edge', 'edge', 'edge', 'handle', 'handle', 'handle', 'rail-bottom', 'rail-top']);

    await page.evaluate(() => window.__banai.store.dispatch([{ op: 'configure_doors', type: 'none' }]));
    await page.waitForFunction(() => !window.__banai.viewer.meshOf('dr_a'));
    const remaining = await page.evaluate(() => window.__banai.viewer.meshOf('shf_l1').parent.children.filter((c) => c.userData.kind === 'hardware').length);
    expect(remaining).toBe(0);
  });
});

test.describe('save and render dialogs (backend phases not built yet)', () => {
  test('Save opens a dialog that is honest about being unavailable, with no fake link', async ({ page }) => {
    await openDesigner(page);
    await page.getByTestId('open-save').click();
    const dialog = page.getByTestId('save-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Saving is not available yet');
    await expect(page.getByTestId('share-link')).toHaveValue('');
    await expect(page.getByTestId('save-confirm')).toBeDisabled();
    await page.getByTestId('save-close').click();
    await expect(dialog).toBeHidden();
  });

  test('Render opens a dialog labelled as illustrative, ready to generate', async ({ page }) => {
    await openDesigner(page);
    await page.getByTestId('open-render').click();
    const dialog = page.getByTestId('render-dialog');
    await expect(dialog).toContainText('Illustrative image, not the accurate 3D model');
    await expect(page.getByTestId('render-generate')).toBeEnabled();
    await expect(page.getByTestId('render-download')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
