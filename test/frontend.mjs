import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const NOW = Date.parse('2026-09-04T08:00:00Z');
const MINUTE = 60_000;
const files = {
  '/': ['text/html; charset=utf-8', readFileSync(new URL('../public/index.html', import.meta.url))],
  '/app.js': ['text/javascript; charset=utf-8', readFileSync(new URL('../public/app.js', import.meta.url))],
  '/style.css': ['text/css; charset=utf-8', readFileSync(new URL('../public/style.css', import.meta.url))],
};

const statusDoc = (generatedAt, name = 'Fournisseur test') => ({
  schemaVersion: 2,
  generatedAt,
  labels: {
    operationnel: 'Opérationnel', degradation: 'Dégradation', incident_majeur: 'Incident majeur',
    maintenance: 'Maintenance', indisponible: 'Indisponible', inconnu: 'Non vérifié',
  },
  summary: {
    worst: 'operationnel',
    counts: { operationnel: 1, degradation: 0, incident_majeur: 0, maintenance: 0, indisponible: 0, inconnu: 0 },
    activeIncidents: 0,
    activeMaintenances: 0,
  },
  providers: [{
    id: 'test', name, group: 'us', scope: 'API de test', statusUrl: 'https://example.com/status',
    status: 'operationnel', reason: 'aucun incident déclaré', sourceText: null,
    collectedAt: generatedAt,
    collect: { state: 'ok', method: 'statuspage', error: null },
    components: [{ name: 'API', kind: 'service', status: 'operationnel' }],
    incidents: [], maintenances: [],
  }],
});

let responses = [];
let requests = 0;
const held = [];

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/data/status.json') {
    const response = responses[Math.min(requests++, responses.length - 1)];
    if (response?.hold) {
      held.push({ res, body: response.body });
      return;
    }
    res.writeHead(response?.status ?? 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(response?.body ?? {}));
    return;
  }
  const file = files[path];
  if (!file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': file[0] });
  res.end(file[1]);
});

const waitForRequests = async (count) => {
  for (let i = 0; i < 100 && requests < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requests, count);
};

const releaseHeld = (body) => {
  const pending = held.shift();
  assert.ok(pending, 'une requête retenue était attendue');
  pending.res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  pending.res.end(JSON.stringify(body ?? pending.body));
};

let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  browser = await chromium.launch({ headless: true });

  async function scenario(sequence, run, options = {}) {
    responses = sequence;
    requests = 0;
    held.length = 0;
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.clock.install({ time: NOW });
    try {
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.locator('#refresh[aria-busy="false"]').waitFor();
      await run(page);
      assert.deepEqual(pageErrors, [], 'aucune erreur JavaScript dans la page');
    } finally {
      for (const pending of held.splice(0)) pending.res.destroy();
      await context.close();
    }
  }

  const old = statusDoc(new Date(NOW - 3 * 60 * MINUTE).toISOString(), 'Ancien fournisseur');
  const fresh = statusDoc(new Date(NOW + 30 * MINUTE).toISOString(), 'Nouveau fournisseur');

  await scenario([{ body: old }, { body: fresh }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    await page.locator('#stale').waitFor();
    await page.getByRole('searchbox').fill('nouveau');
    await page.locator('#sort').selectOption('name');
    await page.clock.runFor(30 * MINUTE);
    await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
    assert.equal(await page.getByRole('searchbox').inputValue(), 'nouveau');
    assert.equal(await page.locator('#sort').inputValue(), 'name');
    assert.equal(requests, 2);
    assert.equal(await page.locator('#stale').isHidden(), true);
  });

  await scenario([{ body: old }, { body: fresh }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    const refresh = page.getByRole('button', { name: 'Rafraîchir' });
    await refresh.focus();
    await page.keyboard.press('Enter');
    await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
    assert.match(await page.locator('#refresh-status').textContent(), /Données actualisées/);
    assert.equal(requests, 2, 'le bouton ignore l’échéance de 30 minutes');
  });

  await scenario([{ status: 500 }, { body: fresh }], async (page) => {
    await page.getByText('Données indisponibles', { exact: true }).waitFor();
    await page.locator('#refresh-error').waitFor();
    await page.getByRole('button', { name: 'Rafraîchir' }).click();
    await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
    assert.equal(await page.locator('#refresh-error').isHidden(), true);
  });

  await scenario([{ status: 500 }, { body: fresh }], async (page) => {
    await page.getByText('Données indisponibles', { exact: true }).waitFor();
    await page.locator('#refresh-error').waitFor();
    await page.getByRole('button', { name: 'Rafraîchir' }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Rafraîchir' }).isEnabled(), true);
    await page.clock.runFor(30 * MINUTE);
    await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
    assert.equal(requests, 2);
  });

  await scenario([{ body: old }, { status: 500 }, { body: { schemaVersion: 2, generatedAt: new Date(NOW).toISOString(), providers: [] } }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Rafraîchir' }).click();
    await page.locator('#refresh-error').waitFor();
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Rafraîchir' }).click();
    await page.locator('#refresh-error').waitFor();
    await waitForRequests(3);
    await page.locator('#refresh[aria-busy="false"]').waitFor();
    assert.equal(await page.getByText('Ancien fournisseur', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Nouveau fournisseur', { exact: true }).count(), 0);
  });

  const current = statusDoc(new Date(NOW).toISOString(), 'Données actuelles');
  const older = statusDoc(new Date(NOW - MINUTE).toISOString(), 'Données régressives');
  await scenario([{ body: current }, { body: older }], async (page) => {
    await page.getByText('Données actuelles', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Rafraîchir' }).click();
    await page.locator('#refresh-error').waitFor();
    assert.equal(await page.getByText('Données actuelles', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Données régressives', { exact: true }).count(), 0);
  });

  const inconsistent = structuredClone(fresh);
  inconsistent.summary.counts.operationnel = 2;
  await scenario([{ body: current }, { body: inconsistent }], async (page) => {
    await page.getByText('Données actuelles', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Rafraîchir' }).click();
    await page.locator('#refresh-error').waitFor();
    assert.equal(await page.getByText('Données actuelles', { exact: true }).count(), 1);
  });

  await scenario([{ body: old }, { hold: true, body: fresh }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    const refresh = page.getByRole('button', { name: 'Rafraîchir' });
    const click = refresh.click();
    await waitForRequests(2);
    assert.equal(await refresh.isDisabled(), true);
    assert.equal(await refresh.getAttribute('aria-busy'), 'true');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(requests, 2, 'tous les déclencheurs partagent le même verrou');
    releaseHeld();
    await click;
    await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
    assert.equal(await refresh.isEnabled(), true);
    assert.equal(await refresh.getAttribute('aria-busy'), 'false');
  });

  await scenario([{ body: old }, { hold: true }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    const refresh = page.getByRole('button', { name: 'Rafraîchir' });
    const click = refresh.click();
    await waitForRequests(2);
    await page.clock.runFor(14_999);
    assert.equal(await refresh.isDisabled(), true);
    await page.clock.runFor(1);
    await click;
    await page.locator('#refresh-error').waitFor();
    assert.equal(await refresh.isEnabled(), true);
    assert.equal(await page.getByText('Ancien fournisseur', { exact: true }).count(), 1);
  });

  await scenario([{ body: old }, { body: fresh }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    const currentTime = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(currentTime + 30 * MINUTE);
    assert.equal(requests, 1, 'changer seulement l’heure ne déclenche pas le minuteur');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
    assert.equal(requests, 2);
  });

  await scenario([{ body: old }, { body: statusDoc(old.generatedAt, 'Contenu incohérent') }], async (page) => {
    await page.getByText('Ancien fournisseur', { exact: true }).waitFor();
    await page.locator('.card details').evaluate((details) => { details.open = true; });
    await page.getByRole('button', { name: 'Rafraîchir' }).click();
    await page.locator('#refresh[aria-busy="false"]').waitFor();
    assert.equal(await page.getByText('Ancien fournisseur', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Contenu incohérent', { exact: true }).count(), 0);
    assert.equal(await page.locator('.card details').getAttribute('open'), '');
  });

  for (const width of [390, 1440]) {
    await scenario([{ body: fresh }], async (page) => {
      await page.getByText('Nouveau fournisseur', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    }, { viewport: { width, height: 900 } });
  }

  console.log('OK — actualisation navigateur fiable');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
