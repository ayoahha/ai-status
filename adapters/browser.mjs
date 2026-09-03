// Adaptateur navigateur (Playwright + Chromium) : charge la page de statut « comme un
// navigateur », laisse le défi Cloudflare se résoudre seul (les CAPTCHA interactifs ne
// sont jamais contournés), puis analyse le DOM rendu.
// Utilisé par : xAI (Cloudflare), DeepSeek (SPA Flashcat). Un fournisseur sans parseur
// dédié reste « Non vérifié » : pas de repli par mots-clés sur le texte de la page
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Pilule d'état (xAI) → statut normalisé.
const PILL = {
  available: 'operationnel',
  degraded: 'degradation',
  'major outage': 'incident_majeur',
  outage: 'incident_majeur',
  maintenance: 'maintenance',
};

export function mapStatusFromPills(pills) {
  const known = pills.filter((x) => PILL[x] !== undefined);
  if (!known.length) return 'inconnu';
  if (known.some((x) => x === 'outage' || x === 'major outage')) return 'incident_majeur';
  if (known.some((x) => x === 'degraded') || known.some((x) => x === 'maintenance')) return 'degradation';
  return 'operationnel';
}

export async function collectBrowser(provider) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: 'playwright absent — lancer : npm i -D playwright && npx playwright install chromium' },
    };
  }
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: provider.locale ?? 'en-US',
  });
  // Défi Cloudflare simple (non interactif) : le navigateur le franchit tout seul.
  // navigator.webdriver masqué (détection standard des navigateurs headless).
  await ctx.addInitScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false });`);
  const page = await ctx.newPage();
  try {
    await page.goto(provider.source.url, { waitUntil: 'domcontentloaded', timeout: provider.timeoutMs ?? 60000 });
    if (provider.id === 'xai') {
      // Attendre que le défi se résolve (titre ne dit plus « Attention Required »).
      await page.waitForFunction(() => !/Attention Required/i.test(document.title), { timeout: 45000 }).catch(() => {});
    }
    await page.waitForTimeout(provider.renderWaitMs ?? 2500);
    const parse = PARSE[provider.id];
    if (!parse) {
      return {
        status: 'inconnu',
        collect: { state: 'error', error: `aucun parseur navigateur pour ${provider.id}` },
      };
    }
    const parsed = await parse(page, provider);
    return {
      ...parsed,
      collect: { state: parsed.error ? 'error' : 'ok', error: parsed.error ?? null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: {
        state: 'error',
        error: err.name === 'TimeoutError' ? `timeout sur ${provider.source.url}` : `erreur navigateur : ${err.message}`,
      },
    };
  } finally {
    await browser.close();
  }
}

const PARSE = { xai: parseXai, deepseek: parseDeepseek };

// xAI : page Statuspage (nouvelle génération) rendue côté serveur derrière Cloudflare.
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
  const pills = rows.map((r) => r.pill);
  const incidents = await page.$$eval('a.p-2', (els) =>
    els
      .map((e) => {
        const h2 = e.querySelector('h2');
        const title = h2?.textContent?.trim() ?? '';
        const m = title.match(/\b(major outage|outage|degraded|maintenance|investigating|monitoring)\b/i);
        return { title, state: m ? m[1].toLowerCase() : null, createdAt: null };
      })
      .filter((i) => i.title)
  );
  const components = rows.filter((r) => PILL[r.pill] && PILL[r.pill] !== 'operationnel').map((r) => r.name);
  const out = {
    status: mapStatusFromPills(pills),
    rawStatus: pills.length ? `services : ${pills.filter(Boolean).join(', ')}` : null,
    rawIndicator: 'statuspage_dom',
    components,
    incidents,
    sourcePublishedAt: null,
  };
  if (!rows.length) out.error = 'aucun service trouvé dans le DOM (page non rendue ou défi non résolu)';
  return out;
}

// DeepSeek : SPA Flashcat — le statut et les composants sont chargés côté client,
// lisibles seulement dans le DOM rendu.
async function parseDeepseek(page) {
  const banner = await page.$eval('h2.font-medium', (e) => e.textContent.trim()).catch(() => '');
  let status;
  if (/运行正常|operational|running smoothly|all systems/i.test(banner)) status = 'operationnel';
  else if (/中断|outage/i.test(banner)) status = 'incident_majeur';
  else if (/降级|degraded|partial/i.test(banner)) status = 'degradation';
  else if (/maintenance/i.test(banner)) status = 'maintenance';
  else status = 'inconnu';
  const components = await page.$$eval('.divide-y div.p-4 span.font-medium', (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean)
  );
  return {
    status,
    rawStatus: banner || null,
    rawIndicator: 'flashcat_dom',
    components,
    incidents: [],
    sourcePublishedAt: null,
  };
}
