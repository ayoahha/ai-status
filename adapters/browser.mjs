// Adaptateur navigateur (Playwright + Chromium) : charge la page de statut « comme un
// navigateur », laisse le défi Cloudflare automatique se résoudre seul (les CAPTCHA
// interactifs ne sont jamais contournés), puis analyse le DOM rendu.
// Utilisé par xAI seulement : status.x.ai répond 403 à tout client non navigateur,
// y compris sur /api/v2/*, /feed et /rss (vérifié). Un fournisseur sans parseur dédié
// reste « Non vérifié » : pas de repli par mots-clés sur le texte de la page.
// Le client `get` du runner n'est pas utilisé : le navigateur fait ses propres requêtes
import { fail } from '../lib/errors.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Pilule d'état (xAI) → statut normalisé. Toute pilule hors de cette liste rend le
// service « inconnu », ce qui interdit « operationnel » au fournisseur
const PILL = {
  available: 'operationnel',
  degraded: 'degradation',
  'partial outage': 'degradation',
  'major outage': 'incident_majeur',
  outage: 'incident_majeur',
  maintenance: 'maintenance',
};

export function pillStatus(pill) {
  return PILL[(pill ?? '').trim().toLowerCase()] ?? 'inconnu';
}

export async function collect(provider) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw fail('browser', 'playwright absent : npm ci && npx playwright install chromium');
  }
  const parse = PARSE[provider.id];
  if (!parse) throw fail('browser', `aucun parseur navigateur pour ${provider.id}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: provider.locale ?? 'en-US',
  });
  // Défi Cloudflare automatique : le navigateur le franchit seul.
  // navigator.webdriver masqué (détection standard des navigateurs headless)
  await ctx.addInitScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false });`);
  const page = await ctx.newPage();
  try {
    await page.goto(provider.source.url, { waitUntil: 'domcontentloaded', timeout: provider.timeoutMs ?? 60000 });
    // Attendre que le défi se résolve (titre ne dit plus « Attention Required »)
    await page.waitForFunction(() => !/Attention Required/i.test(document.title), { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(provider.renderWaitMs ?? 2500);
    return await parse(page, provider);
  } catch (err) {
    // TimeoutError Playwright : classé timeout par le runner ; le reste : erreur navigateur
    if (err.name === 'TimeoutError' || err.code) throw err;
    throw fail('browser', err.message);
  } finally {
    await browser.close();
  }
}

const PARSE = { xai: parseXai };

// xAI : page de statut rendue côté serveur derrière Cloudflare.
// Services : <a class="w-full card"> (nom dans .heading-2, état dans la pilule).
// Incidents : <a class="p-2"> (titre h2 + description p).
async function parseXai(page) {
  const rows = await page.$$eval('a.w-full.card', (els) =>
    els
      .map((e) => {
        const name = e.querySelector('.heading-2')?.textContent?.trim() ?? '';
        const pill = e.querySelector('div[class*="rounded-\\[32px\\]')?.textContent?.trim() ?? '';
        return { name, pill };
      })
      .filter((r) => r.name)
  );
  if (!rows.length) throw fail('schema', 'aucun service trouvé dans le DOM (page non rendue ou défi non résolu)');
  const services = rows.map((r) => ({ name: r.name, pill: r.pill, status: pillStatus(r.pill) }));
  const unknown = services.filter((s) => s.status === 'inconnu');
  if (unknown.length) throw fail('schema', `pilule non reconnue : ${unknown.map((s) => `${s.name}=« ${s.pill} »`).join(', ')}`);
  const incidents = await page.$$eval('a.p-2', (els) =>
    els
      .map((e) => {
        const title = e.querySelector('h2')?.textContent?.trim() ?? '';
        const m = title.match(/\b(major outage|outage|degraded|maintenance|investigating|monitoring)\b/i);
        return { title, state: m ? m[1].toLowerCase() : 'en cours', createdAt: null };
      })
      .filter((i) => i.title)
  );
  return {
    indicator: null,
    rawStatus: `${services.length} services : ${summarize(services)}`,
    rawIndicator: 'statuspage_dom',
    components: services.map((s) => ({ name: s.name, status: s.status })),
    incidents,
  };
}

function summarize(services) {
  const counts = {};
  for (const s of services) counts[s.pill || '?'] = (counts[s.pill || '?'] ?? 0) + 1;
  return Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
}
