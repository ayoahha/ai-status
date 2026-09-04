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
const UPDATE_STATE = { INVESTIGATING: 'investigating', IDENTIFIED: 'identified', MONITORING: 'monitoring', UPDATE: 'en cours' };

export function onlineornotStatus(status) {
  return Object.hasOwn(COMPONENT, status) ? COMPONENT[status] : 'inconnu';
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
      for (const [k, x] of Object.entries(v)) {
        const key = k.startsWith('_') ? flat[Number(k.slice(1))] : k;
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) throw fail('schema', 'SSR (clé turbo-stream)');
        out[key] = dec(x);
      }
    } else out = v;
    seen.set(i, out);
    return out;
  };
  return dec(0);
}

export function parseOnlineornotHtml(html) {
  const chunks = [...html.matchAll(/streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => JSON.parse(`"${m[1]}"`));
  if (chunks.length === 0) return null;
  const flat = JSON.parse(chunks.join(''));
  return Array.isArray(flat) ? decodeTurboStream(flat) : null;
}

// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'données SSR de la page OnlineOrNot', en: 'OnlineOrNot page SSR data' };

export async function collect(provider, get) {
  const url = provider.source.url;
  const doc = parseOnlineornotHtml(await get(url, { as: 'text' }));
  const rawComponents = doc?.loaderData?.root?.result?.components;
  if (!Array.isArray(rawComponents) || rawComponents.length === 0 || rawComponents.length > STATUS_LIMITS.components) throw fail('schema', 'SSR (loaderData.root.result.components)');
  const componentObjects = new Set();
  const componentNames = new Set();
  const components = rawComponents.map((component) => {
    if (!component || typeof component !== 'object' || Array.isArray(component) || componentObjects.has(component) || typeof component.name !== 'string' || !component.name || componentNames.has(component.name) || typeof component.status !== 'string') throw fail('schema', 'SSR (components)');
    componentObjects.add(component);
    componentNames.add(component.name);
    return { name: component.name, status: onlineornotStatus(component.status) };
  });
  const result = doc?.loaderData?.['routes/_index']?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Object.hasOwn(result, 'incidents') || !Object.hasOwn(result, 'activeIncidents')) throw fail('schema', 'SSR (incidents)');
  const byDay = result.incidents;
  const active = result.activeIncidents;
  if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay) || !Array.isArray(active) || active.length > STATUS_LIMITS.events) throw fail('schema', 'SSR (incidents)');
  const groups = new Set();
  const incidents = new Set();
  const historicalOpen = new Set();
  let visited = 0;
  for (const group of Object.values(byDay)) {
    if (!Array.isArray(group) || groups.has(group)) throw fail('schema', 'SSR (incidents aliasés)');
    groups.add(group);
    for (const incident of group) {
      if (++visited > STATUS_LIMITS.events) throw fail('limit', 'incidents SSR');
      if (!incident || typeof incident !== 'object' || Array.isArray(incident) || incidents.has(incident) || typeof incident.id !== 'string' || !incident.id || !Object.hasOwn(incident, 'ended') || !(incident.ended === null || (typeof incident.ended === 'string' && Number.isFinite(Date.parse(incident.ended))))) throw fail('schema', 'SSR (incident)');
      incidents.add(incident);
      if (incident.ended === null) historicalOpen.add(incident.id);
    }
  }
  const activeIds = new Set();
  for (const incident of active) {
    const state = incident?.updates?.[0]?.status;
    if (!incident || typeof incident !== 'object' || Array.isArray(incident) || typeof incident.id !== 'string' || !incident.id || activeIds.has(incident.id) || typeof incident.title !== 'string' || !incident.title || incident.ended !== null || !Object.hasOwn(UPDATE_STATE, state)) throw fail('schema', 'SSR (activeIncidents)');
    activeIds.add(incident.id);
  }
  if ([...historicalOpen].some((id) => !activeIds.has(id))) throw fail('schema', 'SSR (incidents actifs incohérents)');
  return {
    indicator: null,
    rawStatus: `${components.length} components : ${summarize(rawComponents)}`,
    rawIndicator: 'ssr',
    components,
    incidents: active.map((i) => ({
      title: i.title,
      state: UPDATE_STATE[i.updates[0].status],
      impact: onlineornotStatus(i.impact),
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
