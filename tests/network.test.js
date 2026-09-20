import test from 'node:test';
import assert from 'node:assert/strict';
import { median, jitter, mbps, measureTransfer, probe, runSpeedTest } from '../src/network.js';

test('unit conversions and latency statistics use real measured units', () => {
  assert.equal(mbps(1_000_000, 1000), 8);
  assert.equal(median([20, 10, 40, 30]), 25);
  assert.equal(jitter([10, 15, 12]), 4);
  assert.equal(jitter([10]), null);
  assert.equal(median([]), null);
});

test('parallel download reservations respect the shared budget and count received bytes', async t => {
  let requested = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    const bytes = Number(new URL(url).searchParams.get('bytes'));
    requested += bytes;
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(new Uint8Array(bytes));
  });
  const result = await measureTransfer('download', new AbortController().signal, () => {}, { budget: 2_500_000, duration: 1000 });
  assert.equal(requested, 2_500_000);
  assert.equal(result.bytes, 2_500_000);
  assert.ok(result.value > 0);
});

test('upload counts only successfully acknowledged payloads', async t => {
  let sent = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    sent += options.body.byteLength;
    return new Response('ok');
  });
  const result = await measureTransfer('upload', new AbortController().signal, () => {}, { budget: 300_000, duration: 1000 });
  assert.equal(sent, 300_000);
  assert.equal(result.bytes, sent);
});

test('HTTP errors fail the test instead of becoming speed results', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('blocked', { status: 403 }));
  await assert.rejects(probe(new AbortController().signal), /HTTP 403/);
  await assert.rejects(measureTransfer('upload', new AbortController().signal, () => {}, { budget: 1000 }), /HTTP 403/);
});

test('unexpected download content is rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('wrong size'));
  await assert.rejects(measureTransfer('download', new AbortController().signal, () => {}, { budget: 1000 }), /unexpected download size/);
});

test('cancellation aborts every in-flight download', async t => {
  let aborted = 0;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true });
  }));
  const controller = new AbortController();
  const pending = measureTransfer('download', controller.signal, () => {}, { budget: 3_000_000 });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(aborted, 2);
});

test('a stalled endpoint times out instead of hanging indefinitely', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(probe(new AbortController().signal, 10), { name: 'TimeoutError' });
  await assert.rejects(measureTransfer('upload', new AbortController().signal, () => {}, { budget: 1000, duration: 10 }), /No upload sample completed/);
});

test('full test publishes all phases, finite results, and remains within payload caps', async t => {
  let downloaded = 0, uploaded = 0;
  const seen = new Set();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') { uploaded += options.body.byteLength; return new Response('ok'); }
    const count = Number(new URL(url).searchParams.get('bytes'));
    downloaded += count;
    return new Response(new Uint8Array(count));
  });
  const result = await runSpeedTest(new AbortController().signal, event => seen.add(event.phase));
  assert.deepEqual([...seen], ['latency', 'download', 'upload']);
  assert.equal(downloaded, 64_000_000);
  assert.equal(uploaded, 32_000_000);
  assert.equal(result.bytes, 96_000_000);
  for (const key of ['download', 'upload', 'latency', 'jitter']) assert.ok(Number.isFinite(result[key]));
});
