import { fail } from '../lib/errors.mjs';
import { STATUS_LIMITS } from '../public/status-contract.js';

// Alibaba Cloud : l'API publique /api/status/listHistoryEvent fournit les événements
// du statut cloud global (pas Qwen en particulier). Un événement sans fin (ou avec fin
// dans le futur) = en cours. Seuls les événements en cours sont exposés.
// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'API Alibaba Cloud', en: 'Alibaba Cloud API' };

const validTime = (value) => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());

export async function collect(provider, get) {
  const data = await get(provider.source.url.replace(/\/+$/, '') + '/api/status/listHistoryEvent');
  const events = data?.data;
  if (data?.success !== true || data?.code !== 200 || data?.httpCode !== 200 || !Array.isArray(events) || events.length > STATUS_LIMITS.events) throw fail('schema', 'listHistoryEvent');
  for (const event of events) {
    if (!event || !Object.hasOwn(event, 'endTime') || !validTime(event.startTime) || !(event.endTime === null || validTime(event.endTime)) || (event.products != null && (!Array.isArray(event.products) || event.products.length > STATUS_LIMITS.eventComponents))) throw fail('schema', 'listHistoryEvent (event)');
  }
  const now = Date.now();
  const ongoing = events.filter((e) => e.endTime === null || e.endTime > now);
  return {
    indicator: ongoing.length > 0 ? 'degradation' : 'operationnel',
    rawStatus:
      ongoing.length > 0
        ? `${ongoing.length} événement(s) en cours`
        : 'Aucun incident déclaré (statut cloud global)',
    rawIndicator: ongoing.length > 0 ? 'ALARM' : 'NONE',
    components: [],
    incidents: ongoing.map((e) => ({
      title: (e.title ?? '').replace(/^\s*\[Incident[^\]]*\]\s*/, ''),
      state: 'en cours',
      createdAt: e.startTime ? new Date(e.startTime).toISOString() : null,
      components: (e.products ?? []).filter(Boolean),
    })),
  };
}
