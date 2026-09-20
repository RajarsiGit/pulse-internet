export const DOWNLOAD_URL = 'https://speed.cloudflare.com/__down';
export const UPLOAD_URL = 'https://speed.cloudflare.com/__up';
export const TEST_LIMITS = { download: 64_000_000, upload: 32_000_000, duration: 8000 };
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function jitter(values) {
  return values.length < 2 ? null : values.slice(1).reduce((sum, value, i) => sum + Math.abs(value - values[i]), 0) / (values.length - 1);
}
export const mbps = (bytes, ms) => ms > 0 ? bytes * 8 / ms / 1000 : 0;
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Test stopped', 'AbortError'); };
const nonce = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function scope(parent, timeout) {
  const controller = new AbortController(), forward = () => controller.abort(parent.reason);
  if (parent?.aborted) forward(); else parent?.addEventListener('abort', forward, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
  return { signal: controller.signal, close() { clearTimeout(timer); parent?.removeEventListener('abort', forward); } };
}
function validate(response) {
  if (!response.ok) throw new Error(`The test server returned HTTP ${response.status}. Try again in a moment.`);
  if (response.redirected || response.headers.get('content-type')?.includes('text/html')) throw new Error('Your connection may require a sign-in, or the test endpoint is blocked.');
}
export async function probe(signal, timeout = 5000) {
  checkAbort(signal);
  const request = scope(signal, timeout), start = performance.now();
  try {
    const response = await fetch(`${DOWNLOAD_URL}?bytes=0&pulse=${nonce()}`, { signal: request.signal, cache: 'no-store', credentials: 'omit' });
    validate(response); await response.arrayBuffer();
    return performance.now() - start;
  } finally { request.close(); }
}
// Received download bytes / total wall time; acknowledged upload bytes / wall time.
// Budgets are reserved before fetching, preventing parallel workers from overspending.
export async function measureTransfer(direction, signal, onSample, options = {}) {
  checkAbort(signal);
  const duration = options.duration ?? TEST_LIMITS.duration, budget = options.budget ?? TEST_LIMITS[direction];
  const phase = scope(signal, duration), start = performance.now();
  let bytes = 0, reserved = 0, completed = 0, failure = null, lastEmit = 0, finalSample = null;
  const publish = (force = false) => {
    const elapsed = performance.now() - start;
    finalSample = { value: mbps(bytes, elapsed), bytes, elapsed, progress: Math.min(1, Math.max(elapsed / duration, bytes / budget)) };
    if (force || elapsed - lastEmit > 160) { onSample(finalSample); lastEmit = elapsed; }
  };
  const payload = direction === 'upload' ? new Uint8Array(Math.min(4_000_000, budget)) : null;
  if (payload) for (let offset = 0; offset < payload.length; offset += 65536) crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65536, payload.length)));
  async function worker() {
    let size = direction === 'download' ? 1_000_000 : 128_000;
    while (!phase.signal.aborted && reserved < budget && !failure) {
      const chunk = Math.min(size, budget - reserved), requestStart = performance.now();
      reserved += chunk;
      try {
        const url = direction === 'download' ? `${DOWNLOAD_URL}?bytes=${chunk}&pulse=${nonce()}` : `${UPLOAD_URL}?pulse=${nonce()}`;
        const response = await fetch(url, { method: direction === 'upload' ? 'POST' : 'GET',
          ...(payload ? { body: payload.subarray(0, chunk), headers: { 'Content-Type': 'text/plain;charset=UTF-8' } } : {}),
          signal: phase.signal, cache: 'no-store', credentials: 'omit' });
        validate(response);
        if (direction === 'download') {
          let received = 0;
          if (response.body?.getReader) {
            const reader = response.body.getReader();
            try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; received += item.value.byteLength; publish(); } }
            finally { reader.releaseLock(); }
          } else { received = (await response.arrayBuffer()).byteLength; bytes += received; }
          if (received !== chunk) throw new Error('The test server returned an unexpected download size. Please retry.');
        } else { await response.arrayBuffer(); bytes += chunk; }
        completed++; publish(true);
        size = Math.max(32_000, Math.min(direction === 'download' ? 8_000_000 : payload.length, Math.round(chunk * 700 / Math.max(1, performance.now() - requestStart))));
      } catch (error) { if (!phase.signal.aborted) failure = error; break; }
    }
  }
  const ticker = setInterval(() => publish(), 200);
  try {
    await Promise.all(Array.from({ length: direction === 'download' ? 2 : 1 }, worker));
    checkAbort(signal);
    if (failure) throw failure;
    if (!bytes || (direction === 'upload' && !completed)) throw new Error(`No ${direction} sample completed. Your connection may be too slow, or the endpoint is blocked.`);
    publish(true);
    return { ...finalSample, shortSample: finalSample.elapsed < 1000, completed };
  } finally { clearInterval(ticker); phase.close(); }
}
export async function runSpeedTest(signal, onUpdate) {
  const started = performance.now(), result = { latency: null, jitter: null, download: null, upload: null, bytes: 0, shortSample: false };
  onUpdate({ phase: 'latency', progress: 0, result: { ...result } });
  await probe(signal); // Discard warm-up timing.
  const samples = [];
  for (let i = 0; i < 6; i++) {
    samples.push(await probe(signal)); result.latency = median(samples); result.jitter = jitter(samples);
    onUpdate({ phase: 'latency', progress: (i + 1) / 6 * 20, result: { ...result } });
  }
  for (const direction of ['download', 'upload']) {
    const priorBytes = result.bytes, base = direction === 'download' ? 20 : 60;
    onUpdate({ phase: direction, progress: base, result: { ...result }, current: 0 });
    const measured = await measureTransfer(direction, signal, sample => {
      result[direction] = sample.value;
      onUpdate({ phase: direction, progress: Math.min(99, base + sample.progress * 39), result: { ...result, bytes: priorBytes + sample.bytes }, current: sample.value,
        sample: { type: direction, time: (performance.now() - started) / 1000, value: sample.value } });
    });
    result[direction] = measured.value; result.bytes += measured.bytes; result.shortSample ||= measured.shortSample;
  }
  return { ...result, duration: (performance.now() - started) / 1000, timestamp: Date.now() };
}
export function friendlyError(error) {
  if (error.name === 'TimeoutError') return 'The test server took too long to respond. Check your connection and try again.';
  if (error instanceof TypeError) return 'Could not reach the test server. Check your connection, VPN, or content blocker, then retry.';
  return error.message || 'The test could not finish. Please try again.';
}
