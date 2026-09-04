// Lecture de data/status.json (contrat v2, généré par la collecte GitHub Actions).
// Tout texte externe est inséré via textContent (pas d'innerHTML) → aucun contenu
// externe exécuté ou interprété comme instructions
const FRESHNESS_MS = 60 * 1000;
const REFRESH_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const STALE_MS = 2 * 60 * 60 * 1000; // 4 cadences de collecte ratées
const SEVERITY_ORDER = ['indisponible', 'incident_majeur', 'degradation', 'maintenance', 'inconnu', 'operationnel'];
// Groupes d'affichage : ordre et libellés ; un groupe absent du contrat tombe dans « Autres ».
// Un groupe avec `empty` est affiché même sans fournisseur, avec ce texte
const GROUPS = [
  { id: 'us', label: 'Fournisseurs USA' },
  { id: 'eu', label: 'Fournisseurs Europe', empty: 'Aucune source suivie pour l’instant.' },
  { id: 'cn', label: 'Fournisseurs Chine' },
  { id: 'cloud', label: 'Clouds d’inférence et API' },
  { id: 'other', label: 'Autres' },
];
const METHOD_LABELS = {
  statuspage: 'API Statuspage',
  google: 'flux JSON Google Cloud',
  flashcat: 'API Flashcat',
  browser: 'navigateur headless',
  alibaba: 'API Alibaba Cloud',
  unavailable: 'aucune requête',
};
const INCIDENT_STATE_LABELS = {
  investigating: 'en investigation',
  identified: 'cause identifiée',
  monitoring: 'sous surveillance',
  'en cours': 'en cours',
  in_progress: 'en cours',
  verifying: 'en vérification',
  scheduled: 'planifiée',
};
const FALLBACK_LABELS = {
  operationnel: 'Opérationnel',
  degradation: 'Dégradation',
  incident_majeur: 'Incident majeur',
  maintenance: 'Maintenance',
  indisponible: 'Indisponible',
  inconnu: 'Non vérifié',
};

let data = null;
let labels = FALLBACK_LABELS;
let filter = 'all';
let query = '';
let sortMode = 'severity';
let refreshing = false;
let lastAttemptAt = 0;
let lastRefreshAt = null;
let refreshTimer;

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};
const label = (status) => labels[status] ?? FALLBACK_LABELS[status] ?? status;
const severity = (status) => {
  const i = SEVERITY_ORDER.indexOf(status);
  return i === -1 ? SEVERITY_ORDER.length : i;
};
// État réel = ni opérationnel ni non vérifié : c'est ce qui compte comme alerte
const isAlert = (status) => status !== 'operationnel' && status !== 'inconnu';
// Titres de sources en chinois ou en anglais : lang posé pour les lecteurs d'écran
const langOf = (text) => (/[㐀-鿿]/.test(text) ? 'zh' : 'en');

function icon(status) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ic s-${status}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#ic-${status}`);
  svg.appendChild(use);
  return svg;
}

function ageLabel(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = ms / 3600000;
  if (h < 48) return `il y a ${h < 10 ? h.toFixed(1).replace('.0', '') : Math.round(h)} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

// Âge relatif rafraîchi chaque minute par renderFreshness via data-age
function ageSpan(iso) {
  const s = el('span', null, ageLabel(iso) ?? '');
  s.dataset.age = iso;
  s.title = fmtDate(iso);
  return s;
}

function sortedProviders() {
  const list = [...(data?.providers ?? [])];
  list.sort((a, b) =>
    sortMode === 'name'
      ? a.name.localeCompare(b.name, 'fr')
      : severity(a.status) - severity(b.status) || a.name.localeCompare(b.name, 'fr')
  );
  return list;
}

// Bandeau : pire état réel + compteurs cliquables (les « non vérifiés » ont toujours leur compteur)
function renderSummary() {
  const s = data.summary;
  const overall = $('overall');
  overall.textContent = '';
  overall.appendChild(icon(s.worst));
  const unknown = s.counts.inconnu ?? 0;
  const text = s.worst === 'operationnel'
    ? (unknown ? 'Aucun incident déclaré' : 'Tous les fournisseurs sont opérationnels')
    : `${label(s.worst)} chez ${countWord(data.providers.filter((p) => p.status === s.worst).length, 'fournisseur')}`;
  overall.appendChild(el('span', null, text));
  if (unknown) overall.appendChild(el('span', 'overall-unknown', ` · ${countWord(unknown, 'source')} non vérifiée${unknown > 1 ? 's' : ''}`));

  const counts = $('counts');
  counts.textContent = '';
  const all = countButton('all', 'Tous', data.providers.length);
  counts.appendChild(all);
  for (const status of SEVERITY_ORDER) {
    const n = s.counts[status] ?? 0;
    if (n > 0) counts.appendChild(countButton(status, label(status), n));
  }
}

function countWord(n, word) {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function countButton(status, text, n) {
  const b = el('button', `chip s-${status}`);
  b.type = 'button';
  b.dataset.status = status;
  b.setAttribute('aria-pressed', String(filter === status));
  if (status !== 'all') b.appendChild(icon(status));
  b.appendChild(el('span', null, `${text} `));
  b.appendChild(el('span', 'count', String(n)));
  b.addEventListener('click', () => {
    filter = filter === status ? 'all' : status;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.status === filter)));
    renderSections();
  });
  return b;
}

function renderFreshness() {
  if (!data) return;
  const at = $('collected-at');
  const refreshedAt = lastRefreshAt ?? data.generatedAt;
  const refreshAge = ageLabel(refreshedAt);
  const collectionAge = ageLabel(data.generatedAt);
  at.textContent = `Actualisé ${fmtDate(refreshedAt)}${refreshAge ? ` (${refreshAge})` : ''} · collecte ${fmtDate(data.generatedAt)}${collectionAge ? ` (${collectionAge})` : ''}`;
  const stale = Date.now() - new Date(data.generatedAt).getTime() > STALE_MS;
  const banner = $('stale');
  banner.hidden = !stale;
  banner.textContent = stale
    ? `Données obsolètes : dernière collecte ${collectionAge}. Les états affichés ne reflètent peut-être plus la situation actuelle.`
    : '';
  document.querySelectorAll('[data-age]').forEach((e) => {
    e.textContent = ageLabel(e.dataset.age) ?? '';
  });
}

// Section « En cours » : états réels seulement ; les « non vérifiés » ont le bandeau et leur carte
function renderOngoing() {
  const list = $('ongoing-list');
  list.textContent = '';
  const items = [];
  for (const p of sortedProviders()) {
    if (!isAlert(p.status)) continue;
    const li = el('li', `ongoing-item s-${p.status}`);
    li.appendChild(icon(p.status));
    const body = el('div', 'ongoing-body');
    const head = el('p', 'ongoing-head');
    const a = el('a', 'ongoing-provider', p.name);
    a.href = `#${p.id}`;
    head.appendChild(a);
    head.appendChild(el('span', 'ongoing-status', ` · ${label(p.status)} · ${p.reason}`));
    body.appendChild(head);
    const alerted = p.components.filter((c) => c.status !== 'operationnel');
    if (alerted.length) body.appendChild(el('p', 'ongoing-comps', alerted.map((c) => c.name).join(', ')));
    for (const inc of p.incidents) body.appendChild(incidentLine(inc));
    for (const m of p.maintenances.filter((m) => m.state !== 'scheduled')) body.appendChild(maintenanceLine(m));
    li.appendChild(body);
    items.push(li);
  }
  $('ongoing').hidden = items.length === 0;
  for (const li of items) list.appendChild(li);
}

function externalLink(href, text, className) {
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function incidentLine(inc) {
  const p = el('p', 'incident');
  const t = el('span', 'incident-title', inc.title);
  t.lang = langOf(inc.title);
  p.appendChild(t);
  const meta = [INCIDENT_STATE_LABELS[inc.status] ?? inc.status];
  if (inc.startedAt) meta.push(`depuis ${fmtDate(inc.startedAt)}`);
  if (inc.components?.length) meta.push(inc.components.join(', '));
  p.appendChild(el('span', 'incident-meta', ` · ${meta.join(' · ')}`));
  if (inc.url) {
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(externalLink(inc.url, 'détail', 'incident-link'));
  }
  return p;
}

function maintenanceLine(m) {
  const p = el('p', 'incident maintenance');
  const t = el('span', 'incident-title', m.title);
  t.lang = langOf(m.title);
  p.appendChild(t);
  const meta = [`maintenance ${INCIDENT_STATE_LABELS[m.state] ?? m.state}`];
  if (m.scheduledFor) meta.push(`${m.state === 'scheduled' ? 'prévue' : 'depuis'} ${fmtDate(m.scheduledFor)}`);
  if (m.scheduledUntil) meta.push(`jusqu’à ${fmtDate(m.scheduledUntil)}`);
  p.appendChild(el('span', 'incident-meta', ` · ${meta.join(' · ')}`));
  if (m.url) {
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(externalLink(m.url, 'détail', 'incident-link'));
  }
  return p;
}

function componentList(title, comps) {
  const frag = document.createDocumentFragment();
  frag.appendChild(el('h4', 'sub', `${title} (${comps.length})`));
  const ul = el('ul', 'complist');
  const sorted = [...comps].sort((a, b) => severity(a.status) - severity(b.status) || a.name.localeCompare(b.name, 'fr'));
  for (const c of sorted) {
    const li = el('li', `comp s-${c.status}`);
    li.appendChild(icon(c.status));
    const name = el('span', 'comp-name', c.name);
    name.lang = langOf(c.name);
    li.appendChild(name);
    li.appendChild(el('span', 'comp-status', label(c.status)));
    ul.appendChild(li);
  }
  frag.appendChild(ul);
  return frag;
}

// Ligne compacte, sans élément interactif dans <summary> : icône, nom (h3), état,
// nombre de composants, raison hors opérationnel. L'état est toujours annoncé aux
// lecteurs d'écran, visible seulement quand il n'est pas « opérationnel »
function cardSummary(p) {
  const summary = el('summary', 'card-line');
  summary.appendChild(icon(p.status));
  const head = el('div', 'card-head');
  head.appendChild(el('h3', 'card-name', p.name));
  if (p.scope) head.appendChild(el('p', 'card-scope', p.scope));
  summary.appendChild(head);
  if (p.components.length) summary.appendChild(el('span', 'card-count', countWord(p.components.length, 'composant')));
  summary.appendChild(el('span', 'card-state', label(p.status)));
  if (p.status !== 'operationnel') summary.appendChild(el('p', 'card-reason', p.reason));
  return summary;
}

// Contenu déplié : tout ce que la carte fermée ne montre pas, lien officiel compris
function cardBody(p) {
  const body = el('div', 'card-body');
  if (p.collect.state === 'error') body.appendChild(el('p', 'err', p.collect.error));
  if (p.incidents.length) {
    body.appendChild(el('h4', 'sub', 'Incidents'));
    for (const inc of p.incidents) body.appendChild(incidentLine(inc));
  }
  if (p.maintenances.length) {
    body.appendChild(el('h4', 'sub', 'Maintenances'));
    for (const m of p.maintenances) body.appendChild(maintenanceLine(m));
  }
  const models = p.components.filter((c) => c.kind === 'model');
  const services = p.components.filter((c) => c.kind !== 'model');
  if (models.length) body.appendChild(componentList('Modèles', models));
  if (services.length) body.appendChild(componentList(models.length ? 'Services' : 'Composants', services));
  const meta = el('p', 'meta');
  meta.appendChild(document.createTextNode(`Lu via ${METHOD_LABELS[p.collect.method] ?? p.collect.method} · `));
  meta.appendChild(ageSpan(p.collectedAt));
  meta.appendChild(document.createTextNode(' · '));
  meta.appendChild(externalLink(p.statusUrl, 'page officielle'));
  body.appendChild(meta);
  return body;
}

function makeCard(p) {
  const card = el('article', `card s-${p.status}`);
  card.id = p.id;
  card.dataset.status = p.status;
  const details = el('details');
  details.appendChild(cardSummary(p));
  details.appendChild(cardBody(p));
  card.appendChild(details);
  return card;
}

function matches(p, q) {
  if (!q) return true;
  if (p.name.toLowerCase().includes(q)) return true;
  if (p.components.some((c) => c.name.toLowerCase().includes(q))) return true;
  return p.incidents.some((i) => i.title.toLowerCase().includes(q));
}

function groupMeta(list) {
  const parts = [countWord(list.length, 'fournisseur')];
  const alerts = list.filter((p) => isAlert(p.status)).length;
  const unknown = list.filter((p) => p.status === 'inconnu').length;
  if (alerts) parts.push(`${alerts} en alerte`);
  if (unknown) parts.push(`${unknown} non vérifié${unknown > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

// Une section par groupe, dans l'ordre de GROUPS ; le tri choisi est conservé dans chaque section
function renderSections() {
  const main = $('providers');
  main.textContent = '';
  const q = query.trim().toLowerCase();
  const visible = sortedProviders().filter((p) => (filter === 'all' || p.status === filter) && matches(p, q));
  $('result-count').textContent = visible.length === data.providers.length
    ? ''
    : `${countWord(visible.length, 'fournisseur')} sur ${data.providers.length}`;
  if (visible.length === 0) {
    main.appendChild(el('p', 'noresults', 'Aucun fournisseur ne correspond.'));
    return;
  }
  const known = new Set(GROUPS.map((g) => g.id));
  const unfiltered = filter === 'all' && !q;
  for (const g of GROUPS) {
    const list = visible.filter((p) => (known.has(p.group) ? p.group : 'other') === g.id);
    if (!list.length && !(g.empty && unfiltered)) continue;
    const section = el('section', 'group');
    section.setAttribute('aria-labelledby', `g-${g.id}`);
    const head = el('div', 'group-head');
    const h = el('h2', 'group-title', g.label);
    h.id = `g-${g.id}`;
    head.appendChild(h);
    if (list.length) head.appendChild(el('p', 'group-meta', groupMeta(list)));
    section.appendChild(head);
    if (list.length) {
      const grid = el('div', 'grid');
      for (const p of list) grid.appendChild(makeCard(p));
      section.appendChild(grid);
    } else {
      section.appendChild(el('p', 'group-empty', g.empty));
    }
    main.appendChild(section);
  }
}

function renderAll() {
  labels = data.labels ?? FALLBACK_LABELS;
  renderSummary();
  renderOngoing();
  renderSections();
  renderFreshness();
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringOrNull = (value) => value === null || typeof value === 'string';
const isValidDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const hasStrings = (value, keys) => isObject(value) && keys.every((key) => typeof value[key] === 'string');

function validateData(doc) {
  if (!isObject(doc) || doc.schemaVersion !== 2 || !isValidDate(doc.generatedAt)) return false;
  if (!isObject(doc.summary) || !SEVERITY_ORDER.includes(doc.summary.worst) || !isObject(doc.summary.counts)) return false;
  if (!['activeIncidents', 'activeMaintenances'].every((key) => Number.isInteger(doc.summary[key]) && doc.summary[key] >= 0)) return false;
  if (!SEVERITY_ORDER.every((status) => Number.isInteger(doc.summary.counts[status]) && doc.summary.counts[status] >= 0)) return false;
  if (doc.labels != null && (!isObject(doc.labels) || !SEVERITY_ORDER.every((status) => typeof doc.labels[status] === 'string'))) return false;
  if (!Array.isArray(doc.providers) || doc.providers.length === 0) return false;

  const validProviders = doc.providers.every((provider) => {
    if (!hasStrings(provider, ['id', 'name', 'statusUrl', 'status', 'reason', 'collectedAt'])) return false;
    if (!SEVERITY_ORDER.includes(provider.status) || !isValidDate(provider.collectedAt)) return false;
    if (!isStringOrNull(provider.group) || !isStringOrNull(provider.scope) || !isStringOrNull(provider.sourceText)) return false;
    if (!isObject(provider.collect) || !['ok', 'error'].includes(provider.collect.state) || typeof provider.collect.method !== 'string' || !isStringOrNull(provider.collect.error)) return false;
    if (provider.collect.state === 'error' && (provider.status !== 'inconnu' || typeof provider.collect.error !== 'string')) return false;
    if (![provider.components, provider.incidents, provider.maintenances].every(Array.isArray)) return false;
    if (!provider.components.every((component) => hasStrings(component, ['name', 'kind', 'status']) && ['model', 'service'].includes(component.kind) && SEVERITY_ORDER.includes(component.status))) return false;
    if (!provider.incidents.every((incident) => hasStrings(incident, ['title', 'status']) && Array.isArray(incident.components) && incident.components.every((name) => typeof name === 'string') && ['impact', 'startedAt', 'updatedAt', 'url'].every((key) => isStringOrNull(incident[key])))) return false;
    return provider.maintenances.every((maintenance) => hasStrings(maintenance, ['title', 'state']) && ['scheduledFor', 'scheduledUntil', 'url'].every((key) => isStringOrNull(maintenance[key])));
  });
  if (!validProviders || new Set(doc.providers.map((provider) => provider.id)).size !== doc.providers.length) return false;

  const counts = Object.fromEntries(SEVERITY_ORDER.map((status) => [status, 0]));
  for (const provider of doc.providers) counts[provider.status] += 1;
  if (SEVERITY_ORDER.some((status) => counts[status] !== doc.summary.counts[status])) return false;
  const worst = [...doc.providers]
    .map((provider) => provider.status)
    .filter((status) => status !== 'inconnu')
    .sort((a, b) => severity(a) - severity(b))[0] ?? 'operationnel';
  if (doc.summary.worst !== worst) return false;
  if (doc.summary.activeIncidents !== doc.providers.reduce((total, provider) => total + provider.incidents.length, 0)) return false;
  return doc.summary.activeMaintenances === doc.providers.reduce((total, provider) => total + provider.maintenances.filter((maintenance) => maintenance.state !== 'scheduled').length, 0);
}

function resetUnavailable() {
  data = null;
  labels = FALLBACK_LABELS;
  $('overall').textContent = 'Données indisponibles';
  $('collected-at').textContent = 'Impossible de charger les données.';
  $('counts').textContent = '';
  $('ongoing').hidden = true;
  $('ongoing-list').textContent = '';
  $('providers').textContent = '';
  $('result-count').textContent = '';
  $('stale').hidden = true;
  $('stale').textContent = '';
}

async function refreshData(source) {
  if (refreshing) return;
  refreshing = true;
  lastAttemptAt = Date.now();
  scheduleRefresh(REFRESH_MS);
  const button = $('refresh');
  const status = $('refresh-status');
  const error = $('refresh-error');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (source === 'manual') status.textContent = 'Actualisation en cours…';

  try {
    const res = await fetch('data/status.json', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const nextData = await res.json();
    if (!validateData(nextData)) throw new Error('format de données inattendu');
    if (data && Date.parse(nextData.generatedAt) < Date.parse(data.generatedAt)) throw new Error('données plus anciennes que celles affichées');

    if (!data || nextData.generatedAt !== data.generatedAt) {
      const previousData = data;
      const openCards = [...document.querySelectorAll('.card details[open]')].map((details) => details.closest('.card')?.id);
      data = nextData;
      try {
        renderAll();
      } catch (renderError) {
        data = previousData;
        if (previousData) {
          try {
            renderAll();
            for (const id of openCards) document.querySelector(`#${CSS.escape(id)} details`)?.setAttribute('open', '');
          } catch {
            resetUnavailable();
          }
        } else {
          resetUnavailable();
        }
        throw renderError;
      }
    }

    lastRefreshAt = new Date().toISOString();
    renderFreshness();
    error.hidden = true;
    error.textContent = '';
    if (source === 'manual') status.textContent = 'Données actualisées.';
  } catch {
    if (!data) resetUnavailable();
    error.textContent = 'Actualisation impossible : dernières données valides conservées.';
    error.hidden = false;
    if (source === 'manual') status.textContent = 'Échec de l’actualisation.';
  } finally {
    clearTimeout(timeout);
    refreshing = false;
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
  }
}

function refreshIfDue() {
  const remaining = REFRESH_MS - (Date.now() - lastAttemptAt);
  if (remaining <= 0) refreshData('automatic');
  else scheduleRefresh(remaining);
}

function scheduleRefresh(delay) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshIfDue, delay);
}

$('search').addEventListener('input', (e) => {
  query = e.target.value;
  renderSections();
});
$('sort').addEventListener('change', (e) => {
  sortMode = e.target.value;
  renderOngoing();
  renderSections();
});
$('refresh').addEventListener('click', () => refreshData('manual'));
window.addEventListener('online', () => refreshData('automatic'));
window.addEventListener('focus', refreshIfDue);
window.addEventListener('pageshow', refreshIfDue);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIfDue();
});
setInterval(renderFreshness, FRESHNESS_MS);
refreshData('startup');
