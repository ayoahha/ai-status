import { worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Pages Checkly (Mistral) : la page Nuxt appelle trois endpoints JSON publics, sans jeton
// (observés dans les requêtes de status.mistral.ai, non documentés par Checkly) :
//   /api/status-page/<slug>/uptime               groupes et services (metadata), événements par jour
//   /api/status-page/<slug>/unresolved-incidents incidents non résolus (severity, lastUpdateStatus, services)
//   /api/status-page/<slug>/maintenance-windows  fenêtres upcoming / active
// Un incident non résolu dont les services affectés ne sont pas lisibles rend tous les
// services « inconnu » : on ne déclare pas sain ce qu'on ne sait pas rattacher
const SEVERITY = { MINOR: 'degradation', MEDIUM: 'degradation', MAJOR: 'incident_majeur', CRITICAL: 'indisponible' };
const UPDATE_STATE = { INVESTIGATING: 'investigating', IDENTIFIED: 'identified', MONITORING: 'monitoring' };

export function checklySeverity(severity) {
  return SEVERITY[severity] ?? 'inconnu';
}

export async function collect(provider, get) {
  const base = `${provider.source.url.replace(/\/+$/, '')}/api/status-page/${provider.source.slug}`;
  const [udoc, idoc, windows] = await Promise.all([get(`${base}/uptime`), get(`${base}/unresolved-incidents`), get(`${base}/maintenance-windows`)]);
  const groups = udoc?.metadata;
  const incidents = idoc?.incidents;
  if (!Array.isArray(groups) || !Array.isArray(incidents) || !Array.isArray(windows?.active)) throw fail('schema', 'metadata, incidents ou active');
  const services = groups.flatMap((g) => g.services ?? []).filter((s) => s?.name);
  if (services.length === 0) throw fail('schema', 'uptime sans service');

  const open = incidents.filter((i) => i.lastUpdateStatus !== 'RESOLVED');
  // Service → pire sévérité des incidents ouverts qui le citent ; incident sans liste
  // lisible de services → tous les services illisibles
  const unreadable = open.some((i) => !Array.isArray(i.services));
  const statusOf = (s) => {
    if (unreadable) return 'inconnu';
    const hits = open.filter((i) => i.services.some((x) => x?.id === s.id || x?.name === s.name));
    return worstOf(hits.map((i) => checklySeverity(i.severity)));
  };
  const components = services.map((s) => ({ name: s.name, status: statusOf(s) }));
  const maintenances = [...windows.active.map((w) => ({ ...w, _state: 'in_progress' })), ...(windows.upcoming ?? []).map((w) => ({ ...w, _state: 'scheduled' }))]
    .map((w) => ({ title: w.name ?? w.title ?? 'maintenance', state: w._state, scheduledFor: w.startsAt ?? w.startAt ?? null, scheduledUntil: w.endsAt ?? w.endAt ?? null, url: null }));
  return {
    status: worstOf([...open.map((i) => checklySeverity(i.severity)), ...components.map((c) => c.status), ...(windows.active.length ? ['maintenance'] : [])]),
    rawStatus: open.length ? `${open.length} unresolved incident(s)` : `No unresolved incident (${services.length} services)`,
    rawIndicator: open.length ? 'unresolved' : 'none',
    components,
    incidents: open.map((i) => ({
      title: i.name ?? i.title ?? 'incident',
      state: UPDATE_STATE[i.lastUpdateStatus] ?? 'en cours',
      impact: i.severity ?? null,
      createdAt: i.created_at ?? i.createdAt ?? null,
      updatedAt: i.updated_at ?? i.updatedAt ?? null,
      url: null,
      components: Array.isArray(i.services) ? i.services.map((x) => x?.name ?? services.find((s) => s.id === x?.id)?.name).filter(Boolean) : [],
    })),
    maintenances,
  };
}
