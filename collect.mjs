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
import { fetchJson } from './lib/http.mjs';
import { collectAll, buildOutput } from './lib/collect.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const providers = JSON.parse(readFileSync(path.join(root, 'providers.json'), 'utf8'));

const ADAPTERS = {
  statuspage: (p) => collectStatuspage(p, fetchJson),
  alibaba: (p) => collectAlibaba(p, fetchJson),
  google: (p) => collectGoogle(p, fetchJson),
  flashcat: (p) => collectFlashcat(p, fetchJson),
  browser: (p) => collectBrowser(p),
  // Source connue mais injoignable (ex. Zhipu) : aucune requête, jamais « opérationnel »
  unavailable: async (p) => ({
    status: 'inconnu',
    collect: { state: 'error', error: p.source.note ?? 'source indisponible' },
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
