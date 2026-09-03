import { fetchText } from '../lib/http.mjs';
import { normalizeGoogleClass } from '../lib/normalize.mjs';

// La page Google Cloud Service Health (status.cloud.google.com) est rendue côté
// serveur : chaque produit a une icône de statut dans le HTML. On parse les lignes
// <th ...product...>Nom</th> + icône psd-status-icon.
const PRIORITY = { available: 0, warning: 1, outage: 2, error: 2, maintenance: 1 };

export async function collectGoogle(provider, getText) {
  const url = provider.source.url;
  try {
    const res = await (getText ?? fetchText)(url);
    if (!res.ok) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: `HTTP ${res.status} sur ${url}` },
      };
    }
    const html = await res.text();
    const rows = [...html.matchAll(
      /<th class="[^"]*product[^"]*" scope="row">([^<]+)<\/th>\s*<td[^>]*>\s*<psd-status-icon[^>]*>\s*<svg class="psd__status-icon psd__([a-z]+)"/g
    )];
    if (rows.length === 0) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: 'structure psd-status-icon introuvable : la page a changé' },
      };
    }
    const products = [...rows].map((m) => ({ name: m[1].trim(), cls: m[2] }));
    let worst = 'available';
    for (const p of products) {
      if ((PRIORITY[p.cls] ?? 0) > (PRIORITY[worst] ?? 0)) worst = p.cls;
    }
    const impacted = products.filter((p) => p.cls !== 'available');
    return {
      status: normalizeGoogleClass(worst),
      rawStatus:
        impacted.length === 0
          ? 'Tous les produits disponibles'
          : `${impacted.length} produit(s) en alerte : ${impacted.map((p) => p.name).join(', ')}`,
      rawIndicator: worst,
      components: impacted.map((p) => p.name),
      incidents: [],
      sourcePublishedAt: null,
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
