import { normalizeIndicator, normalizeComponentStatus, worstOf } from '../lib/normalize.mjs';

// Adaptateur générique pour les pages Atlassian Statuspage (API v2 publique, sans jeton).
// Un seul appel : /api/v2/summary.json renvoie l'indicateur de page, les composants,
// les incidents non résolus et les maintenances planifiées.
// Limite : les composants « only_show_if_degraded » n'apparaissent que dégradés.
// Utilisé par : Anthropic, OpenAI, Cursor, Moonshot, MiniMax, Groq, Replicate, Cohere, Fireworks.
export async function collectStatuspage(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const url = `${base}/api/v2/summary.json`;
  try {
    const res = await get(url);
    if (!res.ok) {
      return { status: 'inconnu', collect: { state: 'error', error: `HTTP ${res.status} sur ${url}` } };
    }
    const data = await res.json();
    const indicator = data.status?.indicator;
    if (typeof indicator !== 'string' || !Array.isArray(data.components)) {
      return { status: 'inconnu', collect: { state: 'error', error: 'schéma summary.json inattendu' } };
    }

    // Les groupes agrègent leurs enfants : ignorés pour ne pas compter deux fois
    const components = data.components
      .filter((c) => !c.group)
      .map((c) => ({ name: c.name, status: normalizeComponentStatus(c.status) }));
    const impacted = components.filter((c) => c.status !== 'operationnel');

    const maintenances = (data.scheduled_maintenances ?? [])
      .filter((m) => m.status !== 'completed')
      .map((m) => ({
        title: m.name,
        state: m.status, // scheduled | in_progress | verifying
        scheduledFor: m.scheduled_for ?? null,
        scheduledUntil: m.scheduled_until ?? null,
        url: m.shortlink ?? null,
      }));
    const inProgress = maintenances.some((m) => m.state === 'in_progress' || m.state === 'verifying');

    const status = worstOf([
      normalizeIndicator(indicator),
      ...impacted.map((c) => c.status),
      ...(inProgress ? ['maintenance'] : []),
    ]);

    return {
      status,
      rawStatus: data.status?.description ?? null,
      rawIndicator: indicator,
      components,
      incidents: (data.incidents ?? []).map((i) => ({
        title: i.name,
        state: i.status, // investigating | identified | monitoring
        impact: i.impact ?? null,
        createdAt: i.created_at ?? null,
        updatedAt: i.updated_at ?? null,
        url: i.shortlink ?? null,
        components: (i.components ?? []).map((c) => c.name),
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
