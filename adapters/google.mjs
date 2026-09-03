import { normalizeGoogleImpact, worstOf } from '../lib/normalize.mjs';

// Google Cloud Service Health publie deux flux JSON officiels :
//   /products.json  : liste des produits (id, title)
//   /incidents.json : incidents des derniers mois, `end` null tant qu'ils sont ouverts,
//                     `affected_products[].title`, `status_impact`
// Le périmètre est restreint aux produits dont le titre commence par un des
// `source.productPrefixes` (Vertex, Gemini) : le reste de GCP est ignoré.
// Un état « opérationnel » signifie ici « aucun incident déclaré sur ce périmètre »,
// pas une mesure directe du produit.
export async function collectGoogle(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const prefixes = provider.source.productPrefixes ?? [];
  const inScope = (title) => prefixes.some((p) => (title ?? '').startsWith(p));
  try {
    const [pres, ires] = await Promise.all([get(`${base}/products.json`), get(`${base}/incidents.json`)]);
    if (!pres.ok || !ires.ok) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: `HTTP ${pres.status} sur products.json, HTTP ${ires.status} sur incidents.json` },
      };
    }
    const products = (await pres.json()).products;
    const incidents = await ires.json();
    if (!Array.isArray(products) || !Array.isArray(incidents)) {
      return { status: 'inconnu', collect: { state: 'error', error: 'schéma products.json ou incidents.json inattendu' } };
    }
    const scoped = products.map((p) => p.title).filter(inScope);
    if (scoped.length === 0) {
      return { status: 'inconnu', collect: { state: 'error', error: `aucun produit du périmètre (${prefixes.join(', ')}) dans products.json` } };
    }

    const ongoing = incidents
      .filter((i) => i.end == null)
      .map((i) => ({
        title: i.external_desc ?? i.service_name ?? 'incident',
        impact: normalizeGoogleImpact(i.status_impact),
        products: (i.affected_products ?? []).map((p) => p.title).filter(inScope),
        startedAt: i.begin ?? null,
        updatedAt: i.modified ?? null,
        url: i.uri ? `${base}${i.uri.startsWith('/') ? '' : '/'}${i.uri}` : null,
      }))
      // SERVICE_INFORMATION (impact null) est informatif : ignoré
      .filter((i) => i.products.length > 0 && i.impact);

    const impacted = [...new Set(ongoing.flatMap((i) => i.products))];
    return {
      status: worstOf(ongoing.map((i) => i.impact)),
      rawStatus:
        ongoing.length === 0
          ? `Aucun incident déclaré (périmètre ${prefixes.join(' / ')}, ${scoped.length} produits)`
          : `${ongoing.length} incident(s) en cours : ${impacted.join(', ')}`,
      rawIndicator: ongoing.length === 0 ? 'no_incident' : 'incident',
      components: impacted,
      incidents: ongoing.map((i) => ({
        title: i.title,
        state: 'en cours',
        impact: i.impact,
        createdAt: i.startedAt,
        updatedAt: i.updatedAt,
        url: i.url,
        components: i.products,
      })),
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
