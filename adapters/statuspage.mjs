import { normalizeIndicator, normalizeComponentStatus } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Adaptateur générique pour les pages Atlassian Statuspage (API v2 publique, sans jeton).
// Un seul appel : /api/v2/summary.json renvoie l'indicateur de page, les composants,
// les incidents non résolus et les maintenances planifiées.
// Limite : les composants « only_show_if_degraded » n'apparaissent que dégradés.
// Utilisé par : Anthropic, OpenAI, Cursor, Moonshot, MiniMax, Groq, Replicate, Cohere, Fireworks.
// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'API Statuspage', en: 'Statuspage API' };

const INCIDENT_STATES = new Set(['investigating', 'identified', 'monitoring', 'resolved']);
const MAINTENANCE_STATES = new Set(['scheduled', 'in_progress', 'verifying', 'completed']);

export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const data = await get(`${base}/api/v2/summary.json`);
  const indicator = data?.status?.indicator;
  if (typeof indicator !== 'string' || !Array.isArray(data.components) || (data.incidents !== undefined && !Array.isArray(data.incidents)) || (data.scheduled_maintenances !== undefined && !Array.isArray(data.scheduled_maintenances))) throw fail('schema', 'summary.json (status.indicator / components / incidents / scheduled_maintenances)');
  const incidents = data.incidents ?? [];
  const scheduledMaintenances = data.scheduled_maintenances ?? [];

  // Les groupes agrègent leurs enfants : ignorés pour ne pas compter deux fois
  const components = data.components
    .filter((c) => !c.group)
    .map((c) => ({ name: c.name, status: normalizeComponentStatus(c.status) }));
  if (incidents.some((incident) => !INCIDENT_STATES.has(incident?.status)) || scheduledMaintenances.some((maintenance) => !MAINTENANCE_STATES.has(maintenance?.status))) throw fail('schema', 'summary.json (incident / maintenance status)');
  const maintenances = scheduledMaintenances
    .filter((m) => m.status !== 'completed')
    .map((m) => ({
      title: m.name,
      state: m.status, // scheduled | in_progress | verifying
      scheduledFor: m.scheduled_for ?? null,
      scheduledUntil: m.scheduled_until ?? null,
      url: m.shortlink ?? null,
    }));

  return {
    indicator: normalizeIndicator(indicator),
    rawStatus: data.status?.description ?? null,
    rawIndicator: indicator,
    components,
    incidents: incidents.filter((i) => i.status !== 'resolved').map((i) => ({
      title: i.name,
      state: i.status, // investigating | identified | monitoring
      impact: i.impact ?? null,
      createdAt: i.created_at ?? null,
      updatedAt: i.updated_at ?? null,
      url: i.shortlink ?? null,
      components: (i.components ?? []).map((c) => c.name),
    })),
    maintenances,
  };
}
