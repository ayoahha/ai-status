import { worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Volcengine status (status.volcengine.com, plateforme Ark qui sert les modèles Doubao) :
// l'API BFF de la page (/api/v1/shd/prefetch-shd) répond 401 hors navigateur, contrôle
// d'accès non contourné. La page lie un flux RSS officiel par produit et par région :
//   https://status.volcengine.com/rss/zh/<région>/<produit>
// Le flux liste l'historique complet ; un événement terminé porte « (已恢复) » dans son
// titre, un événement en cours ne le porte pas. Titre de canal « …(<région>)服务状态 » :
// une région inconnue renvoie des parenthèses vides et est traitée comme illisible
const ITEM = /<item>([\s\S]*?)<\/item>/g;
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : null;
};

export function parseVolcengineRss(xml) {
  const channel = xml.match(/<channel>[\s\S]*?<title>([^<]*)<\/title>/);
  const region = channel?.[1]?.match(/\(([^)]*)\)服务状态$/)?.[1] ?? null;
  const items = [...xml.matchAll(ITEM)].map((m) => ({
    title: tag(m[1], 'title') ?? '',
    description: tag(m[1], 'description') ?? '',
    pubDate: tag(m[1], 'pubDate'),
  }));
  return { region, items };
}

export async function collect(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const { product, productLabel, regions = [] } = provider.source;
  // Échec par région capturé ici : une région illisible ne fait pas échouer les autres
  const results = await Promise.all(regions.map(async (r) => {
    try {
      const parsed = parseVolcengineRss(await get(`${base}/rss/zh/${r}/${product}`, { as: 'text', accept: 'application/rss+xml,text/xml' }));
      return { id: r, parsed, why: parsed.region ? null : 'canal sans région' };
    } catch (err) {
      return { id: r, parsed: null, why: err.message };
    }
  }));
  const bad = results.filter((r) => r.why);
  if (bad.length === results.length) throw fail('schema', `aucun flux RSS lisible (${bad.map((r) => `${r.id}: ${r.why}`).join(', ')})`);
  const components = results.map((r) => {
    if (r.why) return { name: `${productLabel} (${r.id})`, status: 'inconnu' };
    const ongoing = r.parsed.items.filter((i) => !i.title.includes('已恢复'));
    return { name: `${productLabel} (${r.parsed.region})`, status: ongoing.length ? 'degradation' : 'operationnel', ongoing };
  });
  const incidents = components.flatMap((c) => (c.ongoing ?? []).map((i) => ({
    title: i.title,
    state: 'en cours',
    createdAt: i.pubDate && Number.isFinite(Date.parse(i.pubDate)) ? new Date(i.pubDate).toISOString() : null,
    url: `${base}/`,
    components: [c.name],
  })));
  const alerted = components.filter((c) => c.status !== 'operationnel').length;
  const badIds = bad.map((r) => r.id).join(', ');
  return {
    indicator: null,
    rawStatus: alerted ? `${alerted} region(s) with an unresolved event` : `No unresolved event (${components.length} regions)`,
    rawIndicator: alerted ? 'unresolved' : 'none',
    components: components.map(({ name, status }) => ({ name, status })),
    incidents,
    note: bad.length ? `régions illisibles : ${badIds}` : null,
    noteEn: bad.length ? `unreadable regions: ${badIds}` : null,
  };
}
