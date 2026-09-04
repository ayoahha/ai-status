// Erreurs typées levées par les adaptateurs et le client HTTP. Le runner les classe
// par `code` ; le contrat rend un texte FR / EN à partir du code et du détail.
// Codes : http | timeout | network | schema | scope | policy | limit | browser | unknown_kind | unavailable
export const ERROR_KINDS = ['http', 'timeout', 'network', 'schema', 'scope', 'policy', 'limit', 'browser', 'unknown_kind', 'unavailable'];

// Détail : texte court, autant que possible neutre (nom de flux, liste d'ids) ;
// detailEn facultatif quand une traduction existe (note d'une source injoignable)
export function fail(code, detail = null, detailEn = null) {
  const err = new Error(detail ?? code);
  err.code = code;
  err.detail = detail;
  err.detailEn = detailEn;
  return err;
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`${status} (${url})`);
    this.code = 'http';
    this.status = status;
    this.detail = this.message;
    this.detailEn = null;
  }
}

// Classement d'une erreur quelconque en { kind, detail, detailEn }
export function classify(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return { kind: 'timeout', detail: err.detail ?? null, detailEn: null };
  if (ERROR_KINDS.includes(err?.code)) return { kind: err.code, detail: err.detail ?? null, detailEn: err.detailEn ?? null };
  return { kind: 'network', detail: String(err?.message ?? err), detailEn: null };
}
