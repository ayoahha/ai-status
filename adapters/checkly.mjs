import { worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';
import { STATUS_LIMITS } from '../public/status-contract.js';

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
  return Object.hasOwn(SEVERITY, severity) ? SEVERITY[severity] : 'inconnu';
}

// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'API JSON de la page Checkly', en: 'Checkly page JSON API' };

export async function collect(provider, get) {
  const base = `${provider.source.url.replace(/\/+$/, '')}/api/status-page/${provider.source.slug}`;
  const [udoc, idoc, windows] = await Promise.all([get(`${base}/uptime`), get(`${base}/unresolved-incidents`), get(`${base}/maintenance-windows`)]);
  const groups = udoc?.metadata;
  const incidents = idoc?.incidents;
  const upcoming = windows?.upcoming ?? [];
  if (!Array.isArray(groups) || groups.length > STATUS_LIMITS.components || !Array.isArray(incidents) || incidents.length > STATUS_LIMITS.events || !Array.isArray(windows?.active) || !Array.isArray(upcoming) || windows.active.length + upcoming.length > STATUS_LIMITS.events) throw fail('schema', 'uptime.metadata / unresolved-incidents.incidents / maintenance-windows');
  const services = [];
  const byId = new Map();
  const byName = new Map();
  for (const group of groups) {
    if (!Array.isArray(group?.services) || group.services.length > STATUS_LIMITS.components) throw fail('schema', 'uptime.metadata[].services');
    for (const service of group.services) {
      if (!service || typeof service.id !== 'string' || !service.id || typeof service.name !== 'string' || !service.name || byId.has(service.id) || byName.has(service.name) || services.length >= STATUS_LIMITS.components) throw fail('schema', 'uptime.metadata[].services (id / name)');
      services.push(service);
      byId.set(service.id, service);
      byName.set(service.name, service);
    }
  }
  if (services.length === 0) throw fail('schema', 'uptime.metadata (0 services)');

  if (incidents.some((incident) => incident?.lastUpdateStatus !== 'RESOLVED' && !Object.hasOwn(UPDATE_STATE, incident?.lastUpdateStatus))) throw fail('schema', 'unresolved-incidents.incidents (lastUpdateStatus)');
  const open = incidents.filter((incident) => incident.lastUpdateStatus !== 'RESOLVED').map((incident) => {
    if (incident.services != null && (!Array.isArray(incident.services) || incident.services.length > STATUS_LIMITS.eventComponents)) throw fail('schema', 'unresolved-incidents.incidents[].services');
    const linked = [];
    const seen = new Set();
    for (const ref of incident.services ?? []) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw fail('schema', 'unresolved-incidents.incidents[].services[]');
      const byServiceId = typeof ref.id === 'string' ? byId.get(ref.id) : null;
      const byServiceName = typeof ref.name === 'string' ? byName.get(ref.name) : null;
      if ((!byServiceId && !byServiceName) || (byServiceId && byServiceName && byServiceId !== byServiceName)) throw fail('scope', 'unresolved-incidents.incidents[].services[]');
      const service = byServiceId ?? byServiceName;
      if (seen.has(service.id)) throw fail('schema', 'unresolved-incidents.incidents[].services[] (doublon)');
      seen.add(service.id);
      linked.push(service);
    }
    return { ...incident, _services: incident.services == null ? null : linked, _impact: checklySeverity(incident.severity) };
  });
  // Service → pire sévérité des incidents ouverts qui le citent ; incident sans liste
  // lisible de services → tous les services illisibles
  const unreadable = open.some((incident) => incident._services === null);
  const impacts = new Map(services.map((service) => [service.id, []]));
  for (const incident of open) for (const service of incident._services ?? []) impacts.get(service.id).push(incident._impact);
  const components = services.map((service) => ({ name: service.name, status: unreadable ? 'inconnu' : worstOf(impacts.get(service.id)) }));
  const maintenances = [...windows.active.map((w) => ({ ...w, _state: 'in_progress' })), ...upcoming.map((w) => ({ ...w, _state: 'scheduled' }))]
    .map((w) => ({ title: w.name ?? w.title ?? 'maintenance', state: w._state, scheduledFor: w.startsAt ?? w.startAt ?? null, scheduledUntil: w.endsAt ?? w.endAt ?? null, url: null }));
  return {
    indicator: worstOf(open.map((incident) => incident._impact)),
    rawStatus: open.length ? `${open.length} unresolved incident(s)` : `No unresolved incident (${services.length} services)`,
    rawIndicator: open.length ? 'unresolved' : 'none',
    components,
    incidents: open.map((i) => ({
      title: i.name ?? i.title ?? 'incident',
      state: UPDATE_STATE[i.lastUpdateStatus],
      impact: i._impact,
      createdAt: i.created_at ?? i.createdAt ?? null,
      updatedAt: i.updated_at ?? i.updatedAt ?? null,
      url: null,
      components: i._services?.map((service) => service.name) ?? [],
    })),
    maintenances,
  };
}
