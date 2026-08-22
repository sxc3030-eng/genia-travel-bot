import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaClient } from './client.js';
import { MetaApiError } from './errors.js';

interface Call {
  url: string;
  body?: Record<string, string>;
}

function stubFetch(responses: Array<{ ok?: boolean; status?: number; json: unknown }>) {
  const calls: Call[] = [];
  let index = 0;

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
    calls.push({ url: String(url), body });
    const next = responses[Math.min(index++, responses.length - 1)];
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json,
    };
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const BASE = { pageId: 'PAGE1', pageToken: 'TOK', igBusinessId: 'IG1', sleep: async () => {} };

test('Facebook publishes a photo post and returns the post id', async () => {
  const { fetchImpl, calls } = stubFetch([{ json: { id: '123', post_id: 'PAGE1_999' } }]);
  const client = new MetaClient({ ...BASE, fetchImpl });

  const result = await client.publishToFacebook({ imageUrl: 'https://genia.ca/img.png', caption: 'hello' });

  assert.equal(result.externalId, 'PAGE1_999');
  assert.match(calls[0].url, /\/PAGE1\/photos$/);
  assert.equal(calls[0].body?.url, 'https://genia.ca/img.png');
  assert.equal(calls[0].body?.caption, 'hello');
  assert.equal(calls[0].body?.access_token, 'TOK');
});

test('Instagram creates a container, waits for FINISHED, then publishes', async () => {
  const { fetchImpl, calls } = stubFetch([
    { json: { id: 'CONTAINER1' } },
    { json: { status_code: 'IN_PROGRESS' } },
    { json: { status_code: 'FINISHED' } },
    { json: { id: 'MEDIA1' } },
  ]);
  const client = new MetaClient({ ...BASE, fetchImpl });

  const result = await client.publishToInstagram({ imageUrl: 'https://genia.ca/img.png', caption: 'hi' });

  assert.equal(result.externalId, 'MEDIA1');
  assert.match(calls[0].url, /\/IG1\/media$/);
  // Meta fetches this URL itself, so it must be the public one we pass in.
  assert.equal(calls[0].body?.image_url, 'https://genia.ca/img.png');
  assert.match(calls[1].url, /\/CONTAINER1\?/);
  assert.match(calls[3].url, /\/IG1\/media_publish$/);
  assert.equal(calls[3].body?.creation_id, 'CONTAINER1');
});

test('Instagram does not publish a container that errored', async () => {
  const { fetchImpl, calls } = stubFetch([
    { json: { id: 'CONTAINER1' } },
    { json: { status_code: 'ERROR', status: 'media download failed' } },
  ]);
  const client = new MetaClient({ ...BASE, fetchImpl });

  await assert.rejects(
    () => client.publishToInstagram({ imageUrl: 'https://genia.ca/img.png', caption: 'hi' }),
    /media download failed/
  );
  assert.equal(calls.length, 2, 'must not call media_publish after a failed container');
});

test('Instagram gives up rather than polling a stuck container forever', async () => {
  const { fetchImpl } = stubFetch([{ json: { id: 'C1' } }, { json: { status_code: 'IN_PROGRESS' } }]);
  const client = new MetaClient({ ...BASE, fetchImpl, containerPollAttempts: 3 });

  await assert.rejects(
    () => client.publishToInstagram({ imageUrl: 'https://genia.ca/i.png', caption: 'hi' }),
    /did not finish in time/
  );
});

test('Instagram refuses to run without a business id', async () => {
  const { fetchImpl } = stubFetch([{ json: {} }]);
  const client = new MetaClient({ ...BASE, igBusinessId: undefined, fetchImpl });

  await assert.rejects(
    () => client.publishToInstagram({ imageUrl: 'https://genia.ca/i.png', caption: 'x' }),
    /IG_BUSINESS_ID is required/
  );
});

test('a Meta error payload surfaces as a classified MetaApiError', async () => {
  const { fetchImpl } = stubFetch([
    { ok: false, status: 400, json: { error: { message: 'Invalid OAuth token', code: 190 } } },
  ]);
  const client = new MetaClient({ ...BASE, fetchImpl });

  await assert.rejects(
    () => client.publishToFacebook({ imageUrl: 'https://x/i.png', caption: 'x' }),
    (err: unknown) => err instanceof MetaApiError && err.kind === 'auth' && !err.retryable
  );
});

test('a 200 response carrying an error object is still treated as a failure', async () => {
  // Graph occasionally returns HTTP 200 with an error body; trusting `ok`
  // alone would mark the post published with no id.
  const { fetchImpl } = stubFetch([{ ok: true, status: 200, json: { error: { message: 'Rate limited', code: 4 } } }]);
  const client = new MetaClient({ ...BASE, fetchImpl });

  await assert.rejects(
    () => client.publishToFacebook({ imageUrl: 'https://x/i.png', caption: 'x' }),
    (err: unknown) => err instanceof MetaApiError && err.kind === 'rate_limited' && err.retryable
  );
});

test('a transport failure is transient, so the job retries', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch;
  const client = new MetaClient({ ...BASE, fetchImpl });

  await assert.rejects(
    () => client.publishToFacebook({ imageUrl: 'https://x/i.png', caption: 'x' }),
    (err: unknown) => err instanceof MetaApiError && err.kind === 'transient' && err.retryable
  );
});
