// Contrat v2 partagé par le collecteur, la CI et le navigateur
export const STATUS_VALUES = Object.freeze(['operationnel', 'maintenance', 'degradation', 'incident_majeur', 'indisponible', 'inconnu']);
export const MAX_STATUS_BYTES = 10 * 1024 * 1024;

// ponytail: bornes de publication généreuses ; ne les relever qu'après une mesure légitime
export const STATUS_LIMITS = Object.freeze({ providers: 100, providerBytes: 96 * 1024, components: 5_000, events: 1_000, eventComponents: 5_000, string: 65_536 });

const REAL_SEVERITY = STATUS_VALUES.filter((status) => status !== 'inconnu');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value, { empty = true } = {}) =>
  typeof value === 'string' && value.length <= STATUS_LIMITS.string && (empty || value.length > 0);
const isStringOrNull = (value) => value === null || isString(value);
const isOptionalString = (value) => value === undefined || isStringOrNull(value);
const isDate = (value) => isString(value, { empty: false }) && Number.isFinite(Date.parse(value));
const isDateOrNull = (value) => value === null || isDate(value);
const isList = (value, limit) => Array.isArray(value) && value.length <= limit;

function basicHttpsUrl(value) {
  if (!isString(value, { empty: false })) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

// Les liens de détail restent sur l'origine officielle ; Statuspage utilise aussi stspg.io
export function safeExternalUrl(value, statusUrl, method) {
  const url = basicHttpsUrl(value);
  const official = basicHttpsUrl(statusUrl);
  if (!url || !official) return null;
  if (url.origin !== official.origin && !(method === 'statuspage' && url.origin === 'https://stspg.io')) return null;
  return url.href;
}

function validProvider(provider) {
  try {
    if (new TextEncoder().encode(JSON.stringify(provider)).byteLength > STATUS_LIMITS.providerBytes) return false;
  } catch {
    return false;
  }
  if (!isObject(provider) || !['id', 'name', 'status', 'reason', 'collectedAt'].every((key) => isString(provider[key], { empty: false }))) return false;
  if (!basicHttpsUrl(provider.statusUrl) || !STATUS_VALUES.includes(provider.status) || !isDate(provider.collectedAt)) return false;
  if (![provider.group, provider.scope, provider.sourceText].every(isStringOrNull)) return false;
  if (![provider.scopeEn, provider.reasonEn].every(isOptionalString)) return false;
  if (!isObject(provider.collect) || !['ok', 'error'].includes(provider.collect.state) || !isString(provider.collect.method, { empty: false })) return false;
  if (!isStringOrNull(provider.collect.error) || ![provider.collect.errorEn, provider.collect.methodLabel, provider.collect.methodLabelEn].every(isOptionalString)) return false;
  if (provider.collect.state === 'error' && (provider.status !== 'inconnu' || !isString(provider.collect.error, { empty: false }))) return false;
  if (!isList(provider.components, STATUS_LIMITS.components) || !isList(provider.incidents, STATUS_LIMITS.events) || !isList(provider.maintenances, STATUS_LIMITS.events)) return false;
  if (!provider.components.every((component) =>
    isObject(component) && isString(component.name, { empty: false }) && ['model', 'service'].includes(component.kind) && STATUS_VALUES.includes(component.status)
  )) return false;
  if (!provider.incidents.every((incident) =>
    isObject(incident)
      && isString(incident.title, { empty: false })
      && isString(incident.status, { empty: false })
      && [incident.impact, incident.url].every(isStringOrNull)
      && (incident.url === null || safeExternalUrl(incident.url, provider.statusUrl, provider.collect.method) === incident.url)
      && [incident.startedAt, incident.updatedAt].every(isDateOrNull)
      && isList(incident.components, STATUS_LIMITS.eventComponents)
      && incident.components.every((name) => isString(name, { empty: false }))
  )) return false;
  if (!provider.maintenances.every((maintenance) =>
    isObject(maintenance)
      && isString(maintenance.title, { empty: false })
      && isString(maintenance.state, { empty: false })
      && [maintenance.scheduledFor, maintenance.scheduledUntil].every(isDateOrNull)
      && isStringOrNull(maintenance.url)
      && (maintenance.url === null || safeExternalUrl(maintenance.url, provider.statusUrl, provider.collect.method) === maintenance.url)
  )) return false;
  return provider.collect.state !== 'error' || (provider.components.length === 0 && provider.incidents.length === 0 && provider.maintenances.length === 0);
}

export function validateStatusDocument(doc, expectedProviders = null) {
  try {
    if (new TextEncoder().encode(JSON.stringify(doc)).byteLength + 1 > MAX_STATUS_BYTES) return false;
  } catch {
    return false;
  }
  if (!isObject(doc) || doc.schemaVersion !== 2 || !isDate(doc.generatedAt)) return false;
  if (!isObject(doc.summary) || !STATUS_VALUES.includes(doc.summary.worst) || !isObject(doc.summary.counts)) return false;
  if (!['activeIncidents', 'activeMaintenances'].every((key) => Number.isInteger(doc.summary[key]) && doc.summary[key] >= 0)) return false;
  if (!STATUS_VALUES.every((status) => Number.isInteger(doc.summary.counts[status]) && doc.summary.counts[status] >= 0)) return false;
  for (const key of ['labels', 'labelsEn']) {
    if (doc[key] != null && (!isObject(doc[key]) || !STATUS_VALUES.every((status) => isString(doc[key][status], { empty: false })))) return false;
  }
  if (!isList(doc.providers, STATUS_LIMITS.providers) || doc.providers.length === 0 || !doc.providers.every(validProvider)) return false;
  if (new Set(doc.providers.map((provider) => provider.id)).size !== doc.providers.length) return false;

  if (expectedProviders) {
    if (!Array.isArray(expectedProviders) || expectedProviders.length !== doc.providers.length) return false;
    const identity = ['id', 'name', 'group', 'scope', 'scopeEn', 'statusUrl'];
    if (expectedProviders.some((expected, index) => identity.some((key) => (expected[key] ?? null) !== (doc.providers[index][key] ?? null)))) return false;
    if (expectedProviders.some((expected, index) => expected.source?.kind !== doc.providers[index].collect.method)) return false;
  }

  const counts = Object.fromEntries(STATUS_VALUES.map((status) => [status, 0]));
  for (const provider of doc.providers) counts[provider.status] += 1;
  if (STATUS_VALUES.some((status) => counts[status] !== doc.summary.counts[status])) return false;
  const worst = doc.providers
    .map((provider) => provider.status)
    .filter((status) => status !== 'inconnu')
    .reduce((current, status) => REAL_SEVERITY.indexOf(status) > REAL_SEVERITY.indexOf(current) ? status : current, 'operationnel');
  if (doc.summary.worst !== worst) return false;
  if (doc.summary.activeIncidents !== doc.providers.reduce((total, provider) => total + provider.incidents.length, 0)) return false;
  return doc.summary.activeMaintenances === doc.providers.reduce(
    (total, provider) => total + provider.maintenances.filter((maintenance) => maintenance.state !== 'scheduled').length,
    0,
  );
}

export function assertStatusDocument(doc, expectedProviders = null) {
  if (!validateStatusDocument(doc, expectedProviders)) throw new Error('contrat status.json invalide');
  return doc;
}
