import { worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Tencent Cloud status (status.cloud.tencent.com, Hunyuan) : la page Next.js appelle une API
// JSON publique sans jeton (observée dans ses requêtes, non documentée) :
//   /v1/api/status/DescribeProductEventForRegionInPeriod?RegionId=<région>&EndDate=<AAAA-MM-JJ>&NumOfDay=1
// Réponse : CategoryList[].ProductList[] avec ProductId, ProductName (chinois), CurrentStatus
// (NORMAL, NOTIFY = « 提示 », ABNORMAL = « 异常 » d'après le bundle de la page), CurrentEvent.
// Périmètre : produits dont ProductId figure dans source.productIds ; les produits Hunyuan
// sont « non-regional ». Une région inconnue renvoie une liste vide : traitée comme illisible
const STATE = { NORMAL: 'operationnel', NOTIFY: 'degradation', ABNORMAL: 'degradation' };

export function tencentStatus(status) {
  return STATE[status] ?? 'inconnu';
}

export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const region = provider.source.regionId;
  const ids = provider.source.productIds ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const url = `${base}/v1/api/status/DescribeProductEventForRegionInPeriod?RegionId=${encodeURIComponent(region)}&EndDate=${today}&NumOfDay=1`;
  const categories = (await get(url))?.Response?.Data?.CategoryList;
  if (!Array.isArray(categories)) throw fail('schema', 'DescribeProductEventForRegionInPeriod');
  const products = categories.flatMap((c) => c.ProductList ?? []).filter((p) => ids.includes(p.ProductId));
  if (products.length === 0) throw fail('scope', `${ids.join(', ')} (région ${region})`);
  const components = products.map((p) => ({ name: p.ProductName ?? p.ProductId, status: tencentStatus(p.CurrentStatus) }));
  const incidents = products
    .filter((p) => p.CurrentStatus !== 'NORMAL' && (p.CurrentEvent || p.ProductEventTitle))
    .map((p) => ({
      title: p.ProductEventTitle || p.CurrentEvent?.Title || p.CurrentEvent?.EventTitle || String(p.CurrentStatus),
      state: 'en cours',
      createdAt: null,
      url: p.Rss ?? null,
      components: [p.ProductName ?? p.ProductId],
    }));
  return {
    indicator: null,
    rawStatus: components.every((c) => c.status === 'operationnel') ? `NORMAL (${components.length} products)` : products.map((p) => `${p.ProductId}=${p.CurrentStatus}`).join(', '),
    rawIndicator: 'describe_product_event',
    components,
    incidents,
  };
}
