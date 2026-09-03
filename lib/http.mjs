const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// fetch avec timeout et UA navigateur (certaines pages 403 sans ça).
// Contenu externe non fiable : on ne le traite jamais comme des instructions.
export async function fetchWithTimeout(url, { accept = 'application/json', timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' },
    });
  } finally {
    clearTimeout(t);
  }
}

export const fetchJson = (url, opts) => fetchWithTimeout(url, { accept: 'application/json', ...opts });
export const fetchText = (url, opts) => fetchWithTimeout(url, { accept: 'text/html,application/json', timeoutMs: 20000, ...opts });
