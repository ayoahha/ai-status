// Collecteur : parcourt providers.json, lance l'adaptateur adéquat par fournisseur,
// et écrit public/data/status.json (contrat v2). Un échec ne bloque jamais les autres.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { collectStatuspage } from './adapters/statuspage.mjs';
import { collectAlibaba } from './adapters/alibaba.mjs';
import { collectGoogle } from './adapters/google.mjs';
import { collectFlashcat } from './adapters/flashcat.mjs';
import { collectBrowser } from './adapters/browser.mjs';
import { collectInstatus } from './adapters/instatus.mjs';
import { collectBetterstack } from './adapters/betterstack.mjs';
import { collectCheckly } from './adapters/checkly.mjs';
import { collectOnlineornot } from './adapters/onlineornot.mjs';
import { collectAws } from './adapters/aws.mjs';
import { collectAzure } from './adapters/azure.mjs';
import { collectTencent } from './adapters/tencent.mjs';
import { collectVolcengine } from './adapters/volcengine.mjs';
import { fetchJson, fetchText } from './lib/http.mjs';
import { collectAll, buildOutput } from './lib/collect.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const providers = JSON.parse(readFileSync(path.join(root, 'providers.json'), 'utf8'));

const ADAPTERS = {
  statuspage: (p) => collectStatuspage(p, fetchJson),
  alibaba: (p) => collectAlibaba(p, fetchJson),
  google: (p) => collectGoogle(p, fetchJson),
  flashcat: (p) => collectFlashcat(p, fetchJson),
  browser: (p) => collectBrowser(p),
  instatus: (p) => collectInstatus(p, fetchJson),
  betterstack: (p) => collectBetterstack(p, fetchJson),
  checkly: (p) => collectCheckly(p, fetchJson),
  onlineornot: (p) => collectOnlineornot(p, fetchText),
  aws: (p) => collectAws(p, fetchJson),
  azure: (p) => collectAzure(p, fetchText),
  tencent: (p) => collectTencent(p, fetchJson),
  volcengine: (p) => collectVolcengine(p, (url) => fetchText(url, { accept: 'application/rss+xml,text/xml' })),
  // Source connue mais injoignable (Zhipu) ou inexistante (Baidu) : aucune requête, jamais « opérationnel »
  unavailable: async (p) => ({
    status: 'inconnu',
    collect: { state: 'error', error: p.source.note ?? 'source indisponible', errorEn: p.source.noteEn ?? null },
  }),
};

const now = new Date().toISOString();
const settled = await collectAll(providers, ADAPTERS);
const out = buildOutput(providers, settled, now);

const outPath = path.join(root, 'public', 'data', 'status.json');
mkdirSync(path.dirname(outPath), { recursive: true });
// Compact : le fichier est servi tel quel à chaque visiteur
writeFileSync(outPath, JSON.stringify(out) + '\n');
console.log(`écrit ${outPath} (${out.providers.length} fournisseurs)`);
const ok = out.providers.filter((p) => p.collect.state === 'ok').length;
console.log(`collecte ok : ${ok}/${out.providers.length} ; pire état : ${out.summary.worst}`);
