import { fail } from '../lib/errors.mjs';
import { STATUS_LIMITS } from '../public/status-contract.js';

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

// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'données SSR de la page OnlineOrNot', en: 'OnlineOrNot page SSR data' };

export async function collect(provider, get) {
  const url = provider.source.url;
  const doc = parseOnlineornotHtml(await get(url, { as: 'text' }));
  const rawComponents = doc?.loaderData?.root?.result?.components;
  if (!Array.isArray(rawComponents) || rawComponents.length === 0 || rawComponents.length > STATUS_LIMITS.components) throw fail('schema', 'SSR (loaderData.root.result.components)');
  const components = rawComponents.filter((c) => c?.name).map((c) => ({ name: c.name, status: onlineornotStatus(c.status) }));
  const byDay = doc?.loaderData?.['routes/_index']?.result?.incidents ?? {};
  if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay)) throw fail('schema', 'SSR (incidents)');
  const groups = new Set();
  const incidents = new Set();
  const open = [];
  let visited = 0;
  for (const group of Object.values(byDay)) {
    if (!Array.isArray(group) || groups.has(group)) throw fail('schema', 'SSR (incidents aliasés)');
    groups.add(group);
    for (const incident of group) {
      if (++visited > STATUS_LIMITS.events) throw fail('limit', 'incidents SSR');
      if (!incident || typeof incident !== 'object' || incidents.has(incident)) throw fail('schema', 'SSR (incident)');
      incidents.add(incident);
      if (incident.ended == null) open.push(incident);
    }
  }
  return {
    indicator: null,
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
  };
}

function summarize(components) {
  const counts = {};
  for (const c of components) counts[c.status ?? '?'] = (counts[c.status ?? '?'] ?? 0) + 1;
  return Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
}
