import { fail } from '../lib/errors.mjs';

// Pages Better Stack (Together AI) : endpoint public documenté /index.json
// (https://betterstack.com/docs/uptime/status-pages/subscribing-to-status-updates/subscribing-to-api/)
// Réponse JSON:API : data.attributes.aggregate_state, included[] de types
// status_page_resource (status), status_report (incidents et maintenances, ends_at null si en cours)
const STATE = { operational: 'operationnel', degraded: 'degradation', downtime: 'incident_majeur', maintenance: 'maintenance' };

export function betterstackStatus(state) {
  return STATE[state] ?? 'inconnu';
}

// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'API Better Stack', en: 'Better Stack API' };

export async function collect(provider, get) {
  const doc = await get(provider.source.url.replace(/\/+$/, '') + '/index.json');
  const aggregate = doc?.data?.attributes?.aggregate_state;
  const included = doc?.included;
  if (typeof aggregate !== 'string' || !Array.isArray(included)) throw fail('schema', 'index.json (aggregate_state / included)');
  const resources = included.filter((i) => i.type === 'status_page_resource');
  if (resources.length === 0) throw fail('schema', 'index.json (0 status_page_resource)');
  const nameOf = new Map(resources.map((r) => [String(r.id), r.attributes?.public_name]));
  // not_monitored : la page ne mesure pas cette ressource, on ne la déclare pas saine
  const components = resources.map((r) => ({ name: r.attributes?.public_name ?? String(r.id), status: betterstackStatus(r.attributes?.status) }));
  const reports = included.filter((i) => i.type === 'status_report' && i.attributes && i.attributes.ends_at == null);
  const affected = (r) => (r.attributes.affected_resources ?? []).map((a) => nameOf.get(String(a.status_page_resource_id))).filter(Boolean);
  const incidents = reports.filter((r) => r.attributes.report_type !== 'maintenance').map((r) => ({
    title: r.attributes.title,
    state: 'en cours',
    impact: r.attributes.aggregate_state ?? null,
    createdAt: r.attributes.starts_at ?? null,
    updatedAt: null,
    url: null,
    components: affected(r),
  }));
  const maintenances = reports.filter((r) => r.attributes.report_type === 'maintenance').map((r) => ({
    title: r.attributes.title,
    state: r.attributes.starts_at && Date.parse(r.attributes.starts_at) > Date.now() ? 'scheduled' : 'in_progress',
    scheduledFor: r.attributes.starts_at ?? null,
    scheduledUntil: null,
    url: null,
  }));
  return {
    indicator: betterstackStatus(aggregate),
    rawStatus: aggregate,
    rawIndicator: aggregate,
    components,
    incidents,
    maintenances,
  };
}
