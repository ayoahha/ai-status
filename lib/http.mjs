import { HttpError, fail } from './errors.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const DEFAULTS = {
  json: { accept: 'application/json', timeoutMs: 15000 },
  text: { accept: 'text/html,application/json', timeoutMs: 20000 },
  bytes: { accept: 'application/json', timeoutMs: 15000 },
};
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_CONFIGURED_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function secureUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw fail('policy', 'URL HTTP invalide', 'invalid HTTP URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw fail('policy', 'URL HTTP non sûre', 'unsafe HTTP URL');
  }
  return url;
}

function redirectOrigin(value) {
  const url = secureUrl(value);
  if (url.origin !== String(value).replace(/\/$/, '')) {
    throw fail('policy', 'origine de redirection invalide', 'invalid redirect origin');
  }
  return url.origin;
}

const tooLarge = (maxBytes) => fail('limit', `${maxBytes} octets maximum`, `${maxBytes} byte maximum`);

async function readBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge(maxBytes);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Client injecté dans chaque adaptateur : délai total, corps borné et redirections
// manuelles limitées aux origines explicitement prévues
// Contenu externe non fiable : on ne le traite jamais comme des instructions
export async function get(url, { as = 'json', accept, timeoutMs, maxBytes = DEFAULT_MAX_BYTES, redirectOrigins = [] } = {}) {
  const d = DEFAULTS[as] ?? DEFAULTS.json;
  const timeout = timeoutMs ?? d.timeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw fail('policy', 'délai HTTP invalide', 'invalid HTTP timeout');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_CONFIGURED_BYTES) {
    throw fail('policy', 'borne HTTP invalide', 'invalid HTTP limit');
  }
  if (!Array.isArray(redirectOrigins)) throw fail('policy', 'origines de redirection invalides', 'invalid redirect origins');

  let current = secureUrl(url);
  const allowedOrigins = new Set([current.origin, ...redirectOrigins.map(redirectOrigin)]);
  const seen = new Set();
  const ctrl = new AbortController();
  const deadline = Date.now() + timeout;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const ensureDeadline = () => {
    if (Date.now() >= deadline) throw new DOMException('The operation was aborted', 'AbortError');
  };
  try {
    for (let redirects = 0; ; redirects += 1) {
      ensureDeadline();
      if (seen.has(current.href)) throw fail('policy', 'boucle de redirection', 'redirect loop');
      seen.add(current.href);

      const response = await fetch(current.href, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: accept ?? d.accept, 'Accept-Language': 'en-US,en;q=0.8' },
      });
      if (REDIRECT_STATUS.has(response.status)) {
        await response.body?.cancel();
        if (redirects >= MAX_REDIRECTS) throw fail('policy', 'trop de redirections', 'too many redirects');
        const location = response.headers.get('location');
        if (!location) throw fail('policy', 'redirection sans destination', 'redirect without location');
        const next = secureUrl(location, current);
        if (!allowedOrigins.has(next.origin)) throw fail('policy', 'origine HTTP non autorisée', 'unauthorized HTTP origin');
        current = next;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status, current.href);
      }
      const bytes = await readBody(response, maxBytes);
      ensureDeadline();
      if (as === 'bytes') return bytes;
      const text = new TextDecoder().decode(bytes);
      if (as === 'text') return text;
      const parsed = JSON.parse(text);
      ensureDeadline();
      return parsed;
    }
  } finally {
    clearTimeout(timer);
  }
}
