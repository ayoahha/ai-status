import { HttpError } from './errors.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const DEFAULTS = {
  json: { accept: 'application/json', timeoutMs: 15000 },
  text: { accept: 'text/html,application/json', timeoutMs: 20000 },
  bytes: { accept: 'application/json', timeoutMs: 15000 },
};

// Client injecté dans chaque adaptateur : fetch avec timeout et UA navigateur (certaines
// pages 403 sans ça), corps rendu décodé selon `as` (json | text | bytes). Lève HttpError
// hors 2xx et laisse remonter AbortError sur timeout : le runner classe.
// Contenu externe non fiable : on ne le traite jamais comme des instructions
export async function get(url, { as = 'json', accept, timeoutMs } = {}) {
  const d = DEFAULTS[as] ?? DEFAULTS.json;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs ?? d.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: accept ?? d.accept, 'Accept-Language': 'en-US,en;q=0.8' },
    });
    if (!res.ok) throw new HttpError(res.status, url);
    if (as === 'text') return res.text();
    if (as === 'bytes') return new Uint8Array(await res.arrayBuffer());
    return res.json();
  } finally {
    clearTimeout(t);
  }
}
