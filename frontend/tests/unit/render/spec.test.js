import { describe, expect, it, vi } from 'vitest';
import { getSpec } from '../../../src/api/client.js';
import { FURNITURE, FURNITURE_KINDS } from '../../../src/render/carpenterAnimation.js';
import { shareSpec, specFileName } from '../../../src/render/specShare.js';
import en from '../../../src/i18n/en.js';

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'banai-spec.pdf', { type: 'application/pdf' });

describe('sending the spec', () => {
  it('uses the share sheet when the device can share files', async () => {
    const nav = { canShare: vi.fn(() => true), share: vi.fn(async () => {}) };
    const save = vi.fn();
    const file = pdf();
    await expect(shareSpec(file, { nav, save, openUrl: vi.fn() })).resolves.toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ files: [file], title: en['spec.shareTitle'], text: en['spec.shareText'] });
    expect(save).not.toHaveBeenCalled();
  });

  it('does nothing more when the customer closes the share sheet', async () => {
    const nav = { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
    const save = vi.fn();
    await expect(shareSpec(pdf(), { nav, save, openUrl: vi.fn() })).resolves.toBe('cancelled');
    expect(save).not.toHaveBeenCalled();
  });

  it('falls back to a download and a mail draft, without any address', async () => {
    const save = vi.fn();
    const openUrl = vi.fn();
    await expect(shareSpec(pdf(), { nav: {}, save, openUrl })).resolves.toBe('downloaded-mail');
    expect(save).toHaveBeenCalledTimes(1);
    const url = openUrl.mock.calls[0][0];
    expect(url.startsWith('mailto:?subject=')).toBe(true); // no recipient: the customer chooses
    expect(decodeURIComponent(url)).toContain(en['spec.shareTitle']);
  });

  it('names the file with the date', () => {
    expect(specFileName(new Date('2026-10-16T12:00:00Z'))).toBe('banai-spec-2026-10-16.pdf');
  });
});

describe('getSpec client', () => {
  it('posts the design, the render and the language, and returns the PDF blob', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, blob: async () => blob }));
    await expect(getSpec({ design: { a: 1 }, render: 'jpg', locale: 'he' }, fetchImpl)).resolves.toBe(blob);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/spec');
    expect(JSON.parse(init.body)).toEqual({ design: { a: 1 }, render: 'jpg', locale: 'he' });
  });
});

describe('carpenter animation data', () => {
  it('has a few pieces of furniture, each built from boards inside the bench area', () => {
    expect(FURNITURE_KINDS).toEqual(['chair', 'table', 'bookshelf', 'cabinet']);
    for (const boards of Object.values(FURNITURE)) {
      expect(boards.length).toBeGreaterThanOrEqual(4);
      for (const [x, y, w, h] of boards) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(120);
        expect(y + h).toBeLessThanOrEqual(100);
      }
    }
  });
});
