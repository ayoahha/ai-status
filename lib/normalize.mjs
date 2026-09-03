// Normalisation des statuts bruts vers l'enum du site.
// Enum: operationnel | degradation | incident_majeur | maintenance | indisponible | inconnu

const INDICATOR_MAP = {
  none: 'operationnel',
  minor: 'degradation',
  major: 'incident_majeur',
  critical: 'indisponible',
  maintenance: 'maintenance',
};

// Clés CSS de la page statut Google Cloud (status.cloud.google.com)
const GOOGLE_CLASS_MAP = {
  available: 'operationnel',
  warning: 'degradation',
  outage: 'incident_majeur',
  error: 'incident_majeur',
  maintenance: 'maintenance',
};

export function normalizeIndicator(indicator) {
  return INDICATOR_MAP[indicator] ?? 'inconnu';
}

export function normalizeGoogleClass(cls) {
  return GOOGLE_CLASS_MAP[cls] ?? 'inconnu';
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
