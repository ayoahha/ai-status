import { fail } from '../lib/errors.mjs';

// Alibaba Cloud : l'API publique /api/status/listHistoryEvent fournit les événements
// du statut cloud global (pas Qwen en particulier). Un événement sans fin (ou avec fin
// dans le futur) = en cours. Seuls les événements en cours sont exposés.
export async function collect(provider, get) {
  const data = await get(provider.source.url.replace(/\/+$/, '') + '/api/status/listHistoryEvent');
  const events = data?.data;
  if (!Array.isArray(events)) throw fail('schema', 'listHistoryEvent');
  const now = Date.now();
  const ongoing = events.filter((e) => !e.endTime || e.endTime > now);
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
