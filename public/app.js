// Lecture de data/status.json (généré par la collecte GitHub Actions).
// Tout texte externe est inséré via textContent (pas d'innerHTML) → pas de contenu
// externe exécuté ou interprété comme instructions.
const STATUS_LABELS = {
  operationnel: 'Opérationnel',
  degradation: 'Dégradation',
  incident_majeur: 'Incident majeur',
  maintenance: 'Maintenance',
  indisponible: 'Indisponible',
  inconnu: 'Non vérifié',
};
const STALE_MS = 24 * 60 * 60 * 1000;

let providers = [];
let activeStatus = 'all';
let query = '';

function ageLabel(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3600000;
  if (h < 1) return `il y a ${Math.max(1, Math.floor(ms / 60000))} min`;
  if (h < 48) return `il y a ${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function makeCard(p) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.status = p.status;

  const h2 = document.createElement('h2');
  h2.textContent = p.name;
  card.appendChild(h2);

  const badge = document.createElement('span');
  badge.className = `badge ${p.status}`;
  badge.textContent = STATUS_LABELS[p.status] ?? p.status;
  card.appendChild(badge);

  if (Date.now() - new Date(p.collectedAt).getTime() > STALE_MS) {
    card.classList.add('is-stale');
    const stale = document.createElement('span');
    stale.className = 'stale';
    stale.textContent = 'Données obsolètes';
    card.appendChild(stale);
  }

  if (p.rawStatus) {
    const raw = document.createElement('p');
    raw.className = 'raw';
    raw.textContent = p.rawStatus;
    card.appendChild(raw);
  }

  if (p.components?.length) {
    const comps = document.createElement('p');
    comps.className = 'comps';
    const strong = document.createElement('strong');
    strong.textContent = 'Composants impactés :';
    comps.appendChild(strong);
    const ul = document.createElement('ul');
    ul.className = 'complist';
    for (const c of p.components) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
    comps.appendChild(ul);
    card.appendChild(comps);
  }

  const active = (p.incidents ?? []).filter((i) => i.state !== 'resolved' && i.state !== 'récupéré');
  if (active.length) {
    const box = document.createElement('div');
    box.className = 'incidents';
    for (const inc of active) {
      const div = document.createElement('div');
      div.className = 'incident';
      div.textContent = inc.title ?? '';
      const st = document.createElement('span');
      st.className = 'state';
      st.textContent = ` — ${inc.state ?? ''}`;
      div.appendChild(st);
      box.appendChild(div);
    }
    card.appendChild(box);
  }

  const meta = document.createElement('p');
  meta.className = 'meta';
  const age = ageLabel(p.collectedAt);
  meta.textContent = `Collecté ${p.collectedAt ? new Date(p.collectedAt).toLocaleString('fr-FR') : '—'}${age ? ` (${age})` : ''}`;
  card.appendChild(meta);

  if (p.collect?.state === 'error') {
    const err = document.createElement('p');
    err.className = 'meta';
    err.textContent = `Collecte en échec : ${p.collect.error}`;
    card.appendChild(err);
  }

  if (p.statusUrl) {
    const mp = document.createElement('p');
    mp.className = 'meta';
    const a = document.createElement('a');
    a.href = p.statusUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Page de statut officielle →';
    mp.appendChild(a);
    card.appendChild(mp);
  }
  return card;
}

function render() {
  const grid = document.getElementById('grid');
  grid.textContent = '';
  const q = query.trim().toLowerCase();
  const visible = providers.filter((p) => {
    if (activeStatus !== 'all' && p.status !== activeStatus) return false;
    if (!q) return true;
    const inName = (p.name ?? '').toLowerCase().includes(q);
    const inComps = (p.components ?? []).some((c) => c.toLowerCase().includes(q));
    return inName || inComps;
  });
  if (visible.length === 0) {
    const div = document.createElement('p');
    div.className = 'noresults';
    div.textContent = 'Aucun fournisseur ne correspond aux filtres.';
    grid.appendChild(div);
    return;
  }
  for (const p of visible) grid.appendChild(makeCard(p));
}

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    activeStatus = chip.dataset.status;
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    render();
  });
});
document.getElementById('search').addEventListener('input', (e) => {
  query = e.target.value;
  render();
});

(async () => {
  let data;
  try {
    const res = await fetch('data/status.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.getElementById('collected-at').textContent = `Impossible de charger les données (${err.message}).`;
    return;
  }
  providers = data.providers ?? [];
  const at = document.getElementById('collected-at');
  const age = ageLabel(data.generatedAt);
  at.textContent = `Dernière collecte : ${data.generatedAt ? new Date(data.generatedAt).toLocaleString('fr-FR') : '—'}${age ? ` (${age})` : ''}`;
  try {
    render();
  } catch (err) {
    at.textContent = `Erreur d'affichage : ${err.message}`;
  }
})();
