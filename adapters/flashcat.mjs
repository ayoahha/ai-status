// Pages de statut Flashcat (DeepSeek) : l'API JSON de la SPA est accessible en fetch
// simple : /api/status-page/<pageId>/summary/active renvoie les composants et les
// changements actifs (incidents, maintenances).
// Le schéma des `active_changes` n'a jamais été observé non vide : un changement actif
// donne « degradation » avec son texte brut, jamais plus précis tant qu'une fixture réelle
// n'existe pas. Un payload sans composants n'est jamais traité comme sain.
export async function collectFlashcat(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const url = `${base}/api/status-page/${provider.source.pageId}/summary/active`;
  try {
    const res = await get(url);
    if (!res.ok) {
      return { status: 'inconnu', collect: { state: 'error', error: `HTTP ${res.status} sur ${url}` } };
    }
    const data = (await res.json())?.data;
    const components = data?.page?.components;
    const changes = data?.active_changes;
    if (!Array.isArray(components) || components.length === 0 || !Array.isArray(changes)) {
      return { status: 'inconnu', collect: { state: 'error', error: 'schéma summary/active inattendu (composants ou active_changes absents)' } };
    }
    const titles = changes.map((c) => c.title ?? c.name ?? JSON.stringify(c).slice(0, 120));
    return {
      status: changes.length === 0 ? 'operationnel' : 'degradation',
      rawStatus: changes.length === 0 ? `Aucun changement actif (${components.length} services)` : titles.join(' ; '),
      rawIndicator: changes.length === 0 ? 'no_active_change' : 'active_change',
      // Sans schéma connu des changements, l'état par service reste illisible en incident
      components: components.map((c) => ({ name: c.name, status: changes.length === 0 ? 'operationnel' : 'inconnu' })),
      incidents: titles.map((t) => ({ title: t, state: 'en cours', createdAt: null })),
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
