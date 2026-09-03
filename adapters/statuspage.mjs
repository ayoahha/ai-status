import { normalizeIndicator } from '../lib/normalize.mjs';

// Adaptateur générique pour les pages Atlassian Statuspage (nouvelle génération,
// API v2 publique, sans jeton). Utilisé par :
// Anthropic, OpenAI, Cursor, Moonshot, MiniMax, Groq, Replicate, Cohere, Fireworks.
export async function collectStatuspage(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  try {
    const res = await get(`${base}/api/v2/status.json?lookback=3600`);
    if (!res.ok) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: `HTTP ${res.status} sur ${base}/api/v2/status.json` },
      };
    }
    const data = await res.json();
    const indicator = data.status?.indicator ?? 'none';
    const result = {
      status: normalizeIndicator(indicator),
      rawStatus: data.status?.description ?? null,
      rawIndicator: indicator,
      components: [],
      incidents: [],
      sourcePublishedAt: data.page?.updated_at ?? null,
      collect: { state: 'ok', error: null },
    };

    // Incidents récents (72 h) — seulement si la source les fournit.
    try {
      const ires = await get(`${base}/api/v2/incidents.json?lookback=259200`);
      if (ires.ok) {
        const idata = await ires.json();
        result.incidents = (idata.incidents ?? []).map((i) => ({
          title: i.name,
          state: i.status, // "investigating" | "monitoring" | "resolved"
          createdAt: i.created_at ?? null,
        }));
      }
    } catch {
      // Les incidents sont optionnels ; le statut principal reste fiable.
    }

    // Composants impactés : seuls ceux dont l'indicateur n'est pas "none".
    try {
      const cres = await get(`${base}/api/v2/components.json?per_page=100`);
      if (cres.ok) {
        const cdata = await cres.json();
        result.components = (cdata.components ?? [])
          .filter((c) => c.status && c.status !== 'none')
          .map((c) => c.name);
      }
    } catch {
      // Idem : les composants sont optionnels.
    }
    return result;
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
