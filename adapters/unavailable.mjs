import { fail } from '../lib/errors.mjs';

// Source connue mais injoignable (Zhipu) ou inexistante (Baidu) : aucune requête,
// jamais « opérationnel ». La note de la source, dans les deux langues, explique pourquoi
export async function collect(provider) {
  throw fail('unavailable', provider.source.note ?? null, provider.source.noteEn ?? null);
}
