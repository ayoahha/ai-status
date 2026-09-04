import { fail } from '../lib/errors.mjs';

// Pages de statut Flashcat (DeepSeek) : l'API JSON de la SPA est accessible en fetch
// simple : /api/status-page/<pageId>/summary/active renvoie les composants et les
// changements actifs (incidents, maintenances).
// Le schéma des `active_changes` n'a jamais été observé non vide : un changement actif
// donne « degradation » avec son texte brut, jamais plus précis tant qu'une fixture réelle
// n'existe pas. Un payload sans composants n'est jamais traité comme sain.
export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const data = (await get(`${base}/api/status-page/${provider.source.pageId}/summary/active`))?.data;
  const components = data?.page?.components;
  const changes = data?.active_changes;
  if (!Array.isArray(components) || components.length === 0 || !Array.isArray(changes)) throw fail('schema', 'summary/active (composants ou active_changes)');
  const titles = changes.map((c) => c.title ?? c.name ?? JSON.stringify(c).slice(0, 120));
  return {
    indicator: changes.length === 0 ? 'operationnel' : 'degradation',
    rawStatus: changes.length === 0 ? `Aucun changement actif (${components.length} services)` : titles.join(' ; '),
    rawIndicator: changes.length === 0 ? 'no_active_change' : 'active_change',
    // Sans schéma connu des changements, l'état par service reste illisible en incident
    components: components.map((c) => ({ name: c.name, status: changes.length === 0 ? 'operationnel' : 'inconnu' })),
    incidents: titles.map((t) => ({ title: t, state: 'en cours', createdAt: null })),
  };
}
