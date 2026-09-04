import { worstOf } from '../lib/normalize.mjs';

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

export async function collectVolcengine(provider, get) {
  const base = provider.source.url.replace(/\/+$/, '');
  const { product, productLabel, regions = [] } = provider.source;
  try {
    const results = await Promise.all(regions.map(async (r) => {
      const res = await get(`${base}/rss/zh/${r}/${product}`);
      return { id: r, ok: res.ok, status: res.status, parsed: res.ok ? parseVolcengineRss(await res.text()) : null };
    }));
    const bad = results.filter((r) => !r.ok || !r.parsed.region);
    if (bad.length === results.length) {
      return { status: 'inconnu', collect: { state: 'error', error: `aucun flux RSS lisible (${bad.map((r) => `${r.id}: HTTP ${r.status}`).join(', ')})` } };
    }
    const components = results.map((r) => {
      if (!r.ok || !r.parsed.region) return { name: `${productLabel} (${r.id})`, status: 'inconnu' };
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
    return {
      status: worstOf(components.map((c) => c.status)),
      rawStatus: alerted ? `${alerted} region(s) with an unresolved event` : `No unresolved event (${components.length} regions)`,
      rawIndicator: alerted ? 'unresolved' : 'none',
      components: components.map(({ name, status }) => ({ name, status })),
      incidents,
      collect: { state: 'ok', error: bad.length ? `régions illisibles : ${bad.map((r) => r.id).join(', ')}` : null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
