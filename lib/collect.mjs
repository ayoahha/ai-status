// Runner et assemblage du contrat v2 de public/data/status.json.
// Runner : exécute chaque adaptateur en isolant les échecs (réseau, timeout, HTTP,
// schéma) ; c'est le seul endroit qui transforme un échec en état « inconnu ».
// Assemblage : pur, pas de réseau, pas de fichier, testable sur fixtures
import { classifyKind, worstOf, STATUS_LABELS, STATUS_LABELS_EN, STATUSES } from './normalize.mjs';
import { fail, classify } from './errors.mjs';
import { safeExternalUrl, STATUS_LIMITS, validateStatusDocument } from '../public/status-contract.js';

const ACTIVE_INCIDENT = new Set(['investigating', 'identified', 'monitoring', 'en cours']);

// Groupes d'affichage fixes : libellés et ordre côté page (public/app.js), ids validés ici
export const GROUPS = ['us', 'eu', 'cn', 'cloud'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const schema = (field) => { throw fail('schema', `résultat adaptateur (${field})`); };
const text = (value, field, { optional = false, empty = false } = {}) => {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || (!empty && value.length === 0) || value.length > STATUS_LIMITS.string) schema(field);
  return value;
};
const date = (value, field) => {
  if (value == null) return null;
  text(value, field);
  if (!Number.isFinite(Date.parse(value))) schema(field);
  return new Date(value).toISOString();
};
const list = (value, field, limit, { optional = false } = {}) => {
  if (value == null && optional) return [];
  if (!Array.isArray(value) || value.length > limit) schema(field);
  return value;
};

function normalizeAdapterResult(provider, raw) {
  if (!isObject(raw)) schema('objet attendu');
  const indicator = raw.indicator ?? null;
  if (indicator !== null && !STATUSES.includes(indicator)) schema('indicator');
  const components = list(raw.components, 'components', STATUS_LIMITS.components).map((component) => {
    if (!isObject(component) || !STATUSES.includes(component.status)) schema('components[]');
    return { name: text(component.name, 'components[].name'), status: component.status };
  });
  if (indicator === null && components.length === 0) schema("aucune preuve d'état");

  const incidents = list(raw.incidents, 'incidents', STATUS_LIMITS.events, { optional: true }).map((incident) => {
    if (!isObject(incident)) schema('incidents[]');
    return {
      title: text(incident.title, 'incidents[].title'),
      state: text(incident.state, 'incidents[].state'),
      impact: text(incident.impact, 'incidents[].impact', { optional: true, empty: true }),
      createdAt: date(incident.createdAt, 'incidents[].createdAt'),
      updatedAt: date(incident.updatedAt, 'incidents[].updatedAt'),
      url: incident.url == null ? null : safeExternalUrl(text(incident.url, 'incidents[].url', { empty: true }), provider.statusUrl, provider.source.kind),
      components: list(incident.components, 'incidents[].components', STATUS_LIMITS.eventComponents, { optional: true })
        .map((name) => text(name, 'incidents[].components[]')),
    };
  });
  const maintenances = list(raw.maintenances, 'maintenances', STATUS_LIMITS.events, { optional: true }).map((maintenance) => {
    if (!isObject(maintenance)) schema('maintenances[]');
    return {
      title: text(maintenance.title, 'maintenances[].title'),
      state: text(maintenance.state, 'maintenances[].state'),
      scheduledFor: date(maintenance.scheduledFor, 'maintenances[].scheduledFor'),
      scheduledUntil: date(maintenance.scheduledUntil, 'maintenances[].scheduledUntil'),
      url: maintenance.url == null ? null : safeExternalUrl(text(maintenance.url, 'maintenances[].url', { empty: true }), provider.statusUrl, provider.source.kind),
    };
  });
  return {
    indicator,
    rawStatus: text(raw.rawStatus, 'rawStatus', { optional: true, empty: true }),
    components,
    incidents,
    maintenances,
    note: text(raw.note, 'note', { optional: true, empty: true }),
    noteEn: text(raw.noteEn, 'noteEn', { optional: true, empty: true }),
  };
}

// Lance chaque adaptateur avec le client `get` : un throw devient un rejet capturé
// par allSettled, jamais un plantage de toute la collecte. `adapters` : famille de
// source → module exposant collect(provider, get)
export async function collectAll(providers, adapters, get) {
  return Promise.allSettled(
    providers.map((p) =>
      Promise.resolve().then(() => {
        const adapter = adapters[p.source.kind];
        if (!adapter) throw fail('unknown_kind', p.source.kind);
        const providerGet = (url, options = {}) => get(url, {
          ...options,
          maxBytes: p.source.maxResponseBytes,
          redirectOrigins: p.source.redirectOrigins,
        });
        return adapter.collect(p, providerGet);
      }).then((r) => ({ ...normalizeAdapterResult(p, r), collectedAt: new Date().toISOString() }))
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
    sep: ' : ',
    errors: {
      timeout: 'délai dépassé', http: 'réponse HTTP', network: 'erreur réseau', schema: 'schéma inattendu',
      scope: 'périmètre absent de la source', policy: 'destination refusée', limit: 'réponse trop volumineuse',
      browser: 'erreur navigateur', unknown_kind: 'adaptateur inconnu', unavailable: 'source indisponible',
    },
  },
  en: {
    notRead: 'source not read', noIncident: 'no incident reported', undetermined: 'state not determined',
    component: ['component', 'components'], tracked: ['component tracked, no alert', 'components tracked, no alert'],
    unreadable: ['component with unreadable state', 'components with unreadable state'],
    maintenance: ['maintenance in progress', 'maintenances in progress'], incident: ['incident in progress', 'incidents in progress'],
    inState: (n, status) => `${n} ${WORDS.en.component[n > 1 ? 1 : 0]} ${WORDS.en.labels[status].toLowerCase()}`,
    labels: STATUS_LABELS_EN,
    sep: ': ',
    errors: {
      timeout: 'timed out', http: 'HTTP response', network: 'network error', schema: 'unexpected schema',
      scope: 'scope missing from source', policy: 'destination rejected', limit: 'response too large',
      browser: 'browser error', unknown_kind: 'unknown adapter', unavailable: 'source unavailable',
    },
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

// Texte d'échec : mot du code + détail. Source injoignable : sa note remplace le mot
export function errorText(failure, lang = 'fr') {
  const w = WORDS[lang];
  const word = w.errors[failure.kind] ?? failure.kind;
  const detail = lang === 'en' ? failure.detailEn ?? failure.detail : failure.detail;
  const value = failure.kind === 'unavailable' ? detail ?? word : detail ? `${word}${w.sep}${detail}` : word;
  const string = String(value);
  return string.length <= STATUS_LIMITS.string ? string : `${string.slice(0, STATUS_LIMITS.string - 1)}…`;
}

export function buildProvider(p, settledResult, adapter = null) {
  const base = { id: p.id, name: p.name, group: p.group ?? null, scope: p.scope ?? null, scopeEn: p.scopeEn ?? null, statusUrl: p.statusUrl };
  const failure = settledResult.status === 'rejected' ? classify(settledResult.reason) : null;
  const r = failure ? { collectedAt: new Date().toISOString() } : settledResult.value;
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
  // Statut fournisseur = pire de l'indicateur de page (ignoré si la source n'en publie
  // pas), des composants et d'une maintenance en cours. Un composant « inconnu »
  // interdit « operationnel » (règle de worstOf) ; un échec force « inconnu »
  const inProgress = maintenances.some((m) => m.state === 'in_progress' || m.state === 'verifying');
  const indicator = r.indicator == null ? [] : [STATUSES.includes(r.indicator) ? r.indicator : 'inconnu'];
  const status = failure ? 'inconnu' : worstOf([...indicator, ...components.map((c) => c.status), ...(inProgress ? ['maintenance'] : [])]);
  // Libellé de la famille de source, porté par l'adaptateur ; null sans adaptateur (la page replie sur l'id)
  const method = { method: p.source.kind, methodLabel: adapter?.METHOD?.fr ?? null, methodLabelEn: adapter?.METHOD?.en ?? null };
  const collect = failure
    ? { state: 'error', ...method, error: errorText(failure, 'fr'), errorEn: errorText(failure, 'en') }
    : { state: 'ok', ...method, error: r.note ?? null, errorEn: r.noteEn ?? null };
  const out = {
    ...base,
    status,
    reason: '',
    reasonEn: '',
    sourceText: r.rawStatus ?? null,
    collectedAt: r.collectedAt,
    collect,
    components,
    incidents,
    maintenances,
  };
  out.reason = reasonFor(out, 'fr');
  out.reasonEn = reasonFor(out, 'en');
  return out;
}

export function buildOutput(providers, settled, now, adapters = {}) {
  const out = providers.map((p, i) => buildProvider(p, settled[i], adapters[p.source.kind] ?? null));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const p of out) counts[p.status] += 1;
  const doc = {
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
  if (!validateStatusDocument(doc, providers)) throw fail('schema', 'status.json');
  return doc;
}
