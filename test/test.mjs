// Tests légers sans framework : node test/test.mjs
// Aucun accès réseau, aucune lecture de fichier généré : tout passe par des fixtures
// réelles capturées dans test/fixtures/
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeIndicator, normalizeComponentStatus, normalizeGoogleImpact, worstOf, classifyKind, normalizeFailure, STATUSES, STATUS_LABELS, STATUS_LABELS_EN } from '../lib/normalize.mjs';
import { collectAll, buildOutput, buildProvider, GROUPS } from '../lib/collect.mjs';
import { HttpError, fail } from '../lib/errors.mjs';
import { get as httpGet } from '../lib/http.mjs';
import * as statuspage from '../adapters/statuspage.mjs';
import * as alibaba from '../adapters/alibaba.mjs';
import * as google from '../adapters/google.mjs';
import * as flashcat from '../adapters/flashcat.mjs';
import * as unavailable from '../adapters/unavailable.mjs';
import { pillStatus } from '../adapters/browser.mjs';
import * as instatus from '../adapters/instatus.mjs';
import { instatusComponentStatus } from '../adapters/instatus.mjs';
import * as betterstack from '../adapters/betterstack.mjs';
import * as checkly from '../adapters/checkly.mjs';
import * as onlineornot from '../adapters/onlineornot.mjs';
import { decodeTurboStream, parseOnlineornotHtml } from '../adapters/onlineornot.mjs';
import * as aws from '../adapters/aws.mjs';
import { awsCode } from '../adapters/aws.mjs';
import * as azure from '../adapters/azure.mjs';
import { parseAzureRows } from '../adapters/azure.mjs';
import * as tencent from '../adapters/tencent.mjs';
import * as volcengine from '../adapters/volcengine.mjs';
import { parseVolcengineRss } from '../adapters/volcengine.mjs';
import { MAX_STATUS_BYTES, STATUS_LIMITS, safeExternalUrl, validateStatusDocument } from '../public/status-contract.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const fixtureText = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Stubs du client `get` : corps déjà décodé, HttpError hors 2xx, comme lib/http.mjs
const okJson = (body) => async () => body;
const okText = okJson;
const httpFail = (status) => async (url) => { throw new HttpError(status, url); };
const byUrl = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  if (!key) throw new HttpError(404, url);
  return map[key];
};
const byUrlText = byUrl;
const byUrlBytes = byUrl;
// Réponse binaire : encodage UTF-16 avec BOM (comme le vrai currentevents AWS) ou UTF-8 avec BOM
const utf16 = (obj) => { const s = JSON.stringify(obj); const b = new Uint8Array(2 + s.length * 2); b[0] = 0xfe; b[1] = 0xff; for (let i = 0; i < s.length; i++) { b[2 + i * 2] = s.charCodeAt(i) >> 8; b[3 + i * 2] = s.charCodeAt(i) & 0xff; } return b; };
const utf8bom = (obj) => new TextEncoder().encode('﻿' + JSON.stringify(obj));
const failing = async () => { throw new Error('ECONNREFUSED'); };
const aborting = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
// Lecture d'un fournisseur par le seam complet : runner (isolation, horodatage) puis contrat
const read = async (mod, p, get) => buildProvider(p, (await collectAll([p], { [p.source.kind]: mod }, get))[0], mod);
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

// 3. Runner : tout échec (réseau, HTTP, timeout, schéma, famille inconnue) → inconnu,
// state error, texte FR et EN par code. Un seul jeu de tests pour tous les adaptateurs
const s1 = await read(statuspage, provider, failing);
assert.strictEqual(s1.status, 'inconnu');
assert.strictEqual(s1.collect.state, 'error');
assert.strictEqual(s1.collect.error, 'erreur réseau : ECONNREFUSED');
assert.strictEqual(s1.collect.errorEn, 'network error: ECONNREFUSED');
const s2 = await read(statuspage, provider, httpFail(500));
assert.strictEqual(s2.status, 'inconnu');
assert.strictEqual(s2.collect.error, 'réponse HTTP : 500 (https://ex.com/api/v2/summary.json)');
assert.strictEqual(s2.collect.errorEn, 'HTTP response: 500 (https://ex.com/api/v2/summary.json)');
const s3 = await read(statuspage, provider, okJson({ foo: 1 }));
assert.strictEqual(s3.status, 'inconnu');
assert.strictEqual(s3.collect.error, 'schéma inattendu : summary.json (status.indicator / components)');
assert.strictEqual(s3.collect.errorEn, 'unexpected schema: summary.json (status.indicator / components)');
const s3b = await read(statuspage, provider, aborting);
assert.strictEqual(s3b.collect.error, 'délai dépassé');
assert.strictEqual(s3b.collect.errorEn, 'timed out');
const s3c = await read({ collect: async () => { throw fail('scope', 'X'); } }, provider, okJson({}));
assert.strictEqual(s3c.collect.error, 'périmètre absent de la source : X');
assert.strictEqual(s3c.reason, 'source non lue');
const s3f = await read(unavailable, { ...provider, source: { kind: 'unavailable', url: 'https://ex.com' } }, okJson({}));
assert.strictEqual(s3f.collect.error, 'source indisponible', 'sans note : le mot du code');
assert.strictEqual(s3f.collect.errorEn, 'source unavailable');
// Un adaptateur qui rend un résultat n'a plus de mot à dire sur l'échec : sans note, error null
const s3d = await read({ collect: async () => ({ indicator: 'operationnel', components: [] }) }, provider, okJson({}));
assert.deepStrictEqual(s3d.collect, { state: 'ok', method: 'statuspage', methodLabel: null, methodLabelEn: null, error: null, errorEn: null }, 'sans METHOD : libellés null, la page replie sur l’id');
// Note non fatale : state ok, texte dans error / errorEn
const s3e = await read({ collect: async () => ({ indicator: 'operationnel', components: [], note: 'n', noteEn: 'n-en' }) }, provider, okJson({}));
assert.deepStrictEqual(s3e.collect, { state: 'ok', method: 'statuspage', methodLabel: null, methodLabelEn: null, error: 'n', errorEn: 'n-en' });
assert.strictEqual(s3e.status, 'operationnel');

// 3b. Statuspage : fixture réelle Anthropic, tout operational → 6 composants, aucun impacté.
const anthropic = fixture('statuspage-summary-anthropic.json');
const s4 = await read(statuspage, provider, okJson(anthropic));
assert.strictEqual(s4.status, 'operationnel');
assert.strictEqual(s4.components.length, 6);
assert.deepStrictEqual(impacted(s4.components), []);
assert.deepStrictEqual(s4.incidents, []);
assert.deepStrictEqual(s4.maintenances, []);
assert.strictEqual(s4.collect.state, 'ok');
assert.strictEqual(s4.collect.methodLabel, 'API Statuspage');
assert.strictEqual(s4.collect.methodLabelEn, 'Statuspage API');

// 3c. Statuspage : composant dégradé + groupe (ignoré) + incident actif + maintenance en cours.
const s5 = await read(statuspage, provider, okJson({
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
assert.strictEqual(s5.incidents[0].status, 'monitoring');
assert.deepStrictEqual(s5.incidents[0].components, ['API']);
assert.strictEqual(s5.maintenances.length, 1);

// 3d. Statuspage : indicateur none mais maintenance en cours → maintenance, jamais vert.
const s6 = await read(statuspage, provider, okJson({
  status: { indicator: 'none' }, components: [{ name: 'API', status: 'operational' }],
  scheduled_maintenances: [{ name: 'M', status: 'in_progress' }],
}));
assert.strictEqual(s6.status, 'maintenance');
const s7 = await read(statuspage, provider, okJson({
  status: { indicator: 'none' }, components: [{ name: 'API', status: 'under_maintenance' }],
}));
assert.strictEqual(s7.status, 'maintenance');
assert.deepStrictEqual(impacted(s7.components), ['API']);

// 4. Google : flux officiels, périmètre par préfixe.
const gProvider = { ...provider, statusUrl: 'https://status.cloud.google.com', source: { kind: 'google', url: 'https://status.cloud.google.com', productPrefixes: ['Vertex', 'Gemini'] } };
const products = fixture('google-products.json');
assert.ok(products.products.some((p) => p.title === 'Vertex Gemini API'), 'produit du périmètre attendu dans la fixture');
const g1 = await read(google, gProvider, byUrl({ 'products.json': products, 'incidents.json': fixture('google-incidents-ia.json') }));
assert.strictEqual(g1.status, 'operationnel', 'fixture : incidents tous terminés');
assert.ok(g1.components.length >= 20 && g1.components.every((c) => /^(Vertex|Gemini)/.test(c.name)), 'composants = produits du périmètre');
assert.deepStrictEqual(impacted(g1.components), []);
assert.ok(/Aucun incident déclaré/.test(g1.sourceText));
const openOn = (title, impact) => [{ external_desc: 'Test', begin: '2026-09-03T10:00:00+00:00', end: null, status_impact: impact, uri: 'incidents/abc', affected_products: [{ title }] }];
const g2 = await read(google, gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex Gemini API', 'SERVICE_DISRUPTION') }));
assert.strictEqual(g2.status, 'degradation');
assert.deepStrictEqual(impacted(g2.components), ['Vertex Gemini API']);
assert.strictEqual(g2.incidents[0].url, 'https://status.cloud.google.com/incidents/abc');
const g3 = await read(google, gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex AI Training', 'SERVICE_OUTAGE') }));
assert.strictEqual(g3.status, 'incident_majeur');
const g4 = await read(google, gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Cloud SQL', 'SERVICE_OUTAGE') }));
assert.strictEqual(g4.status, 'operationnel', 'hors périmètre : ignoré');
const g5 = await read(google, gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex Gemini API', 'SERVICE_INFORMATION') }));
assert.strictEqual(g5.status, 'operationnel', 'informatif : ignoré');
const g6 = await read(google, gProvider, byUrl({ 'products.json': products }));
assert.strictEqual(g6.status, 'inconnu', 'un des deux flux en échec → inconnu');
const g7 = await read(google, { ...gProvider, source: { ...gProvider.source, productPrefixes: ['Inexistant'] } }, byUrl({ 'products.json': products, 'incidents.json': [] }));
assert.strictEqual(g7.status, 'inconnu');
assert.ok(/Inexistant/.test(g7.collect.error));

// 5. Flashcat (DeepSeek) : fixture réelle, aucun changement actif → operationnel.
const fProvider = { ...provider, statusUrl: 'https://status.deepseek.com', source: { kind: 'flashcat', url: 'https://status.deepseek.com', pageId: '6410630422455' } };
const f1 = await read(flashcat, fProvider, okJson(fixture('flashcat-deepseek-active.json')));
assert.strictEqual(f1.status, 'operationnel');
assert.strictEqual(f1.components.length, 8);
assert.strictEqual(f1.collect.state, 'ok');
// 5b. Payload vide, sans composants, ou 200 inattendu → jamais vert.
for (const body of [{}, { data: {} }, { data: { page: { components: [] }, active_changes: [] } }, { data: { page: { components: [{ name: 'x' }] } } }]) {
  const f = await read(flashcat, fProvider, okJson(body));
  assert.strictEqual(f.status, 'inconnu', `payload ${JSON.stringify(body)}`);
}
const f2 = await read(flashcat, fProvider, httpFail(404));
assert.strictEqual(f2.status, 'inconnu');
// 5c. Un changement actif → degradation avec son titre, services à l'état illisible.
const f3 = await read(flashcat, fProvider, okJson({ data: { page: { components: [{ name: 'API' }] }, active_changes: [{ title: 'API errors' }] } }));
assert.strictEqual(f3.status, 'degradation');
assert.strictEqual(f3.incidents[0].title, 'API errors');
assert.strictEqual(f3.components[0].status, 'inconnu');

// 6. Alibaba : fixture réelle (tout récupéré) → operationnel, incidents vides ; un en cours → degradation.
const a1 = await read(alibaba, provider, okJson(fixture('alibaba-events.json')));
assert.strictEqual(a1.status, 'operationnel');
assert.deepStrictEqual(a1.incidents, []);
const a2 = await read(alibaba, provider, okJson({ data: [{ id: 2, title: '[Incident] Bar', startTime: Date.now() - 3600000, endTime: null }] }));
assert.strictEqual(a2.status, 'degradation');
assert.strictEqual(a2.incidents[0].status, 'en cours');
assert.strictEqual(a2.incidents[0].title, 'Bar');
const a3 = await read(alibaba, provider, okJson({ data: 'oops' }));
assert.strictEqual(a3.status, 'inconnu');

// 7. xAI : pilules.
assert.strictEqual(pillStatus('available'), 'operationnel');
assert.strictEqual(pillStatus(' Degraded '), 'degradation');
assert.strictEqual(pillStatus('major outage'), 'incident_majeur');
assert.strictEqual(pillStatus('Operational'), 'inconnu', 'vocabulaire inconnu → inconnu');
assert.strictEqual(worstOf(['operationnel', 'operationnel', pillStatus('???')]), 'inconnu');

// 7b. Instatus (Perplexity) : fixture réelle, tout OPERATIONAL ; états dégradés ; réponses cassées.
const iProvider = { ...provider, statusUrl: 'https://status.perplexity.com', source: { kind: 'instatus', url: 'https://status.perplexity.com' } };
const i1 = await read(instatus, iProvider, byUrl({ 'summary.json': fixture('instatus-perplexity-summary.json'), 'components.json': fixture('instatus-perplexity-components.json') }));
assert.strictEqual(i1.status, 'operationnel');
assert.deepStrictEqual(names(i1.components), ['Website', 'API', 'Computer']);
assert.strictEqual(i1.collect.state, 'ok');
const i2 = await read(instatus, iProvider, byUrl({
  'summary.json': { page: { status: 'HASISSUES' }, activeIncidents: [{ name: 'API errors', status: 'INVESTIGATING', impact: 'PARTIALOUTAGE', started: '2026-09-04T10:00:00Z', url: 'https://status.perplexity.com/incident/x' }] },
  'components.json': { components: [{ name: 'API', status: 'PARTIALOUTAGE' }, { name: 'Website', status: 'OPERATIONAL' }] },
}));
assert.strictEqual(i2.status, 'degradation');
assert.deepStrictEqual(impacted(i2.components), ['API']);
assert.strictEqual(i2.incidents[0].status, 'investigating');
const i3 = await read(instatus, iProvider, byUrl({ 'summary.json': { page: { status: 'UP' } }, 'components.json': { components: [{ name: 'API', status: 'WEIRD' }] } }));
assert.strictEqual(i3.status, 'inconnu', 'vocabulaire inconnu → jamais vert');
assert.strictEqual(instatusComponentStatus('MAJOROUTAGE'), 'incident_majeur');
for (const map of [{ 'summary.json': { page: { status: 'UP' } }, 'components.json': { components: [] } }, { 'summary.json': {}, 'components.json': { components: [{ name: 'API', status: 'OPERATIONAL' }] } }, { 'summary.json': { page: { status: 'UP' } } }]) {
  const i = await read(instatus, iProvider, byUrl(map));
  assert.strictEqual(i.status, 'inconnu', `payload ${JSON.stringify(map)}`);
  assert.strictEqual(i.collect.state, 'error');
}
assert.strictEqual((await read(instatus, iProvider, failing)).status, 'inconnu');

// 7c. Better Stack (Together AI) : fixture réelle ; rapport ouvert ; ressource non surveillée ; cassé.
const bProvider = { ...provider, statusUrl: 'https://status.together.ai', source: { kind: 'betterstack', url: 'https://status.together.ai' } };
const together = fixture('betterstack-together-index.json');
const b1 = await read(betterstack, bProvider, okJson(together));
assert.strictEqual(b1.status, 'operationnel');
assert.ok(b1.components.length >= 20 && b1.components.some((c) => c.name === 'Website'));
assert.deepStrictEqual(b1.incidents, [], 'les rapports terminés (ends_at non null) sont ignorés');
assert.deepStrictEqual(b1.maintenances, []);
const b2 = await read(betterstack, bProvider, okJson({
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
const b3 = await read(betterstack, bProvider, okJson({ data: { attributes: { aggregate_state: 'operational' } }, included: [{ id: '1', type: 'status_page_resource', attributes: { public_name: 'API', status: 'not_monitored' } }] }));
assert.strictEqual(b3.status, 'inconnu', 'ressource non surveillée → jamais vert');
for (const body of [{}, { data: {} }, { data: { attributes: { aggregate_state: 'operational' } }, included: [] }]) {
  assert.strictEqual((await read(betterstack, bProvider, okJson(body))).status, 'inconnu', `payload ${JSON.stringify(body)}`);
}
assert.strictEqual((await read(betterstack, bProvider, httpFail(503))).status, 'inconnu');

// 7d. Checkly (Mistral) : fixture réelle sans incident ; incident ouvert ciblé ; incident sans services ; cassé.
const cProvider = { ...provider, statusUrl: 'https://status.mistral.ai', source: { kind: 'checkly', url: 'https://status.mistral.ai', slug: 'mistral-ai' } };
const uptime = fixture('checkly-mistral-uptime.json');
const cMap = (incidents, windows = { upcoming: [], active: [], recentlyCompleted: [], past: [] }) => byUrl({ '/uptime': uptime, 'unresolved-incidents': { incidents }, 'maintenance-windows': windows });
const c1 = await read(checkly, cProvider, cMap([]));
assert.strictEqual(c1.status, 'operationnel');
assert.strictEqual(c1.components.length, 17);
assert.ok(names(c1.components).includes('Chat Completions API'));
const chatId = uptime.metadata[0].services[0].id;
const c2 = await read(checkly, cProvider, cMap([{ id: 'x', name: 'Completion API Degraded', severity: 'MEDIUM', lastUpdateStatus: 'INVESTIGATING', services: [{ id: chatId }], created_at: '2026-09-04T10:00:00Z' }]));
assert.strictEqual(c2.status, 'degradation');
assert.deepStrictEqual(impacted(c2.components), ['Chat Completions API']);
assert.deepStrictEqual(c2.incidents[0].components, ['Chat Completions API']);
assert.strictEqual(c2.incidents[0].status, 'investigating');
const c3 = await read(checkly, cProvider, cMap([{ id: 'y', name: 'Outage', severity: 'CRITICAL', lastUpdateStatus: 'IDENTIFIED' }]));
assert.strictEqual(c3.status, 'indisponible');
assert.ok(c3.components.every((c) => c.status === 'inconnu'), 'incident sans liste de services → services illisibles');
const c4 = await read(checkly, cProvider, cMap([{ id: 'z', name: 'Old', severity: 'MINOR', lastUpdateStatus: 'RESOLVED', services: [] }]));
assert.strictEqual(c4.status, 'operationnel', 'incident résolu ignoré');
const c5 = await read(checkly, cProvider, cMap([], { upcoming: [], active: [{ name: 'Upgrade', startsAt: '2026-09-04T09:00:00Z' }] }));
assert.strictEqual(c5.status, 'maintenance');
assert.strictEqual(c5.maintenances[0].state, 'in_progress');
assert.strictEqual((await read(checkly, cProvider, byUrl({ '/uptime': uptime, 'unresolved-incidents': { incidents: [] } }))).status, 'inconnu', 'un endpoint en échec → inconnu');
assert.strictEqual((await read(checkly, cProvider, byUrl({ '/uptime': { metadata: [] }, 'unresolved-incidents': { incidents: [] }, 'maintenance-windows': { active: [] } }))).status, 'inconnu');
assert.strictEqual((await read(checkly, cProvider, byUrl({ '/uptime': uptime, 'unresolved-incidents': {}, 'maintenance-windows': { active: [] } }))).status, 'inconnu');

// 7e. OnlineOrNot (OpenRouter) : décodage turbo-stream ; fixture HTML réelle ; composant dégradé ; page sans données.
assert.deepStrictEqual(decodeTurboStream([{ _1: 2, _3: 4 }, 'a', 5, 'b', [6, -5], ['D', 7], '2026-09-04T00:00:00Z']), { a: 5, b: ['2026-09-04T00:00:00Z', null] });
const oProvider = { ...provider, statusUrl: 'https://status.openrouter.ai', source: { kind: 'onlineornot', url: 'https://status.openrouter.ai' } };
const orHtml = fixtureText('onlineornot-openrouter.html');
const orDoc = parseOnlineornotHtml(orHtml);
assert.strictEqual(orDoc.loaderData.root.result.statusPage.name, 'OpenRouter');
const o1 = await read(onlineornot, oProvider, okText(orHtml));
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
const o2 = await read(onlineornot, oProvider, okText(degradedHtml));
assert.strictEqual(o2.status, 'incident_majeur');
assert.deepStrictEqual(impacted(o2.components), ['Chat (/api/v1/chat/completions)']);
assert.strictEqual(o2.incidents.length, 1);
assert.strictEqual(o2.incidents[0].status, 'investigating');
assert.strictEqual(o2.incidents[0].url, 'https://status.openrouter.ai/incidents/abc');
const o3 = await read(onlineornot, oProvider, okText(orHtml.replace(/OPERATIONAL/g, 'WEIRD')));
assert.strictEqual(o3.status, 'inconnu', 'vocabulaire inconnu → jamais vert');
const o4 = await read(onlineornot, oProvider, okText('<html><body>Page not found</body></html>'));
assert.strictEqual(o4.status, 'inconnu');
assert.ok(/SSR/.test(o4.collect.error));
assert.strictEqual((await read(onlineornot, oProvider, httpFail(502))).status, 'inconnu');

// 7f. AWS (Bedrock) : codes ; fixture réelle en UTF-16 (deux régions ME disrupted) ; tout calme ; cassé.
assert.strictEqual(awsCode('0'), 'operationnel');
assert.strictEqual(awsCode('1'), 'degradation');
assert.strictEqual(awsCode('3'), 'incident_majeur');
assert.strictEqual(awsCode('7'), 'inconnu');
const wProvider = { ...provider, statusUrl: 'https://health.aws.amazon.com/health/status', source: { kind: 'aws', url: 'https://health.aws.amazon.com/health/status', eventsUrl: 'https://health.aws.amazon.com/public/currentevents', servicesUrl: 'https://servicedata-eu-west-1-prod.s3.amazonaws.com/services.json', serviceName: 'Amazon Bedrock' } };
const awsEvents = fixture('aws-currentevents.json');
const awsServices = fixture('aws-services.json');
const w1 = await read(aws, wProvider, byUrlBytes({ currentevents: utf16(awsEvents), 'services.json': utf8bom(awsServices) }));
assert.strictEqual(w1.status, 'incident_majeur');
assert.deepStrictEqual(impacted(w1.components).sort(), ['Amazon Bedrock (Bahrain)', 'Amazon Bedrock (UAE)']);
assert.ok(w1.components.length > 20 && w1.components.every((c) => c.name.startsWith('Amazon Bedrock (')), 'une entrée par région Bedrock, jamais AgentCore');
assert.strictEqual(w1.incidents.length, 2, 'l’événement résolu (status 0, end_time) est ignoré');
assert.deepStrictEqual(w1.incidents[0].components, ['Amazon Bedrock (UAE)']);
const w2 = await read(aws, wProvider, byUrlBytes({ currentevents: utf16([]), 'services.json': utf8bom(awsServices) }));
assert.strictEqual(w2.status, 'operationnel');
assert.deepStrictEqual(impacted(w2.components), []);
const w3 = await read(aws, wProvider, byUrlBytes({ currentevents: utf16([{ status: '2', service: 'bedrock-us-east-1', summary: 'Latencies', date: '1788472198' }]), 'services.json': utf8bom(awsServices) }));
assert.strictEqual(w3.status, 'degradation');
assert.deepStrictEqual(impacted(w3.components), ['Amazon Bedrock (N. Virginia)']);
assert.strictEqual((await read(aws, wProvider, byUrlBytes({ currentevents: utf16([]) }))).status, 'inconnu');
assert.strictEqual((await read(aws, wProvider, byUrlBytes({ currentevents: utf16({}), 'services.json': utf8bom(awsServices) }))).status, 'inconnu');
assert.strictEqual((await read(aws, wProvider, byUrlBytes({ currentevents: utf16([]), 'services.json': utf8bom([{ service: 'ec2-us-east-1', service_name: 'Amazon EC2' }]) }))).status, 'inconnu', 'aucun service du périmètre → inconnu');

// 7g. Azure : fixture réelle expurgée (Good partout) ; Warning ; label inconnu ; service absent ; page vide.
const zProvider = { ...provider, statusUrl: 'https://azure.status.microsoft/en-us/status', source: { kind: 'azure', url: 'https://azure.status.microsoft/en-us/status', services: ['Azure OpenAI Service', 'Foundry Models', 'Azure AI Search'] } };
const azHtml = fixtureText('azure-status-rows.html');
assert.ok(parseAzureRows(azHtml).get('Azure OpenAI Service').length > 10, 'cellules agrégées sur toutes les zones');
const z1 = await read(azure, zProvider, okText(azHtml));
assert.strictEqual(z1.status, 'operationnel');
assert.deepStrictEqual(names(z1.components), ['Azure OpenAI Service', 'Foundry Models', 'Azure AI Search']);
const z2 = await read(azure, zProvider, okText(azHtml.replace('<td>Foundry Models</td><td class="status-cell"><span class="icon status-icon" data-label="Not available">', '<td>Foundry Models</td><td class="status-cell"><span class="icon status-icon" data-label="Warning">')));
assert.strictEqual(z2.status, 'degradation');
assert.deepStrictEqual(impacted(z2.components), ['Foundry Models']);
const z3 = await read(azure, zProvider, okText(azHtml.replace(/data-label="Good"/g, 'data-label="Weird"')));
assert.strictEqual(z3.status, 'inconnu', 'libellé inconnu → jamais vert');
const z4 = await read(azure, { ...zProvider, source: { ...zProvider.source, services: ['Azure OpenAI Service', 'Inexistant'] } }, okText(azHtml));
assert.strictEqual(z4.status, 'operationnel');
assert.ok(/Inexistant/.test(z4.collect.error), 'service absent signalé sans casser la collecte');
const z5 = await read(azure, zProvider, okText('<tr><td>Azure OpenAI Service</td><td data-label="Not available"></td></tr>'));
assert.strictEqual(z5.status, 'inconnu', 'aucune cellule lisible → inconnu');
assert.strictEqual((await read(azure, zProvider, okText('<html></html>'))).status, 'inconnu');
assert.strictEqual((await read(azure, zProvider, httpFail(500))).status, 'inconnu');

// 7h. Tencent (Hunyuan) : fixture réelle ; ABNORMAL ; région vide ; cassé.
const tProvider = { ...provider, statusUrl: 'https://status.cloud.tencent.com', source: { kind: 'tencent', url: 'https://status.cloud.tencent.com', regionId: 'non-regional', productIds: ['hunyuan', 'aiart'] } };
const t1 = await read(tencent, tProvider, okJson(fixture('tencent-nonregional.json')));
assert.strictEqual(t1.status, 'operationnel');
assert.deepStrictEqual(names(t1.components).sort(), ['腾讯混元大模型', '腾讯混元生图']);
const t2 = await read(tencent, tProvider, okJson({ Response: { Data: { CategoryList: [{ ProductList: [{ ProductId: 'hunyuan', ProductName: '腾讯混元大模型', CurrentStatus: 'ABNORMAL', ProductEventTitle: 'API 异常', Rss: 'https://status.cloud.tencent.com/rss/zh/non-regional/hunyuan' }] }] } } }));
assert.strictEqual(t2.status, 'degradation');
assert.strictEqual(t2.incidents[0].title, 'API 异常');
assert.strictEqual((await read(tencent, tProvider, okJson({ Response: { Data: { CategoryList: [{ ProductList: [{ ProductId: 'hunyuan', CurrentStatus: 'BIZARRE' }] }] } } }))).status, 'inconnu');
assert.strictEqual((await read(tencent, tProvider, okJson({ Response: { Data: { Summary: {}, CategoryList: [] } } }))).status, 'inconnu', 'région inconnue = liste vide → inconnu');
assert.strictEqual((await read(tencent, tProvider, okJson({}))).status, 'inconnu');

// 7i. Volcengine (Ark) : flux réels (Pékin : événements résolus ; Shanghai : vide) ; événement en cours ; région bidon.
const vProvider = { ...provider, statusUrl: 'https://status.volcengine.com', source: { kind: 'volcengine', url: 'https://status.volcengine.com', product: 'ModelArk', productLabel: '火山方舟', regions: ['cn-beijing', 'cn-shanghai'] } };
const rssBeijing = fixtureText('volcengine-modelark-cn-beijing.rss');
assert.strictEqual(parseVolcengineRss(rssBeijing).region, '华北2（北京）');
assert.strictEqual(parseVolcengineRss(rssBeijing).items.length, 2);
const v1 = await read(volcengine, vProvider, byUrlText({ 'cn-beijing': rssBeijing, 'cn-shanghai': fixtureText('volcengine-modelark-cn-shanghai.rss') }));
assert.strictEqual(v1.status, 'operationnel', 'événements marqués 已恢复 → résolus');
assert.deepStrictEqual(names(v1.components), ['火山方舟 (华北2（北京）)', '火山方舟 (华东2（上海）)']);
assert.deepStrictEqual(v1.incidents, []);
const v2 = await read(volcengine, vProvider, byUrlText({ 'cn-beijing': rssBeijing.replace('方舟大模型服务平台异常(已恢复)', '方舟大模型服务平台异常'), 'cn-shanghai': fixtureText('volcengine-modelark-cn-shanghai.rss') }));
assert.strictEqual(v2.status, 'degradation');
assert.deepStrictEqual(impacted(v2.components), ['火山方舟 (华北2（北京）)']);
assert.strictEqual(v2.incidents.length, 1);
const v3 = await read(volcengine, vProvider, byUrlText({ 'cn-beijing': rssBeijing, 'cn-shanghai': '<rss version="2.0"><channel><title>火山引擎火山方舟大模型服务平台()服务状态</title></channel></rss>' }));
assert.strictEqual(v3.status, 'inconnu', 'région sans nom (inexistante) → composant illisible, jamais vert');
const v4 = await read(volcengine, vProvider, httpFail(500));
assert.strictEqual(v4.status, 'inconnu');
assert.match(v4.collect.error, /^réponse HTTP : 500/, 'toutes les régions en HTTP : classification conservée');
const v5 = await read(volcengine, vProvider, okText('GetRSS failed'));
assert.match(v5.collect.error, /^schéma inattendu/);
assert.strictEqual(v5.status, 'inconnu');

// 8. Assemblage v2 : collectAll isole les échecs, buildOutput produit le contrat.
const decl = [
  { id: 'a', name: 'A', group: 'us', statusUrl: 'https://a', scope: 'API A', source: { kind: 'sp' }, modelPattern: '^m-' },
  // b : adaptateur inconnu ; c : sans motif ; d : source injoignable
  { id: 'b', name: 'B', statusUrl: 'https://b', source: { kind: 'boom' } },
  { id: 'c', name: 'C', statusUrl: 'https://c', source: { kind: 'sp' } },
  { id: 'd', name: 'D', statusUrl: 'https://d', source: { kind: 'unavailable', note: 'injoignable' } },
];
const adapters = {
  sp: { METHOD: { fr: 'API SP', en: 'SP API' }, collect: async (p) => p.id === 'a'
    ? { indicator: 'incident_majeur', rawStatus: 'Major outage', components: [{ name: 'm-1', status: 'incident_majeur' }, { name: 'API', status: 'operationnel' }], incidents: [{ title: 'Down', state: 'investigating', createdAt: '2026-09-03T10:00:00Z' }, { title: 'Old', state: 'resolved' }] }
    : { indicator: 'operationnel', components: [{ name: 'API', status: 'operationnel' }], maintenances: [{ title: 'M', state: 'scheduled' }] } },
  unavailable,
};
const settled = await collectAll(decl, adapters, okJson({}));
assert.strictEqual(settled[1].status, 'rejected', 'adaptateur inconnu : rejet isolé, pas de plantage');
const out = buildOutput(decl, settled, '2026-09-03T12:00:00Z', adapters);
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
assert.strictEqual(pb.collect.error, 'adaptateur inconnu : boom');
assert.strictEqual(pb.collect.errorEn, 'unknown adapter: boom');
assert.strictEqual(pd.collect.method, 'unavailable');
assert.strictEqual(pa.collect.methodLabel, 'API SP');
assert.strictEqual(pa.collect.methodLabelEn, 'SP API');
assert.strictEqual(pb.collect.methodLabel, null, 'famille inconnue : pas de libellé');
assert.strictEqual(pd.collect.methodLabel, 'aucune requête');
assert.strictEqual(pd.collect.methodLabelEn, 'no request');
assert.strictEqual(pd.collect.error, 'injoignable', 'source injoignable : la note seule, sans préfixe');
assert.strictEqual(pd.collect.errorEn, 'injoignable', 'sans noteEn, la note FR sert en anglais');
assert.strictEqual(pd.reason, 'source non lue');
assert.strictEqual(pd.reasonEn, 'source not read');
// 8b. Dérivation du statut par le contrat : indicateur, composants, maintenance en cours
const derive = (value) => buildProvider(decl[2], { status: 'fulfilled', value: { collectedAt: 'now', ...value } }).status;
assert.strictEqual(derive({ indicator: 'operationnel', components: [{ name: 'X', status: 'bizarre' }] }), 'inconnu', 'composant au vocabulaire inconnu : jamais vert');
assert.strictEqual(derive({ indicator: null, components: [] }), 'operationnel', 'sans indicateur ni composant : aucun incident déclaré');
assert.strictEqual(derive({ indicator: null, components: [{ name: 'A', status: 'degradation' }, { name: 'B', status: 'inconnu' }] }), 'degradation', 'un état réel l’emporte sur inconnu');
assert.strictEqual(derive({ indicator: 'degradation', components: [{ name: 'A', status: 'operationnel' }] }), 'degradation', 'indicateur de page seul');
assert.strictEqual(derive({ indicator: 'operationnel', components: [{ name: 'A', status: 'incident_majeur' }] }), 'incident_majeur', 'composant pire que l’indicateur');
assert.strictEqual(derive({ indicator: 'operationnel', components: [], maintenances: [{ title: 'M', state: 'in_progress' }] }), 'maintenance', 'maintenance en cours');
assert.strictEqual(derive({ indicator: 'operationnel', components: [], maintenances: [{ title: 'M', state: 'scheduled' }] }), 'operationnel', 'maintenance planifiée : sans effet');
assert.strictEqual(derive({ indicator: 'bizarre', components: [] }), 'inconnu', 'indicateur hors enum : inconnu');
// 8c. Un adaptateur rejeté est forcé à inconnu, quoi qu'il ait pu promettre
const py = buildProvider(decl[2], { status: 'rejected', reason: new Error('x') });
assert.strictEqual(py.status, 'inconnu');
assert.strictEqual(py.collect.state, 'error');
// 8d. Sans « inconnu », worst reste calculé sur les états réels ; tout inconnu → operationnel avec compteur.
const out2 = buildOutput([decl[3]], [settled[3]], '2026-09-03T12:00:00Z');
assert.strictEqual(out2.summary.worst, 'operationnel');
assert.strictEqual(out2.summary.counts.inconnu, 1);

// 9. Frontière de confiance : un résultat mal formé est rejeté avant allSettled,
// sans contaminer le fournisseur valide ni le contrat final.
const strictProviders = [
  { ...provider, id: 'good', name: 'Good', source: { kind: 'strict', url: 'https://ex.com' } },
  { ...provider, id: 'bad', name: 'Bad', source: { kind: 'strict', url: 'https://ex.com' } },
];
const goodResult = { indicator: 'operationnel', components: [{ name: 'API', status: 'operationnel' }] };
const malformed = [
  { indicator: 'operationnel', components: 'oops' },
  { indicator: 'operationnel', components: [{ name: null, status: 'operationnel' }] },
  { indicator: 'operationnel', components: [], incidents: [{ title: 7, state: 'en cours' }] },
  { indicator: 'operationnel', components: [], incidents: [{ title: 'X', state: 'en cours', createdAt: 'jamais' }] },
  { indicator: null, components: [] },
  { indicator: 'operationnel', components: Array(STATUS_LIMITS.components + 1).fill({ name: 'API', status: 'operationnel' }) },
];
for (const badResult of malformed) {
  const strict = { collect: async (p) => p.id === 'good' ? goodResult : badResult };
  const results = await collectAll(strictProviders, { strict }, okJson({}));
  assert.strictEqual(results[0].status, 'fulfilled');
  assert.strictEqual(results[1].status, 'rejected');
  const isolated = buildOutput(strictProviders, results, '2026-09-03T12:00:00Z', { strict });
  assert.strictEqual(isolated.providers[0].status, 'operationnel');
  assert.strictEqual(isolated.providers[1].status, 'inconnu');
  assert.strictEqual(isolated.providers[1].collect.state, 'error');
  assert.strictEqual(validateStatusDocument(isolated, strictProviders), true);
}

// Les URL facultatives hostiles disparaissent ; même origine et shortlinks Statuspage restent.
const links = await collectAll([provider], { statuspage: { collect: async () => ({
  indicator: 'operationnel',
  components: [],
  incidents: [
    { title: 'Safe', state: 'investigating', url: 'https://stspg.io/ok' },
    { title: 'Hostile', state: 'monitoring', url: 'javascript:alert(1)' },
  ],
}) } }, okJson({}));
const linked = buildProvider(provider, links[0]);
assert.deepStrictEqual(linked.incidents.map((incident) => incident.url), ['https://stspg.io/ok', null]);
assert.strictEqual(safeExternalUrl('https://ex.com/detail', provider.statusUrl, 'statuspage'), 'https://ex.com/detail');
assert.strictEqual(safeExternalUrl('https://stspg.io/x', provider.statusUrl, 'statuspage'), 'https://stspg.io/x');
for (const url of ['http://ex.com/x', 'https://evil.test/x', 'https://user@ex.com/x', 'javascript:alert(1)', 'data:text/plain,x']) {
  assert.strictEqual(safeExternalUrl(url, provider.statusUrl, 'statuspage'), null, url);
}

// Le seam HTTP commun garde son délai jusqu'au dernier octet, borne le corps et
// refuse toute destination non prévue avant le second fetch
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      const timer = setTimeout(() => {
        controller.enqueue(new TextEncoder().encode('trop tard'));
        controller.close();
      }, 100);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.error(signal.reason);
      }, { once: true });
    },
  }));
  await assert.rejects(
    httpGet('https://source.test/data', { as: 'text', timeoutMs: 10 }),
    (error) => error.name === 'AbortError',
    'le délai couvre le corps',
  );

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
      controller.close();
    },
  }), { headers: { 'Content-Length': '1' } });
  await assert.rejects(
    httpGet('https://source.test/data', { as: 'bytes', maxBytes: 10 }),
    (error) => error.code === 'limit',
    'les octets réellement décodés font foi',
  );

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, redirect: options.redirect });
    if (url.startsWith('https://replicatestatus.com/')) {
      return new Response(null, { status: 301, headers: { Location: 'https://www.replicatestatus.com/api/v2/summary.json' } });
    }
    return new Response('{"ok":true}');
  };
  assert.deepStrictEqual(
    await httpGet('https://replicatestatus.com/api/v2/summary.json', { redirectOrigins: ['https://www.replicatestatus.com'] }),
    { ok: true },
  );
  assert.deepStrictEqual(requests.map((request) => request.redirect), ['manual', 'manual']);

  const expectedBytes = new Uint8Array([0xff, 0xfe, 0x7b, 0x00]);
  globalThis.fetch = async () => new Response(expectedBytes);
  assert.deepStrictEqual(await httpGet('https://source.test/data', { as: 'bytes' }), expectedBytes);

  requests.length = 0;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, redirect: options.redirect });
    return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/metadata' } });
  };
  await assert.rejects(
    httpGet('https://source.test/data'),
    (error) => error.code === 'policy',
    'une redirection hors origine est refusée',
  );
  assert.strictEqual(requests.length, 1, 'la cible refusée ne reçoit aucune requête');

  const policyProvider = {
    ...provider,
    source: {
      kind: 'policy-test',
      url: 'https://source.test',
      maxResponseBytes: 64,
      redirectOrigins: ['https://redirect.test'],
    },
  };
  let receivedOptions;
  const policyResult = await collectAll([policyProvider], { 'policy-test': {
    collect: async (_p, get) => {
      await get('https://source.test/data', { maxBytes: 1, redirectOrigins: ['https://evil.test'] });
      return { indicator: 'operationnel', components: [] };
    },
  } }, async (_url, options) => {
    receivedOptions = options;
    return {};
  });
  assert.strictEqual(policyResult[0].status, 'fulfilled');
  assert.strictEqual(receivedOptions.maxBytes, 64);
  assert.deepStrictEqual(receivedOptions.redirectOrigins, ['https://redirect.test']);
} finally {
  globalThis.fetch = originalFetch;
}

// Le même validateur couvre producteur, CI et navigateur, sans garde toujours vraie.
assert.strictEqual(validateStatusDocument(out, decl), true);
assert.strictEqual(validateStatusDocument(out2, [decl[3]]), true);
assert.ok(Buffer.byteLength(JSON.stringify(out) + '\n') < MAX_STATUS_BYTES);
const boundedFailure = buildOutput(
  [provider],
  [{ status: 'rejected', reason: new Error('x'.repeat(STATUS_LIMITS.string + 100)) }],
  '2026-09-03T12:00:00Z',
);
assert.strictEqual(boundedFailure.providers[0].collect.error.length, STATUS_LIMITS.string);
assert.strictEqual(validateStatusDocument(boundedFailure, [provider]), true, 'une erreur énorme reste isolée et bornée');
for (const mutate of [
  (doc) => { doc.providers[0].components[0].name = null; },
  (doc) => { doc.providers[1].id = doc.providers[0].id; },
  (doc) => { doc.summary.counts.inconnu += 1; },
  (doc) => { doc.providers[0].collectedAt = 'jamais'; },
  (doc) => { doc.providers[0].incidents[0].url = 'javascript:alert(1)'; },
]) {
  const invalid = structuredClone(out);
  mutate(invalid);
  assert.strictEqual(validateStatusDocument(invalid, decl), false);
}

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
