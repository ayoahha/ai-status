import { fetchText } from '../lib/http.mjs';

// Sources sans API/flux publics documentés (xAI bloquée par Cloudflare, DeepSeek et
// Zhipu en SPA). On tente quand même la page : si la réponse n'est ni JSON ni une
// page de statut exploitable, le fournisseur passe en "Non vérifié" — jamais en
// "Opérationnel".
export async function collectSimple(provider, getText) {
  const url = provider.source.url;
  try {
    const res = await (getText ?? fetchText)(url);
    if (res.status === 403) {
      return {
        status: 'inconnu',
        rawStatus: null,
        rawIndicator: 'http_403',
        components: [],
        incidents: [],
        sourcePublishedAt: null,
        collect: { state: 'error', error: 'HTTP 403 (page protégée, non contournée)' },
      };
    }
    if (!res.ok) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: `HTTP ${res.status} sur ${url}` },
      };
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      const indicator = data.indicator ?? data.status ?? null;
      // Schéma inconnu : on garde l'indicateur brut et on ne devine pas.
      return {
        status: 'inconnu',
        rawStatus: typeof indicator === 'string' ? indicator : JSON.stringify(indicator),
        rawIndicator: typeof indicator === 'string' ? indicator : 'json_non_reconnu',
        components: [],
        incidents: [],
        sourcePublishedAt: data.updated_at ?? data.publishedAt ?? null,
        collect: { state: 'ok', error: null },
      };
    }
    // Réponse HTML : SPA côté client, pas de données publiques exploitables.
    return {
      status: 'inconnu',
      rawStatus: null,
      rawIndicator: 'spa',
      components: [],
      incidents: [],
      sourcePublishedAt: null,
      collect: {
        state: 'error',
        error: 'réponse HTML (SPA) : données chargées côté client, aucune API/flux public trouvé',
      },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: {
        state: 'error',
        error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}`,
      },
    };
  }
}
