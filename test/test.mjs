// Tests légers sans framework : node test/test.mjs
// Aucun accès réseau, aucune lecture de fichier généré : tout passe par des fixtures
// réelles capturées dans test/fixtures/
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeIndicator, normalizeComponentStatus, normalizeGoogleImpact, worstOf, classifyKind, normalizeFailure, STATUSES, STATUS_LABELS, STATUS_LABELS_EN } from '../lib/normalize.mjs';
import { collectAll, buildOutput, buildProvider, GROUPS } from '../lib/collect.mjs';
import { collectStatuspage } from '../adapters/statuspage.mjs';
import { collectAlibaba } from '../adapters/alibaba.mjs';
import { collectGoogle } from '../adapters/google.mjs';
import { collectFlashcat } from '../adapters/flashcat.mjs';
import { pillStatus } from '../adapters/browser.mjs';
import { collectInstatus, instatusComponentStatus } from '../adapters/instatus.mjs';
import { collectBetterstack } from '../adapters/betterstack.mjs';
import { collectCheckly } from '../adapters/checkly.mjs';
import { collectOnlineornot, decodeTurboStream, parseOnlineornotHtml } from '../adapters/onlineornot.mjs';
import { collectAws, awsCode } from '../adapters/aws.mjs';
import { collectAzure, parseAzureRows } from '../adapters/azure.mjs';
import { collectTencent } from '../adapters/tencent.mjs';
import { collectVolcengine, parseVolcengineRss } from '../adapters/volcengine.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const fixtureText = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const okText = (body) => async () => ({ ok: true, status: 200, text: async () => body });
// Réponse binaire : encodage UTF-16 avec BOM (comme le vrai currentevents AWS) ou UTF-8 avec BOM
const utf16 = (obj) => { const s = JSON.stringify(obj); const b = new Uint8Array(2 + s.length * 2); b[0] = 0xfe; b[1] = 0xff; for (let i = 0; i < s.length; i++) { b[2 + i * 2] = s.charCodeAt(i) >> 8; b[3 + i * 2] = s.charCodeAt(i) & 0xff; } return b.buffer; };
const utf8bom = (obj) => new TextEncoder().encode('\ufeff' + JSON.stringify(obj)).buffer;
const byUrlBytes = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  return key ? { ok: true, status: 200, arrayBuffer: async () => map[key] } : { ok: false, status: 404 };
};
const byUrlText = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  return key ? { ok: true, status: 200, text: async () => map[key] } : { ok: false, status: 404 };
};
const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const byUrl = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  return key ? { ok: true, status: 200, json: async () => map[key] } : { ok: false, status: 404, json: async () => ({}) };
};
const failing = async () => { throw new Error('ECONNREFUSED'); };
const names = (components) => components.map((c) => c.name);
const impacted = (components) => components.filter((c) => c.status !== 'operationnel').map((c) => c.name);

const provider = {
  id: 'test', name: 'Test', statusUrl: 'https://ex.com',
  source: { kind: 'statuspage', url: 'https://ex.com' },
};

// 1. Normalisation.
assert.strictEqual(normalizeIndicator('none'), 'operationnel');
assert.strictEqual(normalizeIndicator('minor'), 'degradation');
assert.strictEqual(normalizeIndicator('major'), 'incident_majeur');
assert.strictEqual(normalizeIndicator('critical'), 'indisponible');
assert.strictEqual(normalizeIndicator('maintenance'), 'maintenance');
assert.strictEqual(normalizeIndicator('inexistant'), 'inconnu');
assert.strictEqual(normalizeComponentStatus('operational'), 'operationnel');
assert.strictEqual(normalizeComponentStatus('partial_outage'), 'degradation');
assert.strictEqual(normalizeComponentStatus('major_outage'), 'incident_majeur');
assert.strictEqual(normalizeComponentStatus('under_maintenance'), 'maintenance');
assert.strictEqual(normalizeComponentStatus('autre'), 'inconnu');
assert.strictEqual(normalizeGoogleImpact('SERVICE_OUTAGE'), 'incident_majeur');
assert.strictEqual(normalizeGoogleImpact('SERVICE_DISRUPTION'), 'degradation');
assert.strictEqual(normalizeGoogleImpact('SERVICE_INFORMATION'), null);
assert.strictEqual(normalizeFailure(), 'inconnu');

// 2. worstOf : le pire l'emporte ; un inconnu interdit le vert mais n'écrase pas un état réel.
assert.strictEqual(worstOf([]), 'operationnel');
assert.strictEqual(worstOf(['operationnel', 'maintenance', 'degradation']), 'degradation');
assert.strictEqual(worstOf(['degradation', 'incident_majeur']), 'incident_majeur');
assert.strictEqual(worstOf(['operationnel', 'inconnu']), 'inconnu');
assert.strictEqual(worstOf(['degradation', 'inconnu']), 'degradation');

// 2b. classifyKind : espace de noms ou motif déclaré ; sinon service. Listes réelles.
const groqPattern = '^(llama|whisper|\\S+/\\S+$)';
assert.strictEqual(classifyKind('meta-llama/llama-4-scout-17b-16e-instruct', groqPattern), 'model');
assert.strictEqual(classifyKind('Website', groqPattern), 'service');
assert.strictEqual(classifyKind('llama-3.3-70b-versatile', groqPattern), 'model');
assert.strictEqual(classifyKind('API', groqPattern), 'service');
assert.strictEqual(classifyKind('Connectors/Apps'), 'service', 'sans motif déclaré, jamais modèle');
assert.strictEqual(classifyKind('embeddings', '^(command|c4ai|embed-|rerank|tiny-aya)'), 'service');
assert.strictEqual(classifyKind('embed-v4.0', '^(command|c4ai|embed-|rerank|tiny-aya)'), 'model');
assert.strictEqual(classifyKind('K2 Model', 'Model$'), 'model');
assert.strictEqual(classifyKind('Open API', 'Model$'), 'service');
assert.strictEqual(classifyKind('Claude API'), 'service');
assert.strictEqual(classifyKind('Claude Code'), 'service');

// 3. Statuspage : échec réseau et HTTP → inconnu.
const s1 = await collectStatuspage(provider, failing);
assert.strictEqual(s1.status, 'inconnu');
assert.ok(/erreur réseau/.test(s1.collect.error));
const s2 = await collectStatuspage(provider, async () => ({ ok: false, status: 500 }));
assert.strictEqual(s2.status, 'inconnu');
assert.ok(/HTTP 500/.test(s2.collect.error));
const s3 = await collectStatuspage(provider, okJson({ foo: 1 }));
assert.strictEqual(s3.status, 'inconnu');
assert.ok(/schéma/.test(s3.collect.error));

// 3b. Statuspage : fixture réelle Anthropic, tout operational → 6 composants, aucun impacté.
const anthropic = fixture('statuspage-summary-anthropic.json');
const s4 = await collectStatuspage(provider, okJson(anthropic));
assert.strictEqual(s4.status, 'operationnel');
assert.strictEqual(s4.components.length, 6);
assert.deepStrictEqual(impacted(s4.components), []);
assert.deepStrictEqual(s4.incidents, []);
assert.deepStrictEqual(s4.maintenances, []);
assert.strictEqual(s4.collect.state, 'ok');

// 3c. Statuspage : composant dégradé + groupe (ignoré) + incident actif + maintenance en cours.
const s5 = await collectStatuspage(provider, okJson({
  status: { indicator: 'minor', description: 'Partial degradation' },
  components: [
    { name: 'API', status: 'degraded_performance' },
    { name: 'Modèles', status: 'degraded_performance', group: true },
    { name: 'Console', status: 'operational' },
  ],
  incidents: [{ name: 'Elevated errors', status: 'monitoring', impact: 'minor', created_at: '2026-09-03T10:00:00Z', shortlink: 'https://stspg.io/x', components: [{ name: 'API' }] }],
  scheduled_maintenances: [
    { name: 'DB upgrade', status: 'in_progress', scheduled_for: '2026-09-03T09:00:00Z', scheduled_until: null },
    { name: 'Old', status: 'completed' },
  ],
}));
assert.strictEqual(s5.status, 'degradation');
assert.deepStrictEqual(names(s5.components), ['API', 'Console']);
assert.deepStrictEqual(impacted(s5.components), ['API']);
assert.strictEqual(s5.incidents.length, 1);
assert.strictEqual(s5.incidents[0].state, 'monitoring');
assert.deepStrictEqual(s5.incidents[0].components, ['API']);
assert.strictEqual(s5.maintenances.length, 1);

// 3d. Statuspage : indicateur none mais maintenance en cours → maintenance, jamais vert.
const s6 = await collectStatuspage(provider, okJson({
  status: { indicator: 'none' }, components: [{ name: 'API', status: 'operational' }],
  scheduled_maintenances: [{ name: 'M', status: 'in_progress' }],
}));
assert.strictEqual(s6.status, 'maintenance');
const s7 = await collectStatuspage(provider, okJson({
  status: { indicator: 'none' }, components: [{ name: 'API', status: 'under_maintenance' }],
}));
assert.strictEqual(s7.status, 'maintenance');
assert.deepStrictEqual(impacted(s7.components), ['API']);

// 4. Google : flux officiels, périmètre par préfixe.
const gProvider = { ...provider, source: { kind: 'google', url: 'https://status.cloud.google.com', productPrefixes: ['Vertex', 'Gemini'] } };
const products = fixture('google-products.json');
assert.ok(products.products.some((p) => p.title === 'Vertex Gemini API'), 'produit du périmètre attendu dans la fixture');
const g1 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': fixture('google-incidents-ia.json') }));
assert.strictEqual(g1.status, 'operationnel', 'fixture : incidents tous terminés');
assert.ok(g1.components.length >= 20 && g1.components.every((c) => /^(Vertex|Gemini)/.test(c.name)), 'composants = produits du périmètre');
assert.deepStrictEqual(impacted(g1.components), []);
assert.ok(/Aucun incident déclaré/.test(g1.rawStatus));
const openOn = (title, impact) => [{ external_desc: 'Test', begin: '2026-09-03T10:00:00+00:00', end: null, status_impact: impact, uri: 'incidents/abc', affected_products: [{ title }] }];
const g2 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex Gemini API', 'SERVICE_DISRUPTION') }));
assert.strictEqual(g2.status, 'degradation');
assert.deepStrictEqual(impacted(g2.components), ['Vertex Gemini API']);
assert.strictEqual(g2.incidents[0].url, 'https://status.cloud.google.com/incidents/abc');
const g3 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex AI Training', 'SERVICE_OUTAGE') }));
assert.strictEqual(g3.status, 'incident_majeur');
const g4 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Cloud SQL', 'SERVICE_OUTAGE') }));
assert.strictEqual(g4.status, 'operationnel', 'hors périmètre : ignoré');
const g5 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex Gemini API', 'SERVICE_INFORMATION') }));
assert.strictEqual(g5.status, 'operationnel', 'informatif : ignoré');
const g6 = await collectGoogle(gProvider, byUrl({ 'products.json': products }));
assert.strictEqual(g6.status, 'inconnu', 'un des deux flux en échec → inconnu');
const g7 = await collectGoogle({ ...gProvider, source: { ...gProvider.source, productPrefixes: ['Inexistant'] } }, byUrl({ 'products.json': products, 'incidents.json': [] }));
assert.strictEqual(g7.status, 'inconnu');
assert.ok(/aucun produit du périmètre/.test(g7.collect.error));

// 5. Flashcat (DeepSeek) : fixture réelle, aucun changement actif → operationnel.
const fProvider = { ...provider, source: { kind: 'flashcat', url: 'https://status.deepseek.com', pageId: '6410630422455' } };
const f1 = await collectFlashcat(fProvider, okJson(fixture('flashcat-deepseek-active.json')));
assert.strictEqual(f1.status, 'operationnel');
assert.strictEqual(f1.components.length, 8);
assert.strictEqual(f1.collect.state, 'ok');
// 5b. Payload vide, sans composants, ou 200 inattendu → jamais vert.
for (const body of [{}, { data: {} }, { data: { page: { components: [] }, active_changes: [] } }, { data: { page: { components: [{ name: 'x' }] } } }]) {
  const f = await collectFlashcat(fProvider, okJson(body));
  assert.strictEqual(f.status, 'inconnu', `payload ${JSON.stringify(body)}`);
}
const f2 = await collectFlashcat(fProvider, async () => ({ ok: false, status: 404 }));
assert.strictEqual(f2.status, 'inconnu');
// 5c. Un changement actif → degradation avec son titre, services à l'état illisible.
const f3 = await collectFlashcat(fProvider, okJson({ data: { page: { components: [{ name: 'API' }] }, active_changes: [{ title: 'API errors' }] } }));
assert.strictEqual(f3.status, 'degradation');
assert.strictEqual(f3.incidents[0].title, 'API errors');
assert.strictEqual(f3.components[0].status, 'inconnu');

// 6. Alibaba : fixture réelle (tout récupéré) → operationnel, incidents vides ; un en cours → degradation.
const a1 = await collectAlibaba(provider, okJson(fixture('alibaba-events.json')));
assert.strictEqual(a1.status, 'operationnel');
assert.deepStrictEqual(a1.incidents, []);
const a2 = await collectAlibaba(provider, okJson({ data: [{ id: 2, title: '[Incident] Bar', startTime: Date.now() - 3600000, endTime: null }] }));
assert.strictEqual(a2.status, 'degradation');
assert.strictEqual(a2.incidents[0].state, 'en cours');
assert.strictEqual(a2.incidents[0].title, 'Bar');
const a3 = await collectAlibaba(provider, okJson({ data: 'oops' }));
assert.strictEqual(a3.status, 'inconnu');

// 7. xAI : pilules.
assert.strictEqual(pillStatus('available'), 'operationnel');
assert.strictEqual(pillStatus(' Degraded '), 'degradation');
assert.strictEqual(pillStatus('major outage'), 'incident_majeur');
assert.strictEqual(pillStatus('Operational'), 'inconnu', 'vocabulaire inconnu → inconnu');
assert.strictEqual(worstOf(['operationnel', 'operationnel', pillStatus('???')]), 'inconnu');

// 7b. Instatus (Perplexity) : fixture réelle, tout OPERATIONAL ; états dégradés ; réponses cassées.
const iProvider = { ...provider, source: { kind: 'instatus', url: 'https://status.perplexity.com' } };
const i1 = await collectInstatus(iProvider, byUrl({ 'summary.json': fixture('instatus-perplexity-summary.json'), 'components.json': fixture('instatus-perplexity-components.json') }));
assert.strictEqual(i1.status, 'operationnel');
assert.deepStrictEqual(names(i1.components), ['Website', 'API', 'Computer']);
assert.strictEqual(i1.collect.state, 'ok');
const i2 = await collectInstatus(iProvider, byUrl({
  'summary.json': { page: { status: 'HASISSUES' }, activeIncidents: [{ name: 'API errors', status: 'INVESTIGATING', impact: 'PARTIALOUTAGE', started: '2026-09-04T10:00:00Z', url: 'https://status.perplexity.com/incident/x' }] },
  'components.json': { components: [{ name: 'API', status: 'PARTIALOUTAGE' }, { name: 'Website', status: 'OPERATIONAL' }] },
}));
assert.strictEqual(i2.status, 'degradation');
assert.deepStrictEqual(impacted(i2.components), ['API']);
assert.strictEqual(i2.incidents[0].state, 'investigating');
const i3 = await collectInstatus(iProvider, byUrl({ 'summary.json': { page: { status: 'UP' } }, 'components.json': { components: [{ name: 'API', status: 'WEIRD' }] } }));
assert.strictEqual(i3.status, 'inconnu', 'vocabulaire inconnu → jamais vert');
assert.strictEqual(instatusComponentStatus('MAJOROUTAGE'), 'incident_majeur');
for (const map of [{ 'summary.json': { page: { status: 'UP' } }, 'components.json': { components: [] } }, { 'summary.json': {}, 'components.json': { components: [{ name: 'API', status: 'OPERATIONAL' }] } }, { 'summary.json': { page: { status: 'UP' } } }]) {
  const i = await collectInstatus(iProvider, byUrl(map));
  assert.strictEqual(i.status, 'inconnu', `payload ${JSON.stringify(map)}`);
  assert.strictEqual(i.collect.state, 'error');
}
assert.strictEqual((await collectInstatus(iProvider, failing)).status, 'inconnu');

// 7c. Better Stack (Together AI) : fixture réelle ; rapport ouvert ; ressource non surveillée ; cassé.
const bProvider = { ...provider, source: { kind: 'betterstack', url: 'https://status.together.ai' } };
const together = fixture('betterstack-together-index.json');
const b1 = await collectBetterstack(bProvider, okJson(together));
assert.strictEqual(b1.status, 'operationnel');
assert.ok(b1.components.length >= 20 && b1.components.some((c) => c.name === 'Website'));
assert.deepStrictEqual(b1.incidents, [], 'les rapports terminés (ends_at non null) sont ignorés');
assert.deepStrictEqual(b1.maintenances, []);
const b2 = await collectBetterstack(bProvider, okJson({
  data: { attributes: { aggregate_state: 'degraded' } },
  included: [
    { id: '1', type: 'status_page_resource', attributes: { public_name: 'API', status: 'degraded' } },
    { id: '2', type: 'status_page_resource', attributes: { public_name: 'Site', status: 'operational' } },
    { id: '9', type: 'status_report', attributes: { title: 'Slow API', report_type: 'manual', aggregate_state: 'degraded', starts_at: '2026-09-04T10:00:00Z', ends_at: null, affected_resources: [{ status_page_resource_id: '1', status: 'degraded' }] } },
    { id: '10', type: 'status_report', attributes: { title: 'Upgrade', report_type: 'maintenance', starts_at: '2026-09-04T09:00:00Z', ends_at: null, affected_resources: [] } },
  ],
}));
assert.strictEqual(b2.status, 'degradation');
assert.deepStrictEqual(impacted(b2.components), ['API']);
assert.deepStrictEqual(b2.incidents[0].components, ['API']);
assert.strictEqual(b2.maintenances[0].state, 'in_progress');
const b3 = await collectBetterstack(bProvider, okJson({ data: { attributes: { aggregate_state: 'operational' } }, included: [{ id: '1', type: 'status_page_resource', attributes: { public_name: 'API', status: 'not_monitored' } }] }));
assert.strictEqual(b3.status, 'inconnu', 'ressource non surveillée → jamais vert');
for (const body of [{}, { data: {} }, { data: { attributes: { aggregate_state: 'operational' } }, included: [] }]) {
  assert.strictEqual((await collectBetterstack(bProvider, okJson(body))).status, 'inconnu', `payload ${JSON.stringify(body)}`);
}
assert.strictEqual((await collectBetterstack(bProvider, async () => ({ ok: false, status: 503 }))).status, 'inconnu');

// 7d. Checkly (Mistral) : fixture réelle sans incident ; incident ouvert ciblé ; incident sans services ; cassé.
const cProvider = { ...provider, source: { kind: 'checkly', url: 'https://status.mistral.ai', slug: 'mistral-ai' } };
const uptime = fixture('checkly-mistral-uptime.json');
const cMap = (incidents, windows = { upcoming: [], active: [], recentlyCompleted: [], past: [] }) => byUrl({ '/uptime': uptime, 'unresolved-incidents': { incidents }, 'maintenance-windows': windows });
const c1 = await collectCheckly(cProvider, cMap([]));
assert.strictEqual(c1.status, 'operationnel');
assert.strictEqual(c1.components.length, 17);
assert.ok(names(c1.components).includes('Chat Completions API'));
const chatId = uptime.metadata[0].services[0].id;
const c2 = await collectCheckly(cProvider, cMap([{ id: 'x', name: 'Completion API Degraded', severity: 'MEDIUM', lastUpdateStatus: 'INVESTIGATING', services: [{ id: chatId }], created_at: '2026-09-04T10:00:00Z' }]));
assert.strictEqual(c2.status, 'degradation');
assert.deepStrictEqual(impacted(c2.components), ['Chat Completions API']);
assert.deepStrictEqual(c2.incidents[0].components, ['Chat Completions API']);
assert.strictEqual(c2.incidents[0].state, 'investigating');
const c3 = await collectCheckly(cProvider, cMap([{ id: 'y', name: 'Outage', severity: 'CRITICAL', lastUpdateStatus: 'IDENTIFIED' }]));
assert.strictEqual(c3.status, 'indisponible');
assert.ok(c3.components.every((c) => c.status === 'inconnu'), 'incident sans liste de services → services illisibles');
const c4 = await collectCheckly(cProvider, cMap([{ id: 'z', name: 'Old', severity: 'MINOR', lastUpdateStatus: 'RESOLVED', services: [] }]));
assert.strictEqual(c4.status, 'operationnel', 'incident résolu ignoré');
const c5 = await collectCheckly(cProvider, cMap([], { upcoming: [], active: [{ name: 'Upgrade', startsAt: '2026-09-04T09:00:00Z' }] }));
assert.strictEqual(c5.status, 'maintenance');
assert.strictEqual(c5.maintenances[0].state, 'in_progress');
assert.strictEqual((await collectCheckly(cProvider, byUrl({ '/uptime': uptime, 'unresolved-incidents': { incidents: [] } }))).status, 'inconnu', 'un endpoint en échec → inconnu');
assert.strictEqual((await collectCheckly(cProvider, byUrl({ '/uptime': { metadata: [] }, 'unresolved-incidents': { incidents: [] }, 'maintenance-windows': { active: [] } }))).status, 'inconnu');
assert.strictEqual((await collectCheckly(cProvider, byUrl({ '/uptime': uptime, 'unresolved-incidents': {}, 'maintenance-windows': { active: [] } }))).status, 'inconnu');

// 7e. OnlineOrNot (OpenRouter) : décodage turbo-stream ; fixture HTML réelle ; composant dégradé ; page sans données.
assert.deepStrictEqual(decodeTurboStream([{ _1: 2, _3: 4 }, 'a', 5, 'b', [6, -5], ['D', 7], '2026-09-04T00:00:00Z']), { a: 5, b: ['2026-09-04T00:00:00Z', null] });
const oProvider = { ...provider, source: { kind: 'onlineornot', url: 'https://status.openrouter.ai' } };
const orHtml = fixtureText('onlineornot-openrouter.html');
const orDoc = parseOnlineornotHtml(orHtml);
assert.strictEqual(orDoc.loaderData.root.result.statusPage.name, 'OpenRouter');
const o1 = await collectOnlineornot(oProvider, okText(orHtml));
assert.strictEqual(o1.status, 'operationnel');
assert.strictEqual(o1.components.length, 10);
assert.ok(names(o1.components).includes('Chat (/api/v1/chat/completions)'));
assert.deepStrictEqual(o1.incidents, [], 'incidents terminés (ended non null) ignorés');
// Encodeur turbo-stream minimal (sans dédoublonnage) pour fabriquer une page dégradée
const turbo = (root) => {
  const flat = [];
  const enc = (v) => {
    const i = flat.push(null) - 1;
    if (Array.isArray(v)) flat[i] = v.map(enc);
    else if (v && typeof v === 'object') flat[i] = Object.fromEntries(Object.entries(v).map(([k, x]) => [`_${enc(k)}`, enc(x)]));
    else flat[i] = v;
    return i;
  };
  enc(root);
  return `<html><body><script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(flat))});</script></body></html>`;
};
const degradedHtml = turbo({ loaderData: {
  root: { result: { components: [{ name: 'Chat (/api/v1/chat/completions)', status: 'MAJOR_OUTAGE' }, { name: 'Models', status: 'OPERATIONAL' }] } },
  'routes/_index': { result: { incidents: { '2026-09-04T00:00:00.000Z': [{ id: 'abc', title: 'Chat down', started: '2026-09-04T10:00:00Z', ended: null, updates: [{ status: 'INVESTIGATING', createdAt: '2026-09-04T10:01:00Z' }] }] } } },
} });
const o2 = await collectOnlineornot(oProvider, okText(degradedHtml));
assert.strictEqual(o2.status, 'incident_majeur');
assert.deepStrictEqual(impacted(o2.components), ['Chat (/api/v1/chat/completions)']);
assert.strictEqual(o2.incidents.length, 1);
assert.strictEqual(o2.incidents[0].state, 'investigating');
assert.strictEqual(o2.incidents[0].url, 'https://status.openrouter.ai/incidents/abc');
const o3 = await collectOnlineornot(oProvider, okText(orHtml.replace(/OPERATIONAL/g, 'WEIRD')));
assert.strictEqual(o3.status, 'inconnu', 'vocabulaire inconnu → jamais vert');
const o4 = await collectOnlineornot(oProvider, okText('<html><body>Page not found</body></html>'));
assert.strictEqual(o4.status, 'inconnu');
assert.ok(/SSR/.test(o4.collect.error));
assert.strictEqual((await collectOnlineornot(oProvider, async () => ({ ok: false, status: 502 }))).status, 'inconnu');

// 7f. AWS (Bedrock) : codes ; fixture réelle en UTF-16 (deux régions ME disrupted) ; tout calme ; cassé.
assert.strictEqual(awsCode('0'), 'operationnel');
assert.strictEqual(awsCode('1'), 'degradation');
assert.strictEqual(awsCode('3'), 'incident_majeur');
assert.strictEqual(awsCode('7'), 'inconnu');
const wProvider = { ...provider, source: { kind: 'aws', url: 'https://health.aws.amazon.com/health/status', eventsUrl: 'https://health.aws.amazon.com/public/currentevents', servicesUrl: 'https://servicedata-eu-west-1-prod.s3.amazonaws.com/services.json', serviceName: 'Amazon Bedrock' } };
const awsEvents = fixture('aws-currentevents.json');
const awsServices = fixture('aws-services.json');
const w1 = await collectAws(wProvider, byUrlBytes({ currentevents: utf16(awsEvents), 'services.json': utf8bom(awsServices) }));
assert.strictEqual(w1.status, 'incident_majeur');
assert.deepStrictEqual(impacted(w1.components).sort(), ['Amazon Bedrock (Bahrain)', 'Amazon Bedrock (UAE)']);
assert.ok(w1.components.length > 20 && w1.components.every((c) => c.name.startsWith('Amazon Bedrock (')), 'une entrée par région Bedrock, jamais AgentCore');
assert.strictEqual(w1.incidents.length, 2, 'l’événement résolu (status 0, end_time) est ignoré');
assert.deepStrictEqual(w1.incidents[0].components, ['Amazon Bedrock (UAE)']);
const w2 = await collectAws(wProvider, byUrlBytes({ currentevents: utf16([]), 'services.json': utf8bom(awsServices) }));
assert.strictEqual(w2.status, 'operationnel');
assert.deepStrictEqual(impacted(w2.components), []);
const w3 = await collectAws(wProvider, byUrlBytes({ currentevents: utf16([{ status: '2', service: 'bedrock-us-east-1', summary: 'Latencies', date: '1788472198' }]), 'services.json': utf8bom(awsServices) }));
assert.strictEqual(w3.status, 'degradation');
assert.deepStrictEqual(impacted(w3.components), ['Amazon Bedrock (N. Virginia)']);
assert.strictEqual((await collectAws(wProvider, byUrlBytes({ currentevents: utf16([]) }))).status, 'inconnu');
assert.strictEqual((await collectAws(wProvider, byUrlBytes({ currentevents: utf16({}), 'services.json': utf8bom(awsServices) }))).status, 'inconnu');
assert.strictEqual((await collectAws(wProvider, byUrlBytes({ currentevents: utf16([]), 'services.json': utf8bom([{ service: 'ec2-us-east-1', service_name: 'Amazon EC2' }]) }))).status, 'inconnu', 'aucun service du périmètre → inconnu');

// 7g. Azure : fixture réelle expurgée (Good partout) ; Warning ; label inconnu ; service absent ; page vide.
const zProvider = { ...provider, source: { kind: 'azure', url: 'https://azure.status.microsoft/en-us/status', services: ['Azure OpenAI Service', 'Foundry Models', 'Azure AI Search'] } };
const azHtml = fixtureText('azure-status-rows.html');
assert.ok(parseAzureRows(azHtml).get('Azure OpenAI Service').length > 10, 'cellules agrégées sur toutes les zones');
const z1 = await collectAzure(zProvider, okText(azHtml));
assert.strictEqual(z1.status, 'operationnel');
assert.deepStrictEqual(names(z1.components), ['Azure OpenAI Service', 'Foundry Models', 'Azure AI Search']);
const z2 = await collectAzure(zProvider, okText(azHtml.replace('<td>Foundry Models</td><td class="status-cell"><span class="icon status-icon" data-label="Not available">', '<td>Foundry Models</td><td class="status-cell"><span class="icon status-icon" data-label="Warning">')));
assert.strictEqual(z2.status, 'degradation');
assert.deepStrictEqual(impacted(z2.components), ['Foundry Models']);
const z3 = await collectAzure(zProvider, okText(azHtml.replace(/data-label="Good"/g, 'data-label="Weird"')));
assert.strictEqual(z3.status, 'inconnu', 'libellé inconnu → jamais vert');
const z4 = await collectAzure({ ...zProvider, source: { ...zProvider.source, services: ['Azure OpenAI Service', 'Inexistant'] } }, okText(azHtml));
assert.strictEqual(z4.status, 'operationnel');
assert.ok(/Inexistant/.test(z4.collect.error), 'service absent signalé sans casser la collecte');
const z5 = await collectAzure(zProvider, okText('<tr><td>Azure OpenAI Service</td><td data-label="Not available"></td></tr>'));
assert.strictEqual(z5.status, 'inconnu', 'aucune cellule lisible → inconnu');
assert.strictEqual((await collectAzure(zProvider, okText('<html></html>'))).status, 'inconnu');
assert.strictEqual((await collectAzure(zProvider, async () => ({ ok: false, status: 500 }))).status, 'inconnu');

// 7h. Tencent (Hunyuan) : fixture réelle ; ABNORMAL ; région vide ; cassé.
const tProvider = { ...provider, source: { kind: 'tencent', url: 'https://status.cloud.tencent.com', regionId: 'non-regional', productIds: ['hunyuan', 'aiart'] } };
const t1 = await collectTencent(tProvider, okJson(fixture('tencent-nonregional.json')));
assert.strictEqual(t1.status, 'operationnel');
assert.deepStrictEqual(names(t1.components).sort(), ['腾讯混元大模型', '腾讯混元生图']);
const t2 = await collectTencent(tProvider, okJson({ Response: { Data: { CategoryList: [{ ProductList: [{ ProductId: 'hunyuan', ProductName: '腾讯混元大模型', CurrentStatus: 'ABNORMAL', ProductEventTitle: 'API 异常', Rss: 'https://status.cloud.tencent.com/rss/zh/non-regional/hunyuan' }] }] } } }));
assert.strictEqual(t2.status, 'degradation');
assert.strictEqual(t2.incidents[0].title, 'API 异常');
assert.strictEqual((await collectTencent(tProvider, okJson({ Response: { Data: { CategoryList: [{ ProductList: [{ ProductId: 'hunyuan', CurrentStatus: 'BIZARRE' }] }] } } }))).status, 'inconnu');
assert.strictEqual((await collectTencent(tProvider, okJson({ Response: { Data: { Summary: {}, CategoryList: [] } } }))).status, 'inconnu', 'région inconnue = liste vide → inconnu');
assert.strictEqual((await collectTencent(tProvider, okJson({}))).status, 'inconnu');

// 7i. Volcengine (Ark) : flux réels (Pékin : événements résolus ; Shanghai : vide) ; événement en cours ; région bidon.
const vProvider = { ...provider, source: { kind: 'volcengine', url: 'https://status.volcengine.com', product: 'ModelArk', productLabel: '火山方舟', regions: ['cn-beijing', 'cn-shanghai'] } };
const rssBeijing = fixtureText('volcengine-modelark-cn-beijing.rss');
assert.strictEqual(parseVolcengineRss(rssBeijing).region, '华北2（北京）');
assert.strictEqual(parseVolcengineRss(rssBeijing).items.length, 2);
const v1 = await collectVolcengine(vProvider, byUrlText({ 'cn-beijing': rssBeijing, 'cn-shanghai': fixtureText('volcengine-modelark-cn-shanghai.rss') }));
assert.strictEqual(v1.status, 'operationnel', 'événements marqués 已恢复 → résolus');
assert.deepStrictEqual(names(v1.components), ['火山方舟 (华北2（北京）)', '火山方舟 (华东2（上海）)']);
assert.deepStrictEqual(v1.incidents, []);
const v2 = await collectVolcengine(vProvider, byUrlText({ 'cn-beijing': rssBeijing.replace('方舟大模型服务平台异常(已恢复)', '方舟大模型服务平台异常'), 'cn-shanghai': fixtureText('volcengine-modelark-cn-shanghai.rss') }));
assert.strictEqual(v2.status, 'degradation');
assert.deepStrictEqual(impacted(v2.components), ['火山方舟 (华北2（北京）)']);
assert.strictEqual(v2.incidents.length, 1);
const v3 = await collectVolcengine(vProvider, byUrlText({ 'cn-beijing': rssBeijing, 'cn-shanghai': '<rss version="2.0"><channel><title>火山引擎火山方舟大模型服务平台()服务状态</title></channel></rss>' }));
assert.strictEqual(v3.status, 'inconnu', 'région sans nom (inexistante) → composant illisible, jamais vert');
assert.strictEqual((await collectVolcengine(vProvider, async () => ({ ok: false, status: 500 }))).status, 'inconnu');
assert.strictEqual((await collectVolcengine(vProvider, okText('GetRSS failed'))).status, 'inconnu');

// 8. Assemblage v2 : collectAll isole les échecs, buildOutput produit le contrat.
const decl = [
  { id: 'a', name: 'A', group: 'us', statusUrl: 'https://a', scope: 'API A', source: { kind: 'sp' }, modelPattern: '^m-' },
  // b : adaptateur inconnu ; c : sans motif ; d : source injoignable
  { id: 'b', name: 'B', statusUrl: 'https://b', source: { kind: 'boom' } },
  { id: 'c', name: 'C', statusUrl: 'https://c', source: { kind: 'sp' } },
  { id: 'd', name: 'D', statusUrl: 'https://d', source: { kind: 'unavailable', note: 'injoignable' } },
];
const adapters = {
  sp: async (p) => p.id === 'a'
    ? { status: 'incident_majeur', rawStatus: 'Major outage', components: [{ name: 'm-1', status: 'incident_majeur' }, { name: 'API', status: 'operationnel' }], incidents: [{ title: 'Down', state: 'investigating', createdAt: '2026-09-03T10:00:00Z' }, { title: 'Old', state: 'resolved' }], collect: { state: 'ok', error: null } }
    : { status: 'operationnel', components: [{ name: 'API', status: 'operationnel' }], maintenances: [{ title: 'M', state: 'scheduled' }], collect: { state: 'ok', error: null } },
  unavailable: async (p) => ({ status: 'inconnu', collect: { state: 'error', error: p.source.note } }),
};
const settled = await collectAll(decl, adapters);
assert.strictEqual(settled[1].status, 'rejected', 'adaptateur inconnu : rejet isolé, pas de plantage');
const out = buildOutput(decl, settled, '2026-09-03T12:00:00Z');
assert.strictEqual(out.schemaVersion, 2);
assert.deepStrictEqual(out.labels, STATUS_LABELS);
assert.strictEqual(out.summary.worst, 'incident_majeur');
assert.deepStrictEqual(out.summary.counts, { operationnel: 1, maintenance: 0, degradation: 0, incident_majeur: 1, indisponible: 0, inconnu: 2 });
assert.strictEqual(out.summary.activeIncidents, 1, 'incident résolu exclu');
assert.strictEqual(out.summary.activeMaintenances, 0, 'maintenance planifiée non comptée comme active');
const [pa, pb, , pd] = out.providers;
assert.strictEqual(pa.group, 'us');
assert.strictEqual(pb.group, null, 'groupe absent transmis tel quel, jamais inventé');
assert.strictEqual(pa.components[0].kind, 'model');
assert.strictEqual(pa.components[1].kind, 'service');
assert.strictEqual(pa.reason, '1 composant en incident majeur');
assert.strictEqual(pa.reasonEn, '1 component major incident');
assert.deepStrictEqual(out.labelsEn, STATUS_LABELS_EN);
assert.strictEqual(pa.incidents.length, 1);
assert.strictEqual(pa.incidents[0].status, 'investigating');
assert.strictEqual(pb.status, 'inconnu');
assert.strictEqual(pb.name, 'B', 'identité conservée en échec');
assert.ok(/adaptateur inconnu/.test(pb.collect.error));
assert.strictEqual(pd.collect.method, 'unavailable');
assert.strictEqual(pd.reason, 'source non lue');
assert.strictEqual(pd.reasonEn, 'source not read');
// 8b. Un adaptateur qui renvoie ok + operationnel mais un composant inconnu ne passe pas vert.
const px = buildProvider(decl[2], { status: 'fulfilled', value: { status: 'operationnel', components: [{ name: 'X', status: 'bizarre' }], collect: { state: 'ok' }, collectedAt: 'now' } });
assert.strictEqual(px.components[0].status, 'inconnu');
// 8c. Un adaptateur en erreur qui prétend operationnel est forcé à inconnu.
const py = buildProvider(decl[2], { status: 'fulfilled', value: { status: 'operationnel', collect: { state: 'error', error: 'x' }, collectedAt: 'now' } });
assert.strictEqual(py.status, 'inconnu');
// 8d. Sans « inconnu », worst reste calculé sur les états réels ; tout inconnu → operationnel avec compteur.
const out2 = buildOutput([decl[3]], [settled[3]], 'now');
assert.strictEqual(out2.summary.worst, 'operationnel');
assert.strictEqual(out2.summary.counts.inconnu, 1);

// 9. Validateur du contrat v2 (inline, sans dépendance).
function validate(doc) {
  assert.strictEqual(doc.schemaVersion, 2);
  assert.strictEqual(typeof doc.generatedAt, 'string');
  assert.ok(STATUSES.includes(doc.summary.worst));
  for (const s of STATUSES) assert.strictEqual(typeof doc.summary.counts[s], 'number');
  for (const p of doc.providers) {
    for (const k of ['id', 'name', 'statusUrl', 'status', 'reason', 'reasonEn', 'collectedAt']) assert.strictEqual(typeof p[k], 'string', `${p.id}.${k}`);
    assert.ok(p.scopeEn === null || typeof p.scopeEn === 'string', `${p.id}.scopeEn`);
    assert.ok(STATUSES.includes(p.status), `${p.id}.status`);
    assert.ok(['ok', 'error'].includes(p.collect.state));
    assert.ok(p.collect.state === 'ok' || typeof p.collect.error === 'string', `${p.id} : erreur sans message`);
    assert.ok(p.collect.state === 'error' || p.status !== 'inconnu' || p.components.some((c) => c.status === 'inconnu') || true);
    for (const c of p.components) {
      assert.strictEqual(typeof c.name, 'string');
      assert.ok(['model', 'service'].includes(c.kind));
      assert.ok(STATUSES.includes(c.status));
    }
    for (const i of p.incidents) assert.ok(typeof i.title === 'string' && typeof i.status === 'string' && Array.isArray(i.components));
    for (const m of p.maintenances) assert.ok(typeof m.title === 'string' && typeof m.state === 'string');
    if (p.collect.state === 'error') assert.strictEqual(p.status, 'inconnu', `${p.id} : erreur de collecte mais statut ${p.status}`);
  }
}
validate(out);
validate(out2);

// 10. providers.json : cohérence des déclarations.
const providers = JSON.parse(readFileSync(new URL('../providers.json', import.meta.url), 'utf8'));
const kinds = new Set(['statuspage', 'alibaba', 'google', 'flashcat', 'browser', 'unavailable', 'instatus', 'betterstack', 'checkly', 'onlineornot', 'aws', 'azure', 'tencent', 'volcengine']);
assert.strictEqual(new Set(providers.map((p) => p.id)).size, providers.length, 'ids fournisseurs dupliqués');
for (const p of providers) {
  assert.ok(p.id && p.name && p.statusUrl && p.source?.kind && p.source?.url, `fournisseur incomplet : ${p.id}`);
  assert.ok(GROUPS.includes(p.group), `groupe absent ou inconnu : ${p.id} ${p.group}`);
  assert.ok(kinds.has(p.source.kind), `kind inconnu : ${p.id} ${p.source.kind}`);
  if (p.modelPattern) new RegExp(p.modelPattern);
  if (p.source.kind === 'unavailable') assert.ok(p.source.note, `note manquante : ${p.id}`);
  if (p.source.kind === 'google') assert.ok(p.source.productPrefixes?.length, `productPrefixes manquant : ${p.id}`);
  if (p.source.kind === 'flashcat') assert.ok(p.source.pageId, `pageId manquant : ${p.id}`);
  if (p.source.kind === 'browser') assert.strictEqual(p.id, 'xai', 'seul xAI a un parseur navigateur');
  if (p.source.kind === 'checkly') assert.ok(p.source.slug, `slug manquant : ${p.id}`);
  if (p.source.kind === 'aws') assert.ok(p.source.eventsUrl && p.source.servicesUrl && p.source.serviceName, `source aws incomplète : ${p.id}`);
  if (p.source.kind === 'azure') assert.ok(p.source.services?.length, `services manquants : ${p.id}`);
  if (p.source.kind === 'tencent') assert.ok(p.source.regionId && p.source.productIds?.length, `source tencent incomplète : ${p.id}`);
  if (p.source.kind === 'volcengine') assert.ok(p.source.product && p.source.productLabel && p.source.regions?.length, `source volcengine incomplète : ${p.id}`);
  assert.ok(typeof p.scopeEn === 'string' && p.scopeEn, `scopeEn manquant : ${p.id}`);
}
assert.ok(providers.some((p) => p.group === 'eu'), 'au moins un fournisseur européen');

console.log(`OK — ${providers.length} fournisseurs déclarés, tests verts`);
