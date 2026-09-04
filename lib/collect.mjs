// Assemblage du contrat v2 de public/data/status.json à partir des résultats
// d'adaptateurs. Pur : pas de réseau, pas de fichier, testable sur fixtures.
import { classifyKind, worstOf, STATUS_LABELS, STATUS_LABELS_EN, STATUSES } from './normalize.mjs';

const ACTIVE_INCIDENT = new Set(['investigating', 'identified', 'monitoring', 'en cours']);

// Groupes d'affichage fixes : libellés et ordre côté page (public/app.js), ids validés ici
export const GROUPS = ['us', 'eu', 'cn', 'cloud'];

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

// Phrase courte expliquant le statut, sans texte brut de la source. Deux langues,
// même logique : la page choisit reason (fr) ou reasonEn sans recalculer
const WORDS = {
  fr: {
    notRead: 'source non lue', noIncident: 'aucun incident déclaré', undetermined: 'état non déterminé',
    component: ['composant', 'composants'], tracked: ['composant suivi, aucune alerte', 'composants suivis, aucune alerte'],
    unreadable: ["composant à l'état illisible", "composants à l'état illisible"],
    maintenance: ['maintenance en cours', 'maintenances en cours'], incident: ['incident en cours', 'incidents en cours'],
    inState: (n, status) => `${n} ${WORDS.fr.component[n > 1 ? 1 : 0]} en ${STATUS_LABELS[status].toLowerCase()}`,
    labels: STATUS_LABELS,
  },
  en: {
    notRead: 'source not read', noIncident: 'no incident reported', undetermined: 'state not determined',
    component: ['component', 'components'], tracked: ['component tracked, no alert', 'components tracked, no alert'],
    unreadable: ['component with unreadable state', 'components with unreadable state'],
    maintenance: ['maintenance in progress', 'maintenances in progress'], incident: ['incident in progress', 'incidents in progress'],
    inState: (n, status) => `${n} ${WORDS.en.component[n > 1 ? 1 : 0]} ${WORDS.en.labels[status].toLowerCase()}`,
    labels: STATUS_LABELS_EN,
  },
};

function pluralize(n, forms) {
  return `${n} ${forms[n > 1 ? 1 : 0]}`;
}

export function reasonFor(p, lang = 'fr') {
  const w = WORDS[lang];
  if (p.collect.state === 'error') return w.notRead;
  const alert = p.components.filter((c) => c.status !== 'operationnel' && c.status !== 'inconnu');
  const unknown = p.components.filter((c) => c.status === 'inconnu');
  const inProgress = p.maintenances.filter((m) => m.state === 'in_progress' || m.state === 'verifying');
  if (p.status === 'operationnel') return p.components.length ? pluralize(p.components.length, w.tracked) : w.noIncident;
  if (p.status === 'inconnu') return unknown.length ? pluralize(unknown.length, w.unreadable) : w.undetermined;
  if (p.status === 'maintenance' && inProgress.length) return pluralize(inProgress.length, w.maintenance);
  if (alert.length) return w.inState(alert.length, p.status);
  if (p.incidents.length) return pluralize(p.incidents.length, w.incident);
  return w.labels[p.status];
}

export function buildProvider(p, settledResult) {
  const base = { id: p.id, name: p.name, group: p.group ?? null, scope: p.scope ?? null, scopeEn: p.scopeEn ?? null, statusUrl: p.statusUrl };
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
    reasonEn: '',
    sourceText: r.rawStatus ?? null,
    collectedAt: r.collectedAt,
    collect: { state: r.collect.state, method: p.source.kind, error: r.collect.error ?? null, errorEn: r.collect.errorEn ?? null },
    components,
    incidents,
    maintenances,
  };
  out.reason = reasonFor(out, 'fr');
  out.reasonEn = reasonFor(out, 'en');
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
    labelsEn: STATUS_LABELS_EN,
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
