// Assemblage du contrat v2 de public/data/status.json à partir des résultats
// d'adaptateurs. Pur : pas de réseau, pas de fichier, testable sur fixtures.
import { classifyKind, worstOf, STATUS_LABELS, STATUSES } from './normalize.mjs';

const ACTIVE_INCIDENT = new Set(['investigating', 'identified', 'monitoring', 'en cours']);

// Lance chaque adaptateur en isolant les échecs : un throw devient un rejet
// capturé par allSettled, jamais un plantage de toute la collecte
export async function collectAll(providers, adapters) {
  return Promise.allSettled(
    providers.map((p) =>
      Promise.resolve().then(() => {
        const run = adapters[p.source.kind];
        if (!run) throw new Error(`adaptateur inconnu : ${p.source.kind}`);
        return run(p);
      }).then((r) => ({ ...r, collectedAt: new Date().toISOString() }))
    )
  );
}

function pluralize(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

// Phrase courte en français expliquant le statut, sans texte brut de la source
export function reasonFor(p) {
  if (p.collect.state === 'error') return 'source non lue';
  const alert = p.components.filter((c) => c.status !== 'operationnel' && c.status !== 'inconnu');
  const unknown = p.components.filter((c) => c.status === 'inconnu');
  const inProgress = p.maintenances.filter((m) => m.state === 'in_progress' || m.state === 'verifying');
  if (p.status === 'operationnel') return p.components.length ? `${pluralize(p.components.length, 'composant suivi', 'composants suivis')}, aucune alerte` : 'aucun incident déclaré';
  if (p.status === 'inconnu') return unknown.length ? `${pluralize(unknown.length, 'composant', 'composants')} à l'état illisible` : 'état non déterminé';
  if (p.status === 'maintenance' && inProgress.length) return pluralize(inProgress.length, 'maintenance en cours', 'maintenances en cours');
  if (alert.length) return `${pluralize(alert.length, 'composant', 'composants')} en ${STATUS_LABELS[p.status].toLowerCase()}`;
  if (p.incidents.length) return pluralize(p.incidents.length, 'incident en cours', 'incidents en cours');
  return STATUS_LABELS[p.status];
}

export function buildProvider(p, settledResult) {
  const base = { id: p.id, name: p.name, scope: p.scope ?? null, statusUrl: p.statusUrl };
  const r = settledResult.status === 'fulfilled'
    ? settledResult.value
    : {
        status: 'inconnu',
        collectedAt: new Date().toISOString(),
        collect: { state: 'error', error: String(settledResult.reason?.message ?? settledResult.reason) },
      };
  const components = (r.components ?? []).map((c) => ({
    name: c.name,
    kind: classifyKind(c.name, p.modelPattern),
    status: STATUSES.includes(c.status) ? c.status : 'inconnu',
  }));
  const incidents = (r.incidents ?? [])
    .filter((i) => ACTIVE_INCIDENT.has(i.state))
    .map((i) => ({
      title: i.title,
      status: i.state,
      impact: i.impact ?? null,
      startedAt: i.createdAt ?? null,
      updatedAt: i.updatedAt ?? null,
      url: i.url ?? null,
      components: i.components ?? [],
    }));
  const maintenances = (r.maintenances ?? []).map((m) => ({
    title: m.title,
    state: m.state,
    scheduledFor: m.scheduledFor ?? null,
    scheduledUntil: m.scheduledUntil ?? null,
    url: m.url ?? null,
  }));
  const status = r.collect.state === 'error' ? 'inconnu' : (STATUSES.includes(r.status) ? r.status : 'inconnu');
  const out = {
    ...base,
    status,
    reason: '',
    sourceText: r.rawStatus ?? null,
    collectedAt: r.collectedAt,
    collect: { state: r.collect.state, method: p.source.kind, error: r.collect.error ?? null },
    components,
    incidents,
    maintenances,
  };
  out.reason = reasonFor(out);
  return out;
}

export function buildOutput(providers, settled, now) {
  const out = providers.map((p, i) => buildProvider(p, settled[i]));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const p of out) counts[p.status] += 1;
  return {
    schemaVersion: 2,
    generatedAt: now,
    labels: STATUS_LABELS,
    summary: {
      // worst ignore « inconnu » : le bandeau l'affiche à part, en compteur
      worst: worstOf(out.map((p) => p.status).filter((s) => s !== 'inconnu')),
      counts,
      activeIncidents: out.reduce((n, p) => n + p.incidents.length, 0),
      activeMaintenances: out.reduce((n, p) => n + p.maintenances.filter((m) => m.state !== 'scheduled').length, 0),
    },
    providers: out,
  };
}
