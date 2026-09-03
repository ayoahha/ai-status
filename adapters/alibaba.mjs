import { fetchJson } from '../lib/http.mjs';

// Alibaba Cloud : l'API publique /api/status/listHistoryEvent fournit les événements
// (passe et en cours). Un événement sans fin (ou avec fin dans le futur) = en cours.
export async function collectAlibaba(provider, get) {
  const url = provider.source.url.replace(/\/+$/, '') + '/api/status/listHistoryEvent';
  try {
    const res = await (get ?? fetchJson)(url);
    if (!res.ok) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: `HTTP ${res.status} sur l'API Alibaba` },
      };
    }
    const data = await res.json();
    const events = data.data ?? [];
    const now = Date.now();
    const ongoing = events.filter((e) => !e.endTime || e.endTime > now);
    const impacted = events
      .flatMap((e) => e.products ?? [])
      .filter(Boolean);
    return {
      status: ongoing.length > 0 ? 'degradation' : 'operationnel',
      rawStatus:
        ongoing.length > 0
          ? `${ongoing.length} événement(s) en cours`
          : 'Aucun incident en cours (dernier événement récupéré)',
      rawIndicator: ongoing.length > 0 ? 'ALARM' : 'NONE',
      components: [...new Set(impacted)],
      incidents: events.map((e) => ({
        title: (e.title ?? '').replace(/^\s*\[Incident \(Recovered\)\]\s*/, ''),
        state: !e.endTime || e.endTime > now ? 'en cours' : 'récupéré',
        startedAt: e.startTime ? new Date(e.startTime).toISOString() : null,
      })),
      sourcePublishedAt: events[0]?.lastUpdateTime ? new Date(events[0].lastUpdateTime).toISOString() : null,
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
