import { fail } from '../lib/errors.mjs';
import { elements, elementText, wholeElement } from '../lib/markup.mjs';

const attr = (attributes, name) => attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1] ?? null;
const schema = (detail) => { throw fail('schema', `flux RSS xAI (${detail})`, `xAI RSS feed (${detail})`); };

export function parseXaiRss(xml, expectedComponents) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml)) schema('XML refusé');
  const root = wholeElement(xml, 'rss', { declaration: true });
  if (!root || attr(root.attributes, 'version') !== '2.0' || attr(root.attributes, 'xmlns:atom') !== 'http://www.w3.org/2005/Atom') schema('rss 2.0');
  const channel = wholeElement(root.body, 'channel');
  if (!channel) schema('channel');

  const items = elements(channel.body, 'item');
  if (!items || items.length === 0) schema('aucun item');
  const header = channel.body.slice(0, items[0].start);
  if (elementText(header, 'title') !== 'SpaceXAI System Status' || elementText(header, 'link') !== 'https://status.x.ai') schema('identité du canal');
  const builtAt = elementText(header, 'lastBuildDate');
  if (!builtAt || !Number.isFinite(Date.parse(builtAt))) schema('lastBuildDate');
  const atomLinks = elements(header, 'atom:link');
  if (!atomLinks || atomLinks.length !== 1 || attr(atomLinks[0].attributes, 'href') !== 'https://status.x.ai/feed.xml' || attr(atomLinks[0].attributes, 'rel') !== 'self' || attr(atomLinks[0].attributes, 'type') !== 'application/rss+xml') schema('lien autonome');

  const components = new Set(expectedComponents);
  const seen = new Set();
  return items.map(({ body }) => {
    const title = elementText(body, 'title');
    const link = elementText(body, 'link');
    const guid = elementText(body, 'guid');
    const description = elementText(body, 'description');
    const pubDate = elementText(body, 'pubDate');
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
    const categoryElements = elements(body, 'category');
    if (!categoryElements) schema('category');
    const categories = categoryElements.map((category) => category.body.trim().toLowerCase());
    if (status !== 'resolved' || severity !== 'available' || categories.length !== 2 || categories[0] !== 'available' || categories[1] !== 'resolved') schema('état non reconnu');
    return { component: titleParts[1], title: titleParts[2], guid, pubDate: new Date(pubDate).toISOString(), url: url.href };
  });
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
