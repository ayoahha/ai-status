import { normalizeGoogleImpact, worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Google Cloud Service Health publie deux flux JSON officiels :
//   /products.json  : liste des produits (id, title)
//   /incidents.json : incidents des derniers mois, `end` null tant qu'ils sont ouverts,
//                     `affected_products[].title`, `status_impact`
// Le périmètre est restreint aux produits dont le titre commence par un des
// `source.productPrefixes` (Vertex, Gemini) : le reste de GCP est ignoré.
// Un état « opérationnel » signifie ici « aucun incident déclaré sur ce périmètre »,
// pas une mesure directe du produit.
export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const prefixes = provider.source.productPrefixes ?? [];
  const inScope = (title) => prefixes.some((p) => (title ?? '').startsWith(p));
  const [pdoc, incidents] = await Promise.all([get(`${base}/products.json`), get(`${base}/incidents.json`)]);
  const products = pdoc?.products;
  if (!Array.isArray(products) || !Array.isArray(incidents)) throw fail('schema', 'products.json ou incidents.json');
  const scoped = products.map((p) => p.title).filter(inScope);
  if (scoped.length === 0) throw fail('scope', `${prefixes.join(', ')} (products.json)`);

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
  // État d'un produit = pire impact des incidents ouverts qui le citent
  const productStatus = (title) => worstOf(ongoing.filter((i) => i.products.includes(title)).map((i) => i.impact));
  return {
    status: worstOf(ongoing.map((i) => i.impact)),
    rawStatus:
      ongoing.length === 0
        ? `Aucun incident déclaré (périmètre ${prefixes.join(' / ')}, ${scoped.length} produits)`
        : `${ongoing.length} incident(s) en cours : ${impacted.join(', ')}`,
    rawIndicator: ongoing.length === 0 ? 'no_incident' : 'incident',
    components: scoped.map((title) => ({ name: title, status: productStatus(title) })),
    incidents: ongoing.map((i) => ({
      title: i.title,
      state: 'en cours',
      impact: i.impact,
      createdAt: i.startedAt,
      updatedAt: i.updatedAt,
      url: i.url,
      components: i.products,
    })),
  };
}
