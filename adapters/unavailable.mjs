import { fail } from '../lib/errors.mjs';

// Source connue mais injoignable (Zhipu) ou inexistante (Baidu) : aucune requête,
// jamais « opérationnel ». La note de la source, dans les deux langues, explique pourquoi
// Libellé de la famille de source, affiché « Lu via … » par la page
export const METHOD = { fr: 'aucune requête', en: 'no request' };

export async function collect(provider) {
  throw fail('unavailable', provider.source.note ?? null, provider.source.noteEn ?? null);
}
