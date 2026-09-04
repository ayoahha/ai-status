// Collecteur : parcourt providers.json, lance l'adaptateur adéquat par fournisseur,
// et écrit public/data/status.json (contrat v2). Un échec ne bloque jamais les autres.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as statuspage from './adapters/statuspage.mjs';
import * as alibaba from './adapters/alibaba.mjs';
import * as google from './adapters/google.mjs';
import * as flashcat from './adapters/flashcat.mjs';
import * as browser from './adapters/browser.mjs';
import * as instatus from './adapters/instatus.mjs';
import * as betterstack from './adapters/betterstack.mjs';
import * as checkly from './adapters/checkly.mjs';
import * as onlineornot from './adapters/onlineornot.mjs';
import * as aws from './adapters/aws.mjs';
import * as azure from './adapters/azure.mjs';
import * as tencent from './adapters/tencent.mjs';
import * as volcengine from './adapters/volcengine.mjs';
import * as unavailable from './adapters/unavailable.mjs';
import { get } from './lib/http.mjs';
import { collectAll, buildOutput } from './lib/collect.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const providers = JSON.parse(readFileSync(path.join(root, 'providers.json'), 'utf8'));

// Famille de source (providers.json, source.kind) → module adaptateur
const ADAPTERS = { statuspage, alibaba, google, flashcat, browser, instatus, betterstack, checkly, onlineornot, aws, azure, tencent, volcengine, unavailable };

const now = new Date().toISOString();
const settled = await collectAll(providers, ADAPTERS, get);
const out = buildOutput(providers, settled, now);

const outPath = path.join(root, 'public', 'data', 'status.json');
mkdirSync(path.dirname(outPath), { recursive: true });
// Compact : le fichier est servi tel quel à chaque visiteur
writeFileSync(outPath, JSON.stringify(out) + '\n');
console.log(`écrit ${outPath} (${out.providers.length} fournisseurs)`);
const ok = out.providers.filter((p) => p.collect.state === 'ok').length;
console.log(`collecte ok : ${ok}/${out.providers.length} ; pire état : ${out.summary.worst}`);
