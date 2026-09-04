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
const INCIDENT_STATE = { INVESTIGATING: 'investigating', IDENTIFIED: 'identified', MONITORING: 'monitoring', RESOLVED: null };
const MAINTENANCE_STATE = { NOTSTARTEDYET: 'scheduled', INPROGRESS: 'in_progress', COMPLETED: null };

export function instatusComponentStatus(status) {
  return Object.hasOwn(COMPONENT, status) ? COMPONENT[status] : 'inconnu';
}

// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'API Instatus', en: 'Instatus API' };

export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const [summary, comps] = await Promise.all([get(`${base}/summary.json`), get(`${base}/v2/components.json`)]);
  const raw = comps?.components;
  const pageStatus = summary?.page?.status;
  const incidents = summary?.activeIncidents ?? [];
  const maintenances = summary?.activeMaintenances ?? [];
  if (!Object.hasOwn(PAGE, pageStatus) || !Array.isArray(raw) || raw.length === 0 || !Array.isArray(incidents) || !Array.isArray(maintenances)) throw fail('schema', 'summary.json (page.status / activeIncidents / activeMaintenances) / v2/components.json (components)');
  if (incidents.some((incident) => !Object.hasOwn(INCIDENT_STATE, incident?.status)) || maintenances.some((maintenance) => !Object.hasOwn(MAINTENANCE_STATE, maintenance?.status))) throw fail('schema', 'summary.json (incident / maintenance status)');
  const components = raw.map((c) => ({ name: c.name, status: instatusComponentStatus(c.status) }));
  const activeMaintenances = maintenances.filter((m) => MAINTENANCE_STATE[m.status]).map((m) => ({
    title: m.name,
    state: MAINTENANCE_STATE[m.status],
    scheduledFor: m.start ?? null,
    scheduledUntil: null,
    url: m.url ?? null,
  }));
  return {
    indicator: PAGE[pageStatus],
    rawStatus: pageStatus,
    rawIndicator: pageStatus,
    components,
    incidents: incidents.filter((i) => INCIDENT_STATE[i.status]).map((i) => ({
      title: i.name,
      state: INCIDENT_STATE[i.status],
      impact: i.impact ?? null,
      createdAt: i.started ?? null,
      updatedAt: i.updatedAt ?? null,
      url: i.url ?? null,
    })),
    maintenances: activeMaintenances,
  };
}
