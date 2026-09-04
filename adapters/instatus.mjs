import { worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Pages Instatus (Perplexity) : API publique documentée (https://instat.us/public-api)
//   /summary.json        : état de page, incidents et maintenances actives
//   /v2/components.json  : composants et leur état
// Vocabulaire Instatus → enum du site ; tout mot inconnu rend le composant « inconnu »
const COMPONENT = {
  OPERATIONAL: 'operationnel',
  UNDERMAINTENANCE: 'maintenance',
  DEGRADEDPERFORMANCE: 'degradation',
  PARTIALOUTAGE: 'degradation',
  MAJOROUTAGE: 'incident_majeur',
};
const PAGE = { UP: 'operationnel', HASISSUES: 'degradation', UNDERMAINTENANCE: 'maintenance' };
const INCIDENT_STATE = { INVESTIGATING: 'investigating', IDENTIFIED: 'identified', MONITORING: 'monitoring' };
const MAINTENANCE_STATE = { NOTSTARTEDYET: 'scheduled', INPROGRESS: 'in_progress' };

export function instatusComponentStatus(status) {
  return COMPONENT[status] ?? 'inconnu';
}

export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const [summary, comps] = await Promise.all([get(`${base}/summary.json`), get(`${base}/v2/components.json`)]);
  const raw = comps?.components;
  const pageStatus = summary?.page?.status;
  if (typeof pageStatus !== 'string' || !Array.isArray(raw) || raw.length === 0) throw fail('schema', 'page.status ou components');
  const components = raw.map((c) => ({ name: c.name, status: instatusComponentStatus(c.status) }));
  const maintenances = (summary.activeMaintenances ?? []).map((m) => ({
    title: m.name,
    state: MAINTENANCE_STATE[m.status] ?? String(m.status ?? '').toLowerCase(),
    scheduledFor: m.start ?? null,
    scheduledUntil: null,
    url: m.url ?? null,
  }));
  const inProgress = maintenances.some((m) => m.state === 'in_progress');
  return {
    status: worstOf([PAGE[pageStatus] ?? 'inconnu', ...components.map((c) => c.status), ...(inProgress ? ['maintenance'] : [])]),
    rawStatus: pageStatus,
    rawIndicator: pageStatus,
    components,
    incidents: (summary.activeIncidents ?? []).map((i) => ({
      title: i.name,
      state: INCIDENT_STATE[i.status] ?? 'en cours',
      impact: i.impact ?? null,
      createdAt: i.started ?? null,
      updatedAt: i.updatedAt ?? null,
      url: i.url ?? null,
    })),
    maintenances,
  };
}
