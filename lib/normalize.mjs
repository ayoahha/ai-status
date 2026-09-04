// Normalisation des statuts bruts vers l'enum du site.
// Enum: operationnel | degradation | incident_majeur | maintenance | indisponible | inconnu
import { STATUS_VALUES } from '../public/status-contract.js';

// Indicateur de page Statuspage (status.indicator)
const INDICATOR_MAP = {
  none: 'operationnel',
  minor: 'degradation',
  major: 'incident_majeur',
  critical: 'indisponible',
  maintenance: 'maintenance',
};

// État d'un composant Statuspage (components[].status)
const COMPONENT_MAP = {
  operational: 'operationnel',
  degraded_performance: 'degradation',
  partial_outage: 'degradation',
  major_outage: 'incident_majeur',
  under_maintenance: 'maintenance',
};

// Impact d'un incident Google Cloud (incidents.json, status_impact)
const GOOGLE_IMPACT_MAP = {
  SERVICE_OUTAGE: 'incident_majeur',
  SERVICE_DISRUPTION: 'degradation',
};

// Ordre de gravité : plus l'index est haut, plus c'est grave. « inconnu » est à part
export const SEVERITY = STATUS_VALUES.filter((status) => status !== 'inconnu');
export const STATUSES = STATUS_VALUES;

export function normalizeIndicator(indicator) {
  return INDICATOR_MAP[indicator] ?? 'inconnu';
}

export function normalizeComponentStatus(status) {
  return COMPONENT_MAP[status] ?? 'inconnu';
}

export function normalizeGoogleImpact(impact) {
  return impact === 'SERVICE_INFORMATION' ? null : GOOGLE_IMPACT_MAP[impact] ?? 'inconnu';
}

// Pire état d'une liste. Un état réel dégradé l'emporte sur « inconnu » ; mais un
// « inconnu » interdit « operationnel » : on ne déclare pas sain ce qu'on n'a pas pu lire
export function worstOf(statuses) {
  let worst = 'operationnel';
  let unknown = false;
  for (const s of statuses) {
    if (s === 'inconnu') unknown = true;
    else if (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst)) worst = s;
  }
  return worst === 'operationnel' && unknown ? 'inconnu' : worst;
}

// « model » si le nom correspond au motif déclaré par le fournisseur (modelPattern
// dans providers.json) ; sinon « service ». Affichage seulement, jamais le statut
export function classifyKind(name, modelPattern) {
  return modelPattern && new RegExp(modelPattern, 'i').test(name) ? 'model' : 'service';
}

// Un échec de collecte ne doit jamais produire "operationnel".
export function normalizeFailure() {
  return 'inconnu';
}

export const STATUS_LABELS = {
  operationnel: 'Opérationnel',
  degradation: 'Dégradation',
  incident_majeur: 'Incident majeur',
  maintenance: 'Maintenance',
  indisponible: 'Indisponible',
  inconnu: 'Non vérifié',
};

// Libellés anglais : même enum, servis dans status.json pour le sélecteur FR / EN de la page
export const STATUS_LABELS_EN = {
  operationnel: 'Operational',
  degradation: 'Degraded',
  incident_majeur: 'Major incident',
  maintenance: 'Maintenance',
  indisponible: 'Unavailable',
  inconnu: 'Unverified',
};
