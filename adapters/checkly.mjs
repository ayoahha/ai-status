import { worstOf } from '../lib/normalize.mjs';

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

export async function collectCheckly(provider, get) {
  const base = `${provider.source.url.replace(/\/+$/, '')}/api/status-page/${provider.source.slug}`;
  try {
    const [ures, ires, mres] = await Promise.all([get(`${base}/uptime`), get(`${base}/unresolved-incidents`), get(`${base}/maintenance-windows`)]);
    if (!ures.ok || !ires.ok || !mres.ok) {
      return { status: 'inconnu', collect: { state: 'error', error: `HTTP ${ures.status} sur uptime, ${ires.status} sur unresolved-incidents, ${mres.status} sur maintenance-windows` } };
    }
    const groups = (await ures.json())?.metadata;
    const incidents = (await ires.json())?.incidents;
    const windows = await mres.json();
    if (!Array.isArray(groups) || !Array.isArray(incidents) || !Array.isArray(windows?.active)) {
      return { status: 'inconnu', collect: { state: 'error', error: 'schéma Checkly inattendu (metadata, incidents ou active absents)' } };
    }
    const services = groups.flatMap((g) => g.services ?? []).filter((s) => s?.name);
    if (services.length === 0) return { status: 'inconnu', collect: { state: 'error', error: 'aucun service dans uptime' } };

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
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
