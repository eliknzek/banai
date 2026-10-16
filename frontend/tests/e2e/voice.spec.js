import { expect, openDesigner, test } from './fixtures.js';

// Voice E2E (spec §9a). Chromium gets a fake microphone (playwright.config.js) and the e2e
// backend uses FakeSpeech: any recording transcribes to "Make it 240 cm wide with sliding
// doors", and speech returns a short silent mp3. Signing, chat and apply are all real.

async function holdMic(page, ms = 1200) {
  const box = await page.getByTestId('chat-mic').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('chat-mic')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const width = (page) => page.evaluate(() => window.__banai.store.getState().design.dimensions.width);

test.describe('voice', () => {
  test('push-to-talk: the transcript becomes a proposal, and nothing changes until Confirm', async ({ page }) => {
    await openDesigner(page);
    const transcribed = page.waitForResponse((r) => r.url().endsWith('/api/voice/transcribe'));
    await holdMic(page);
    expect((await transcribed).status()).toBe(200);
    await expect(page.getByTestId('chat-messages')).toContainText('Make it 240 cm wide with sliding doors');
    await expect(page.getByTestId('proposal-card')).toContainText('Width 240.0 cm');
    expect(await width(page)).toBe(2000);
    await page.getByTestId('proposal-confirm').click();
    await expect(page.getByTestId('chat-messages')).toContainText('Changes applied');
    expect(await width(page)).toBe(2400);
    await expect(page.getByTestId('chat-mic')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a typed request is also answered aloud', async ({ page }) => {
    await openDesigner(page);
    const spoken = page.waitForResponse((r) => r.url().endsWith('/api/voice/speak'));
    await page.getByTestId('chat-input').fill('Make it 240 cm wide');
    await page.getByTestId('chat-send').click();
    const response = await spoken;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('audio/mpeg');
  });

  test('muted replies are not spoken, and the choice survives a reload', async ({ page }) => {
    await openDesigner(page);
    const speakCalls = [];
    page.on('request', (request) => { if (request.url().endsWith('/api/voice/speak')) speakCalls.push(request); });
    await page.getByTestId('chat-mute').click();
    await expect(page.getByTestId('chat-mute')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('chat-input').fill('Make it 240 cm wide');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('proposal-card')).toBeVisible();
    await page.waitForTimeout(500);
    expect(speakCalls).toEqual([]);
    await openDesigner(page);
    await expect(page.getByTestId('chat-mute')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a tap that is too short records nothing', async ({ page }) => {
    await openDesigner(page);
    const calls = [];
    page.on('request', (request) => { if (request.url().includes('/api/voice/')) calls.push(request.url()); });
    await page.getByTestId('chat-mic').click();
    await page.waitForTimeout(400);
    expect(calls).toEqual([]);
    await expect(page.getByTestId('chat-messages')).toBeHidden();
  });
});
