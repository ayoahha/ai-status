import { worstOf } from '../lib/normalize.mjs';

// Pages OnlineOrNot (OpenRouter) : aucun endpoint JSON public sans jeton (l'API
// developers.onlineornot.com exige une clé), mais la page est rendue côté serveur par
// React Router et embarque ses données de chargement dans des balises
// <script>window.__reactRouterContext.streamController.enqueue("…")</script>
// au format turbo-stream : tableau plat où chaque valeur référence les autres par index.
// On décode ce tableau (données publiques structurées, pas de DOM) : composants avec
// leur état, incidents avec `ended` null tant qu'ils sont ouverts
const COMPONENT = {
  OPERATIONAL: 'operationnel',
  NO_IMPACT: 'operationnel',
  DEGRADED_PERFORMANCE: 'degradation',
  PARTIAL_OUTAGE: 'degradation',
  MAJOR_OUTAGE: 'incident_majeur',
  MAINTENANCE: 'maintenance',
};
const UPDATE_STATE = { INVESTIGATING: 'investigating', IDENTIFIED: 'identified', MONITORING: 'monitoring' };

export function onlineornotStatus(status) {
  return COMPONENT[status] ?? 'inconnu';
}

// Décodage turbo-stream : entier = index dans le tableau, entier négatif = valeur spéciale
// (undefined, NaN, ±Infinity) rendue null ; objet {"_<i>": j} = clé arr[i], valeur arr[j] ;
// tableau ["D", i] = valeur typée (Date, Set…) rendue par sa charge utile
export function decodeTurboStream(flat) {
  const seen = new Map();
  const dec = (i) => {
    if (typeof i !== 'number') return i;
    if (i < 0) return null;
    if (seen.has(i)) return seen.get(i);
    const v = flat[i];
    let out;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && v[0].length === 1 && v.length === 2) out = dec(v[1]);
      else { out = []; seen.set(i, out); for (const x of v) out.push(dec(x)); }
    } else if (v && typeof v === 'object') {
      out = {}; seen.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k.startsWith('_') ? flat[Number(k.slice(1))] : k] = dec(x);
    } else out = v;
    seen.set(i, out);
    return out;
  };
  return dec(0);
}

export function parseOnlineornotHtml(html) {
  const chunks = [...html.matchAll(/streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => JSON.parse(`"${m[1]}"`));
  if (chunks.length === 0) return null;
  return decodeTurboStream(JSON.parse(chunks.join('')));
}

export async function collectOnlineornot(provider, get) {
  const url = provider.source.url;
  try {
    const res = await get(url);
    if (!res.ok) return { status: 'inconnu', collect: { state: 'error', error: `HTTP ${res.status} sur ${url}` } };
    const doc = parseOnlineornotHtml(await res.text());
    const rawComponents = doc?.loaderData?.root?.result?.components;
    if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
      return { status: 'inconnu', collect: { state: 'error', error: 'données SSR introuvables ou sans composant (structure de page changée ?)' } };
    }
    const components = rawComponents.filter((c) => c?.name).map((c) => ({ name: c.name, status: onlineornotStatus(c.status) }));
    const byDay = doc?.loaderData?.['routes/_index']?.result?.incidents ?? {};
    const open = Object.values(byDay).flat().filter((i) => i && i.ended == null);
    return {
      status: worstOf(components.map((c) => c.status)),
      rawStatus: `${components.length} components : ${summarize(rawComponents)}`,
      rawIndicator: 'ssr',
      components,
      incidents: open.map((i) => ({
        title: i.title,
        state: UPDATE_STATE[i.updates?.[0]?.status] ?? 'en cours',
        createdAt: i.started ?? null,
        updatedAt: i.updates?.[0]?.createdAt ?? null,
        url: i.id ? `${url.replace(/\/+$/, '')}/incidents/${i.id}` : null,
      })),
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}

function summarize(components) {
  const counts = {};
  for (const c of components) counts[c.status ?? '?'] = (counts[c.status ?? '?'] ?? 0) + 1;
  return Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
}
