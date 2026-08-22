import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Platform } from '@genia/core';
import { DISCLOSURE } from './copy.js';
import {
  DIMENSIONS,
  MIN_TITLE_SCALE,
  buildSvg,
  escapeXml,
  layoutTitle,
  renderImage,
  wrapText,
  type ImageInput,
} from './image.js';

/** Mirrors the estimator in image.ts — used to assert lines fit the card. */
const GLYPH_RATIO = 0.62;

const BASE: ImageInput = {
  event: { title: 'Osheaga Festival', city: 'New York', startsAt: new Date('2026-09-26T23:00:00Z') },
  offer: { origin: 'YUL' },
  platform: 'instagram',
};

const PLATFORMS: Platform[] = ['facebook', 'instagram'];

test('escapeXml neutralises the characters that break SVG', () => {
  assert.equal(escapeXml(`Rock & Roll "Tour" <b> O'Brien`), 'Rock &amp; Roll &quot;Tour&quot; &lt;b&gt; O&apos;Brien');
});

test('a title containing & and quotes still renders to a PNG', async () => {
  // Regression guard: unescaped `&` produces invalid XML and sharp throws.
  const png = await renderImage({
    ...BASE,
    event: { ...BASE.event, title: `Rock & Roll "Live" <Tour> O'Brien` },
  });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});

test('the disclosure badge is baked into the SVG for both locales', () => {
  for (const origin of ['YUL', 'YYZ']) {
    const svg = buildSvg({ ...BASE, offer: { origin } });
    const locale = origin === 'YUL' ? 'fr-CA' : 'en-CA';
    assert.ok(svg.includes(escapeXml(DISCLOSURE[locale])), `missing disclosure badge for ${origin}`);
  }
});

test('renders at the documented dimensions per platform', async () => {
  for (const platform of PLATFORMS) {
    const svg = buildSvg({ ...BASE, platform });
    const { width, height } = DIMENSIONS[platform];
    assert.ok(svg.includes(`width="${width}"`) && svg.includes(`height="${height}"`), platform);
  }
});

test('wrapText keeps long titles within the line budget', () => {
  const lines = wrapText('A'.repeat(500), 78, 900, 3);
  assert.ok(lines.length <= 3, `got ${lines.length} lines`);
});

test('wrapText marks a truncated title instead of dropping words silently', () => {
  const lines = wrapText(Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), 78, 900, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines[2].endsWith('…'), `expected an ellipsis, got: ${lines[2]}`);
});

test('wrapText does not add an ellipsis when the whole title fits', () => {
  const lines = wrapText('Short Title', 78, 900, 3);
  assert.deepEqual(lines, ['Short Title']);
});

test('layoutTitle keeps every line inside the available width', () => {
  // Regression: "Coachella Valley Music and Arts Festival Weekend One" rendered
  // its last line past the right margin, because a fixed font size trusted an
  // under-estimated glyph width. The type must shrink until the line fits.
  const maxWidth = 918; // 1080 minus the 7.5% margin on each side
  const titles = [
    'Coachella Valley Music and Arts Festival Weekend One',
    'Montreal Canadiens at New York Rangers',
    'Osheaga Festival',
    'Supercalifragilisticexpialidocious',
  ];

  for (const title of titles) {
    const { lines, fontSize } = layoutTitle(title, 78, maxWidth, 3);
    for (const line of lines) {
      const estimated = line.length * fontSize * GLYPH_RATIO;
      assert.ok(estimated <= maxWidth, `"${line}" ~${Math.round(estimated)}px exceeds ${maxWidth}px`);
    }
  }
});

test('layoutTitle leaves short titles at full size', () => {
  const { fontSize } = layoutTitle('Osheaga Festival', 78, 918, 3);
  assert.equal(fontSize, 78);
});

test('layoutTitle never shrinks type below the legibility floor', () => {
  const { fontSize } = layoutTitle('W'.repeat(300), 78, 918, 3);
  assert.ok(fontSize >= Math.floor(78 * MIN_TITLE_SCALE), `font shrank to ${fontSize}`);
});

test('layoutTitle truncates when the legibility floor stops it shrinking further', () => {
  const maxWidth = 918;
  const { lines, fontSize } = layoutTitle('Supercalifragilisticexpialidocious', 78, maxWidth, 3);

  assert.equal(fontSize, Math.floor(78 * MIN_TITLE_SCALE), 'should sit exactly on the floor');
  assert.ok(lines[0].endsWith('…'), `expected truncation, got: ${lines[0]}`);
  assert.ok(lines[0].length * fontSize * GLYPH_RATIO <= maxWidth);
});

test('a very long title still produces a valid PNG at both sizes', async () => {
  for (const platform of PLATFORMS) {
    const png = await renderImage({ ...BASE, platform, event: { ...BASE.event, title: 'Very Long Title '.repeat(40) } });
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
});
