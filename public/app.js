// Lecture de data/status.json (contrat v2, généré par la collecte GitHub Actions).
// Tout texte externe est inséré via textContent (pas d'innerHTML) → aucun contenu
// externe exécuté ou interprété comme instructions
const STALE_MS = 2 * 60 * 60 * 1000; // 4 cadences de collecte ratées
const SEVERITY_ORDER = ['indisponible', 'incident_majeur', 'degradation', 'maintenance', 'inconnu', 'operationnel'];
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

function badge(status, text) {
  const b = el('span', `badge s-${status}`);
  b.appendChild(icon(status));
  b.appendChild(el('span', null, text ?? label(status)));
  return b;
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
    renderGrid();
  });
  return b;
}

function renderFreshness() {
  const at = $('collected-at');
  const age = ageLabel(data.generatedAt);
  at.textContent = `Mis à jour ${fmtDate(data.generatedAt)}${age ? ` (${age})` : ''} · collecte toutes les 30 min`;
  const stale = Date.now() - new Date(data.generatedAt).getTime() > STALE_MS;
  document.body.classList.toggle('is-stale', stale);
  const banner = $('stale');
  banner.hidden = !stale;
  banner.textContent = stale
    ? `Données obsolètes : dernière collecte ${age}. Les états affichés ne reflètent peut-être plus la situation actuelle.`
    : '';
  document.querySelectorAll('[data-age]').forEach((e) => {
    e.textContent = ageLabel(e.dataset.age) ?? '';
  });
}

// Section « En cours » : tout ce qui n'est pas opérationnel, incidents et maintenances actives
function renderOngoing() {
  const list = $('ongoing-list');
  list.textContent = '';
  const items = [];
  for (const p of sortedProviders()) {
    if (p.status === 'operationnel') continue;
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
    if (p.collect.state === 'error') body.appendChild(el('p', 'ongoing-err', p.collect.error));
    li.appendChild(body);
    items.push(li);
  }
  $('ongoing').hidden = items.length === 0;
  for (const li of items) list.appendChild(li);
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
    const a = el('a', 'incident-link', 'détail');
    a.href = inc.url;
    a.target = '_blank';
    a.rel = 'noopener';
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(a);
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
    const a = el('a', 'incident-link', 'détail');
    a.href = m.url;
    a.target = '_blank';
    a.rel = 'noopener';
    p.appendChild(document.createTextNode(' · '));
    p.appendChild(a);
  }
  return p;
}

function componentList(title, comps) {
  const frag = document.createDocumentFragment();
  frag.appendChild(el('h3', 'sub', `${title} (${comps.length})`));
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

function makeCard(p) {
  const card = el('article', `card s-${p.status}`);
  card.id = p.id;
  card.dataset.status = p.status;

  const head = el('div', 'card-head');
  head.appendChild(el('h2', null, p.name));
  head.appendChild(badge(p.status));
  card.appendChild(head);
  if (p.scope) card.appendChild(el('p', 'scope', p.scope));
  card.appendChild(el('p', 'reason', p.reason));
  if (p.collect.state === 'error') card.appendChild(el('p', 'err', p.collect.error));

  const hasDetail = p.components.length || p.incidents.length || p.maintenances.length;
  if (hasDetail) {
    const details = el('details');
    details.open = p.status !== 'operationnel';
    const alerted = p.components.filter((c) => c.status !== 'operationnel').length;
    const summaryParts = [];
    if (p.components.length) summaryParts.push(`${countWord(p.components.length, 'composant')} suivi${p.components.length > 1 ? 's' : ''}${alerted ? `, ${alerted} en alerte` : ''}`);
    if (p.incidents.length) summaryParts.push(countWord(p.incidents.length, 'incident'));
    if (p.maintenances.length) summaryParts.push(countWord(p.maintenances.length, 'maintenance'));
    details.appendChild(el('summary', null, summaryParts.join(' · ')));
    if (p.incidents.length) {
      details.appendChild(el('h3', 'sub', 'Incidents'));
      for (const inc of p.incidents) details.appendChild(incidentLine(inc));
    }
    if (p.maintenances.length) {
      details.appendChild(el('h3', 'sub', 'Maintenances'));
      for (const m of p.maintenances) details.appendChild(maintenanceLine(m));
    }
    const models = p.components.filter((c) => c.kind === 'model');
    const services = p.components.filter((c) => c.kind !== 'model');
    if (models.length) details.appendChild(componentList('Modèles', models));
    if (services.length) details.appendChild(componentList(models.length ? 'Services' : 'Composants', services));
    card.appendChild(details);
  }

  const meta = el('p', 'meta');
  const age = el('span', null, ageLabel(p.collectedAt) ?? '');
  age.dataset.age = p.collectedAt;
  age.title = fmtDate(p.collectedAt);
  meta.appendChild(age);
  meta.appendChild(document.createTextNode(` · ${METHOD_LABELS[p.collect.method] ?? p.collect.method} · `));
  const a = el('a', null, 'page officielle');
  a.href = p.statusUrl;
  a.target = '_blank';
  a.rel = 'noopener';
  meta.appendChild(a);
  card.appendChild(meta);
  return card;
}

function matches(p, q) {
  if (!q) return true;
  if (p.name.toLowerCase().includes(q)) return true;
  if (p.components.some((c) => c.name.toLowerCase().includes(q))) return true;
  return p.incidents.some((i) => i.title.toLowerCase().includes(q));
}

function renderGrid() {
  const grid = $('grid');
  grid.textContent = '';
  const q = query.trim().toLowerCase();
  const visible = sortedProviders().filter((p) => (filter === 'all' || p.status === filter) && matches(p, q));
  $('result-count').textContent = visible.length === data.providers.length
    ? ''
    : `${countWord(visible.length, 'fournisseur')} sur ${data.providers.length}`;
  if (visible.length === 0) {
    grid.appendChild(el('p', 'noresults', 'Aucun fournisseur ne correspond.'));
    return;
  }
  for (const p of visible) grid.appendChild(makeCard(p));
}

function renderAll() {
  labels = data.labels ?? FALLBACK_LABELS;
  renderSummary();
  renderFreshness();
  renderOngoing();
  renderGrid();
}

$('search').addEventListener('input', (e) => {
  query = e.target.value;
  renderGrid();
});
$('sort').addEventListener('change', (e) => {
  sortMode = e.target.value;
  renderOngoing();
  renderGrid();
});

(async () => {
  try {
    const res = await fetch('data/status.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    if (data.schemaVersion !== 2 || !Array.isArray(data.providers)) throw new Error('format de données inattendu');
  } catch (err) {
    $('overall').textContent = 'Données indisponibles';
    $('collected-at').textContent = `Impossible de charger les données (${err.message}).`;
    return;
  }
  try {
    renderAll();
    setInterval(renderFreshness, 60000);
  } catch (err) {
    $('collected-at').textContent = `Erreur d’affichage : ${err.message}`;
  }
})();
