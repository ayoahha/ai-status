// Tests légers sans framework : node test/test.mjs
// Aucun accès réseau, aucune lecture de fichier généré : tout passe par des fixtures
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeIndicator, normalizeGoogleClass, normalizeFailure } from '../lib/normalize.mjs';
import { collectStatuspage } from '../adapters/statuspage.mjs';
import { collectAlibaba } from '../adapters/alibaba.mjs';
import { collectSimple } from '../adapters/simple.mjs';
import { collectGoogle } from '../adapters/google.mjs';
import { mapStatusFromPills } from '../adapters/browser.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const provider = {
  id: 'test', name: 'Test', statusUrl: 'https://ex.com',
  source: { kind: 'statuspage', url: 'https://ex.com' },
};

// 1. Normalisation des indicateurs Statuspage.
assert.strictEqual(normalizeIndicator('none'), 'operationnel');
assert.strictEqual(normalizeIndicator('minor'), 'degradation');
assert.strictEqual(normalizeIndicator('major'), 'incident_majeur');
assert.strictEqual(normalizeIndicator('critical'), 'indisponible');
assert.strictEqual(normalizeIndicator('maintenance'), 'maintenance');
assert.strictEqual(normalizeIndicator('inexistant'), 'inconnu');

// 2. Échec de collecte → jamais "operationnel".
assert.strictEqual(normalizeFailure(), 'inconnu');

// 3. Classes d'icônes Google.
assert.strictEqual(normalizeGoogleClass('available'), 'operationnel');
assert.strictEqual(normalizeGoogleClass('warning'), 'degradation');
assert.strictEqual(normalizeGoogleClass('outage'), 'incident_majeur');
assert.strictEqual(normalizeGoogleClass('maintenance'), 'maintenance');
assert.strictEqual(normalizeGoogleClass('autre'), 'inconnu');

// 4. Adaptateur Statuspage : le fetch faux contrôle le comportement en échec.
const failingGet = async () => {
  throw new Error('ECONNREFUSED');
};
const r1 = await collectStatuspage(provider, failingGet);
assert.strictEqual(r1.status, 'inconnu');
assert.strictEqual(r1.collect.state, 'error');
assert.ok(/erreur réseau/.test(r1.collect.error));

// 4b. HTTP 500 → inconnu.
const r2 = await collectStatuspage(provider, async () => ({
  ok: false, status: 500, json: async () => ({}),
}));
assert.strictEqual(r2.status, 'inconnu');
assert.ok(/HTTP 500/.test(r2.collect.error));

// 4c. Succès sur fixture réelle : 6 composants "operational" → aucun impacté.
const statuspageGet = (statusBody, componentsBody) => async (url) => ({
  ok: true, status: 200,
  json: async () => {
    if (url.includes('/status.json')) return statusBody;
    if (url.includes('/incidents.json')) return { incidents: [] };
    return componentsBody;
  },
});
const allOperational = fixture('statuspage-components-anthropic.json');
assert.ok(allOperational.components.every((c) => c.status === 'operational'), 'fixture attendue 100 % operational');
const r3 = await collectStatuspage(provider, statuspageGet(
  { page: { updated_at: '2026-01-01T00:00:00Z' }, status: { indicator: 'none', description: 'All Systems Operational' } },
  allOperational,
));
assert.strictEqual(r3.status, 'operationnel');
assert.deepStrictEqual(r3.components, []);
assert.strictEqual(r3.collect.state, 'ok');

// 4d. Un composant dégradé, un groupe dégradé (agrégat) → seul le composant est listé.
const r3b = await collectStatuspage(provider, statuspageGet(
  { status: { indicator: 'minor', description: 'Partial degradation' } },
  { components: [
    { name: 'API', status: 'degraded_performance' },
    { name: 'Modèles', status: 'degraded_performance', group: true },
    { name: 'Console', status: 'operational' },
  ] },
));
assert.strictEqual(r3b.status, 'degradation');
assert.strictEqual(r3b.rawStatus, 'Partial degradation');
assert.deepStrictEqual(r3b.components, ['API']);

// 5. Adaptateur simple : réponse SPA → inconnu, jamais operationnel.
const spaResponse = {
  ok: true, status: 200,
  headers: { get: (k) => (k === 'content-type' ? 'text/html' : null) },
  text: async () => '<html><body>SPA</body></html>',
};
const r4 = await collectSimple(provider, async () => spaResponse);
assert.strictEqual(r4.status, 'inconnu');
assert.strictEqual(r4.collect.state, 'error');
assert.ok(/SPA/.test(r4.collect.error));

// 6. Adaptateur simple : HTTP 403 Cloudflare → inconnu + message sans info sensible.
const r5 = await collectSimple(provider, async () => ({ ok: false, status: 403 }));
assert.strictEqual(r5.status, 'inconnu');
assert.ok(/403/.test(r5.collect.error));

// 7. Adaptateur Alibaba : aucun événement en cours → operationnel ; un en cours → degradation.
const aliEvents = {
  ok: true, status: 200,
  json: async () => ({
    data: [
      { id: 1, title: '[Incident (Recovered)] Foo', eventType: 'ALARM', startTime: 1, endTime: 2, lastUpdateTime: 3 },
    ],
  }),
};
const r6 = await collectAlibaba(provider, async () => aliEvents);
assert.strictEqual(r6.status, 'operationnel');
const aliOngoing = {
  ok: true, status: 200,
  json: async () => ({
    data: [
      { id: 2, title: '[Incident] Bar', eventType: 'ALARM', startTime: Date.now() - 3600000, endTime: null },
    ],
  }),
};
const r7 = await collectAlibaba(provider, async () => aliOngoing);
assert.strictEqual(r7.status, 'degradation');
assert.strictEqual(r7.incidents[0].state, 'en cours');

// 8. Adaptateur Google : structure introuvable → inconnu.
const noStruct = {
  ok: true, status: 200,
  headers: { get: () => 'text/html' },
  text: async () => '<html>autre chose</html>',
};
const r8 = await collectGoogle(provider, async () => noStruct);
assert.strictEqual(r8.status, 'inconnu');
assert.ok(/psd-status-icon/.test(r8.collect.error));

// 9. Adaptateur navigateur : mapping des pilules d'état xAI → statut.
assert.strictEqual(mapStatusFromPills(['available', 'available']), 'operationnel');
assert.strictEqual(mapStatusFromPills(['available', 'degraded']), 'degradation');
assert.strictEqual(mapStatusFromPills(['available', 'maintenance']), 'degradation');
assert.strictEqual(mapStatusFromPills(['outage']), 'incident_majeur');
assert.strictEqual(mapStatusFromPills(['major outage']), 'incident_majeur');
assert.strictEqual(mapStatusFromPills([]), 'inconnu');

// 10. providers.json : chaque source injoignable porte une note affichable.
const providers = JSON.parse(readFileSync(new URL('../providers.json', import.meta.url), 'utf8'));
for (const p of providers) {
  assert.ok(p.id && p.name && p.statusUrl && p.source?.kind && p.source?.url, `fournisseur incomplet : ${p.id}`);
  if (p.source.kind === 'unavailable') assert.ok(p.source.note, `note manquante : ${p.id}`);
}

console.log(`OK — ${providers.length} fournisseurs déclarés, tests verts`);
