// Tests légers sans framework : node test/test.mjs
// Aucun accès réseau, aucune lecture de fichier généré : tout passe par des fixtures
// réelles capturées dans test/fixtures/
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeIndicator, normalizeComponentStatus, normalizeGoogleImpact, worstOf, normalizeFailure } from '../lib/normalize.mjs';
import { collectStatuspage } from '../adapters/statuspage.mjs';
import { collectAlibaba } from '../adapters/alibaba.mjs';
import { collectGoogle } from '../adapters/google.mjs';
import { collectFlashcat } from '../adapters/flashcat.mjs';
import { pillStatus } from '../adapters/browser.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const byUrl = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  return key ? { ok: true, status: 200, json: async () => map[key] } : { ok: false, status: 404, json: async () => ({}) };
};
const failing = async () => { throw new Error('ECONNREFUSED'); };

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

// 3b. Statuspage : fixture réelle Anthropic, tout operational → aucun composant impacté.
const anthropic = fixture('statuspage-summary-anthropic.json');
const s4 = await collectStatuspage(provider, okJson(anthropic));
assert.strictEqual(s4.status, 'operationnel');
assert.deepStrictEqual(s4.components, []);
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
assert.deepStrictEqual(s5.components, ['API']);
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
assert.deepStrictEqual(s7.components, ['API']);

// 4. Google : flux officiels, périmètre par préfixe.
const gProvider = { ...provider, source: { kind: 'google', url: 'https://status.cloud.google.com', productPrefixes: ['Vertex', 'Gemini'] } };
const products = fixture('google-products.json');
assert.ok(products.products.some((p) => p.title === 'Vertex Gemini API'), 'produit du périmètre attendu dans la fixture');
const g1 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': fixture('google-incidents-ia.json') }));
assert.strictEqual(g1.status, 'operationnel', 'fixture : incidents tous terminés');
assert.deepStrictEqual(g1.components, []);
assert.ok(/Aucun incident déclaré/.test(g1.rawStatus));
const openOn = (title, impact) => [{ external_desc: 'Test', begin: '2026-09-03T10:00:00+00:00', end: null, status_impact: impact, uri: 'incidents/abc', affected_products: [{ title }] }];
const g2 = await collectGoogle(gProvider, byUrl({ 'products.json': products, 'incidents.json': openOn('Vertex Gemini API', 'SERVICE_DISRUPTION') }));
assert.strictEqual(g2.status, 'degradation');
assert.deepStrictEqual(g2.components, ['Vertex Gemini API']);
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
assert.strictEqual(f1.collect.state, 'ok');
// 5b. Payload vide, sans composants, ou 200 inattendu → jamais vert.
for (const body of [{}, { data: {} }, { data: { page: { components: [] }, active_changes: [] } }, { data: { page: { components: [{ name: 'x' }] } } }]) {
  const f = await collectFlashcat(fProvider, okJson(body));
  assert.strictEqual(f.status, 'inconnu', `payload ${JSON.stringify(body)}`);
}
const f2 = await collectFlashcat(fProvider, async () => ({ ok: false, status: 404 }));
assert.strictEqual(f2.status, 'inconnu');
// 5c. Un changement actif → degradation avec son titre.
const f3 = await collectFlashcat(fProvider, okJson({ data: { page: { components: [{ name: 'API' }] }, active_changes: [{ title: 'API errors' }] } }));
assert.strictEqual(f3.status, 'degradation');
assert.strictEqual(f3.incidents[0].title, 'API errors');

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

// 8. providers.json : cohérence des déclarations.
const providers = JSON.parse(readFileSync(new URL('../providers.json', import.meta.url), 'utf8'));
const kinds = new Set(['statuspage', 'alibaba', 'google', 'flashcat', 'browser', 'unavailable']);
for (const p of providers) {
  assert.ok(p.id && p.name && p.statusUrl && p.source?.kind && p.source?.url, `fournisseur incomplet : ${p.id}`);
  assert.ok(kinds.has(p.source.kind), `kind inconnu : ${p.id} ${p.source.kind}`);
  if (p.source.kind === 'unavailable') assert.ok(p.source.note, `note manquante : ${p.id}`);
  if (p.source.kind === 'google') assert.ok(p.source.productPrefixes?.length, `productPrefixes manquant : ${p.id}`);
  if (p.source.kind === 'flashcat') assert.ok(p.source.pageId, `pageId manquant : ${p.id}`);
  if (p.source.kind === 'browser') assert.strictEqual(p.id, 'xai', 'seul xAI a un parseur navigateur');
}

console.log(`OK — ${providers.length} fournisseurs déclarés, tests verts`);
