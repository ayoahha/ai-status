import { worstOf } from '../lib/normalize.mjs';
import { fail } from '../lib/errors.mjs';

// Azure status (azure.status.microsoft, ex status.azure.com) : page rendue côté serveur,
// sans JSON ; le flux RSS documenté ne couvre que les incidents publiés, sans état par
// service. On lit le tableau HTML : une ligne <tr><td>Service</td><td data-label="…">…
// par service et par zone géographique. Légende de la page : Good, Information (« no current
// service availability issues »), Warning (« potential service issues in a region »),
// Critical (« widespread issues »), Not available (service non proposé dans la région).
// Périmètre : lignes dont le nom figure dans source.services ; état = pire cellule
const LABEL = { Good: 'operationnel', Information: 'operationnel', Warning: 'degradation', Critical: 'incident_majeur' };

export function azureLabel(label) {
  return LABEL[label] ?? 'inconnu';
}

export function parseAzureRows(html) {
  const rows = new Map();
  for (const m of html.matchAll(/<tr[^>]*>\s*<td>\s*([^<]+?)\s*<\/td>([\s\S]*?)<\/tr>/g)) {
    const labels = [...m[2].matchAll(/data-label="([^"]+)"/g)].map((x) => x[1]).filter((l) => l !== 'Not available');
    const list = rows.get(m[1]) ?? [];
    list.push(...labels);
    rows.set(m[1], list);
  }
  return rows;
}

export async function collect(provider, get) {
  const wanted = provider.source.services ?? [];
  const rows = parseAzureRows(await get(provider.source.url, { as: 'text' }));
  const found = wanted.filter((name) => rows.has(name));
  if (found.length === 0) throw fail('scope', `${wanted.join(', ')} (tableau Azure)`);
  // Service listé mais sans aucune cellule lisible : état illisible, jamais vert
  const components = found.map((name) => ({ name, status: rows.get(name).length ? worstOf(rows.get(name).map(azureLabel)) : 'inconnu' }));
  const alerted = components.filter((c) => c.status !== 'operationnel');
  const missing = wanted.filter((name) => !rows.has(name));
  return {
    status: worstOf(components.map((c) => c.status)),
    rawStatus: alerted.length ? `${alerted.length} service(s) with a non-Good cell` : `All cells Good (${found.length} services)`,
    rawIndicator: alerted.length ? 'alert' : 'good',
    components,
    incidents: [],
    note: missing.length ? `services absents du tableau : ${missing.join(', ')}` : null,
    noteEn: missing.length ? `services missing from the table: ${missing.join(', ')}` : null,
  };
}
