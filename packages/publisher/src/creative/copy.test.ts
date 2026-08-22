import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Platform } from '@genia/core';
import { DISCLOSURE, INSTAGRAM_CAPTION_LIMIT, localeForOrigin, renderCopy, type CopyInput } from './copy.js';

const BASE: CopyInput = {
  event: {
    title: 'Osheaga Festival',
    city: 'New York',
    category: 'festival',
    startsAt: new Date('2026-09-26T23:00:00Z'),
  },
  offer: { origin: 'YUL', shortHash: '8VoegSOz', checkIn: '2026-09-25', checkOut: '2026-09-28' },
  platform: 'facebook',
  redirectBaseUrl: 'https://genia.ca/go',
};

const PLATFORMS: Platform[] = ['facebook', 'instagram'];

test('locale follows the origin we sell from', () => {
  assert.equal(localeForOrigin('YUL'), 'fr-CA');
  assert.equal(localeForOrigin('YYZ'), 'en-CA');
});

test('the ad disclosure is present on every platform and locale', () => {
  for (const platform of PLATFORMS) {
    for (const origin of ['YUL', 'YYZ']) {
      const result = renderCopy({ ...BASE, platform, offer: { ...BASE.offer, origin } });
      assert.ok(
        result.text.includes(DISCLOSURE[result.locale]),
        `missing disclosure for ${platform}/${origin}`
      );
    }
  }
});

test('the disclosure leads the copy, not buried at the end', () => {
  const result = renderCopy(BASE);
  assert.ok(result.text.startsWith(DISCLOSURE['fr-CA']), `copy started with: ${result.text.slice(0, 40)}`);
});

test('Facebook copy carries the clickable short link inline', () => {
  const result = renderCopy({ ...BASE, platform: 'facebook' });
  assert.equal(result.linkIsInCaption, true);
  assert.ok(result.text.includes('https://genia.ca/go/8VoegSOz'));
});

test('Instagram copy omits the URL, because captions are not linkified', () => {
  const result = renderCopy({ ...BASE, platform: 'instagram' });
  assert.equal(result.linkIsInCaption, false);
  assert.ok(!result.text.includes('genia.ca/go'), 'an unclickable URL must not be pasted into an IG caption');
  assert.ok(result.text.includes('bio'));
  // The link is still returned so the publisher can put it in the bio/story.
  assert.equal(result.linkUrl, 'https://genia.ca/go/8VoegSOz');
});

test('French copy for YUL, English for YYZ', () => {
  const montreal = renderCopy({ ...BASE, offer: { ...BASE.offer, origin: 'YUL' } });
  const toronto = renderCopy({ ...BASE, offer: { ...BASE.offer, origin: 'YYZ' } });

  assert.equal(montreal.locale, 'fr-CA');
  assert.equal(toronto.locale, 'en-CA');
  assert.ok(montreal.text.includes('hôtels'));
  assert.ok(toronto.text.includes('hotels'));
});

test('copy states no price, discount or availability claim', () => {
  // The generator cannot know any of these, so it must never assert them.
  const forbidden = [/\$\d/, /\d+\s*%/, 'meilleur prix', 'best price', 'pas cher', 'cheap', 'rabais', 'deal', 'sold out'];
  for (const platform of PLATFORMS) {
    for (const origin of ['YUL', 'YYZ']) {
      const { text } = renderCopy({ ...BASE, platform, offer: { ...BASE.offer, origin } });
      for (const pattern of forbidden) {
        const hit = typeof pattern === 'string' ? text.toLowerCase().includes(pattern) : pattern.test(text);
        assert.equal(hit, false, `unsupported claim ${pattern} in: ${text}`);
      }
    }
  }
});

test('no unresolved template placeholder leaks into the output', () => {
  for (const platform of PLATFORMS) {
    const { text } = renderCopy({ ...BASE, platform });
    assert.ok(!/undefined|null|NaN|\{\{|\$\{/.test(text), text);
  }
});

test('Instagram captions stay under the platform limit', () => {
  const longTitle = 'A'.repeat(400);
  const { text } = renderCopy({ ...BASE, platform: 'instagram', event: { ...BASE.event, title: longTitle } });
  assert.ok(text.length < INSTAGRAM_CAPTION_LIMIT, `caption was ${text.length} chars`);
});

test('night count is pluralised per locale', () => {
  const threeNights = renderCopy(BASE);
  assert.ok(threeNights.text.includes('3 nuits'));

  const oneNight = renderCopy({ ...BASE, offer: { ...BASE.offer, checkOut: '2026-09-26' } });
  assert.ok(oneNight.text.includes('1 nuit') && !oneNight.text.includes('1 nuits'));
});

test('the same offer always renders the same variant', () => {
  const a = renderCopy(BASE);
  const b = renderCopy(BASE);
  assert.equal(a.text, b.text);
});

test('different offers can render different variants', () => {
  const variants = new Set(
    ['aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'eeeeee', 'ffffff'].map(
      (shortHash) => renderCopy({ ...BASE, offer: { ...BASE.offer, shortHash } }).text
    )
  );
  assert.ok(variants.size > 1, 'copy should not be identical for every offer');
});
