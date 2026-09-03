// Collecteur : parcourt providers.json, lance l'adaptateur adéquat par fournisseur,
// et écrit public/data/status.json. Un échec ne bloque jamais les autres.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { collectStatuspage } from './adapters/statuspage.mjs';
import { collectAlibaba } from './adapters/alibaba.mjs';
import { collectGoogle } from './adapters/google.mjs';
import { collectSimple } from './adapters/simple.mjs';
import { fetchJson, fetchText } from './lib/http.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const providers = JSON.parse(
  readFileSync(path.join(root, 'providers.json'), 'utf8')
);

const ADAPTERS = {
  statuspage: (p) => collectStatuspage(p, fetchJson),
  alibaba: (p) => collectAlibaba(p, fetchJson),
  google: (p) => collectGoogle(p, fetchText),
  simple: (p) => collectSimple(p, fetchText),
};

const now = new Date().toISOString();

const providersOut = await Promise.allSettled(
  providers.map((p) => {
    const run = ADAPTERS[p.source.kind];
    if (!run) throw new Error(`adaptateur inconnu : ${p.source.kind}`);
    return run(p).then((r) => ({
      id: p.id,
      name: p.name,
      statusUrl: p.statusUrl,
      status: r.status,
      rawStatus: r.rawStatus ?? null,
      rawIndicator: r.rawIndicator ?? null,
      components: r.components ?? [],
      incidents: r.incidents ?? [],
      sourcePublishedAt: r.sourcePublishedAt ?? null,
      collectedAt: now,
      collect: r.collect,
    }));
  })
);

const out = {
  generatedAt: now,
  providers: providersOut.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          id: '?',
          name: 'Erreur de collecte',
          status: 'inconnu',
          collect: { state: 'error', error: String(r.reason) },
        }
  ),
};

const outPath = path.join(root, 'public', 'data', 'status.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`écrit ${outPath} (${out.providers.length} fournisseurs)`);
const ok = out.providers.filter((p) => p.collect?.state === 'ok').length;
console.log(`collecte ok : ${ok}/${out.providers.length}`);
