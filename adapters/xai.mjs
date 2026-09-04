import { fail } from '../lib/errors.mjs';

const ITEM = /<item>([\s\S]*?)<\/item>/g;
const tag = (xml, name) => {
  const matches = [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'g'))];
  return matches.length === 1 ? matches[0][1].trim() : null;
};
const attr = (attributes, name) => attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1] ?? null;
const schema = (detail) => { throw fail('schema', `flux RSS xAI (${detail})`, `xAI RSS feed (${detail})`); };

export function parseXaiRss(xml, expectedComponents) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml)) schema('XML refusé');
  const root = xml.match(/^\s*(?:<\?xml\b[^?]*\?>\s*)?<rss\b([^>]*)>([\s\S]*)<\/rss>\s*$/i);
  if (!root || attr(root[1], 'version') !== '2.0' || attr(root[1], 'xmlns:atom') !== 'http://www.w3.org/2005/Atom') schema('rss 2.0');
  const channelMatch = root[2].match(/^\s*<channel>([\s\S]*)<\/channel>\s*$/i);
  if (!channelMatch) schema('channel');

  const channel = channelMatch[1];
  const firstItem = channel.indexOf('<item>');
  if (firstItem < 0) schema('aucun item');
  const header = channel.slice(0, firstItem);
  if (tag(header, 'title') !== 'SpaceXAI System Status' || tag(header, 'link') !== 'https://status.x.ai') schema('identité du canal');
  const builtAt = tag(header, 'lastBuildDate');
  if (!builtAt || !Number.isFinite(Date.parse(builtAt))) schema('lastBuildDate');
  const atomLinks = [...header.matchAll(/<atom:link\b([^>]*)\/?\s*>/gi)];
  if (atomLinks.length !== 1 || attr(atomLinks[0][1], 'href') !== 'https://status.x.ai/feed.xml' || attr(atomLinks[0][1], 'rel') !== 'self' || attr(atomLinks[0][1], 'type') !== 'application/rss+xml') schema('lien autonome');

  const components = new Set(expectedComponents);
  const itemCount = (channel.match(/<item>/g) ?? []).length;
  if (itemCount !== (channel.match(/<\/item>/g) ?? []).length) schema('item incomplet');
  const seen = new Set();
  const items = [...channel.matchAll(ITEM)].map((match) => {
    const body = match[1];
    const title = tag(body, 'title');
    const link = tag(body, 'link');
    const guid = tag(body, 'guid');
    const description = tag(body, 'description');
    const pubDate = tag(body, 'pubDate');
    const titleParts = title?.match(/^\[([^\]]+)]\s+(.+)$/);
    if (!titleParts || !components.has(titleParts[1])) schema('composant inconnu');
    if (!guid || !/^INC[0-9a-z]+$/i.test(guid) || seen.has(guid)) schema('guid');
    seen.add(guid);
    if (!pubDate || !Number.isFinite(Date.parse(pubDate))) schema('pubDate');

    let url;
    try {
      url = new URL(link);
    } catch {
      schema('lien incident');
    }
    if (url.origin !== 'https://status.x.ai' || url.username || url.password || !url.pathname.endsWith(`/${guid}`)) schema('lien incident');

    const status = description?.match(/<h3>Status:\s*([^<]+)<\/h3>/i)?.[1]?.trim().toLowerCase();
    const severity = description?.match(/<p>Severity:\s*([^<]+)<\/p>/i)?.[1]?.trim().toLowerCase();
    const categories = [...body.matchAll(/<category>([^<]+)<\/category>/g)].map((category) => category[1].trim().toLowerCase());
    if (status !== 'resolved' || severity !== 'available' || categories.length !== 2 || categories[0] !== 'available' || categories[1] !== 'resolved') schema('état non reconnu');
    return { component: titleParts[1], title: titleParts[2], guid, pubDate: new Date(pubDate).toISOString(), url: url.href };
  });
  if (items.length !== itemCount) schema('item illisible');
  return items;
}

export const METHOD = { fr: 'flux RSS officiel xAI', en: 'official xAI RSS feed' };

export async function collect(provider, get) {
  const components = provider.source.components;
  if (!Array.isArray(components) || components.length === 0 || components.some((name) => typeof name !== 'string' || !name) || new Set(components).size !== components.length) schema('liste des composants');
  parseXaiRss(await get(provider.source.url, { as: 'text', accept: 'application/rss+xml,application/xml,text/xml' }), components);
  return {
    indicator: null,
    rawStatus: `${components.length} services : ${components.length} available`,
    components: components.map((name) => ({ name, status: 'operationnel' })),
    incidents: [],
  };
}
