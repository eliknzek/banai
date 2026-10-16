import { expect, openDesigner, test } from './fixtures.js';

const API_BASE = 'http://localhost:8010'; // the E2E backend port in playwright.config.js

// The E2E backend runs with APP_ENV=e2e: a scripted agent (no OpenAI calls) behind the real
// /api/chat and /api/proposals/apply endpoints, so signing, dry-run and apply are all real.

const state = (page) => page.evaluate(() => {
  const { design, revision } = window.__banai.store.getState();
  return { width: design.dimensions.width, doors: design.doors.type, revision };
});

async function ask(page, text) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('proposal-card')).toBeVisible();
}

test.describe('AI agent proposals', () => {
  test('a proposal changes nothing until Confirm, then the viewer and editor update', async ({ page }) => {
    await openDesigner(page);
    await ask(page, 'Make it 240 cm wide with sliding doors');
    const card = page.getByTestId('proposal-card');
    await expect(card).toContainText('Width 240.0 cm');
    await expect(card).toContainText('Sliding, 2 panels');
    await expect(page.getByTestId('chat-messages')).toContainText('Here is a proposal');
    expect(await state(page)).toEqual({ width: 2000, doors: 'hinged', revision: 1 });

    await page.getByTestId('proposal-confirm').click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);
    await expect(page.getByTestId('chat-messages')).toContainText('Changes applied');
    expect(await state(page)).toEqual({ width: 2400, doors: 'sliding', revision: 2 });
    // Editor and 3D view re-render from the committed state.
    await expect(page.getByTestId('dim-width')).toHaveValue('240.0');
    await expect(page.getByTestId('sliding-count')).toHaveValue('2');
    await expect(page.getByText('W 240.0 cm', { exact: true })).toBeVisible();
  });

  test('Cancel discards the proposal and leaves the design untouched', async ({ page }) => {
    await openDesigner(page);
    await ask(page, '260 cm wide please');
    await page.getByTestId('proposal-cancel').click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(0);
    await expect(page.getByTestId('chat-messages')).toContainText('No changes were made');
    expect(await state(page)).toEqual({ width: 2000, doors: 'hinged', revision: 1 });
  });

  test('a manual edit makes a pending proposal stale and blocks Confirm', async ({ page }) => {
    await openDesigner(page);
    await ask(page, 'Make it 240 cm wide');
    await page.getByTestId('dim-depth').fill('55');
    await page.getByTestId('dim-depth').press('Enter');
    await expect(page.getByTestId('proposal-card')).toContainText('Design changed');
    await expect(page.getByTestId('proposal-confirm')).toBeDisabled();
    expect((await state(page)).width).toBe(2000);
  });

  test('the server refuses a stale proposal even if the client tries to apply it', async ({ page }) => {
    await openDesigner(page);
    await ask(page, 'Make it 240 cm wide');
    const { proposal, design } = await page.evaluate(() => {
      const { proposalId, baseRevision, baseHash, ops, signature } = window.__banai.chat.getProposal();
      return { proposal: { proposalId, baseRevision, baseHash, ops, signature }, design: window.__banai.store.getState().design };
    });
    // Sent from the test runner (not the page), as a tampering client would.
    const changed = { ...design, dimensions: { ...design.dimensions, depth: 550 } };
    const stale = await page.request.post(`${API_BASE}/api/proposals/apply`, {
      data: { design: changed, revision: proposal.baseRevision, proposal },
    });
    expect(stale.status()).toBe(409);
    const fresh = await page.request.post(`${API_BASE}/api/proposals/apply`, {
      data: { design, revision: proposal.baseRevision, proposal },
    });
    expect(fresh.status()).toBe(200);
  });

  test('structural proposals list every resulting width and flag narrow compartments', async ({ page }) => {
    await openDesigner(page);
    await ask(page, 'Make it 240 cm wide');
    await expect(page.getByTestId('proposal-card')).toContainText('77.6 · 77.6 · 77.6 cm');
    await expect(page.getByTestId('proposal-warning')).toHaveCount(0);
    await page.getByTestId('proposal-cancel').click();

    await ask(page, 'Add a fourth compartment');
    await expect(page.getByTestId('proposal-card')).toContainText('64.3 · 64.3 · 14.3 · 48.1 cm');
    const warning = page.getByTestId('proposal-warning');
    await expect(warning).toHaveCount(1);
    await expect(warning).toContainText('Compartment 3: 14.3 cm');
  });

  test('the page never scrolls past the workspace', async ({ page }) => {
    await openDesigner(page);
    const { scroll, viewport } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight, viewport: window.innerHeight,
    }));
    expect(scroll).toBeLessThanOrEqual(viewport);
  });
});
