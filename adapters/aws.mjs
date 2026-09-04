import { worstOf } from '../lib/normalize.mjs';

// AWS Health Dashboard (Amazon Bedrock) : la page health.aws.amazon.com/health/status charge
// deux flux JSON publics sans jeton (observés dans ses requêtes, non documentés par AWS ;
// les flux RSS documentés existent mais un par service et par région) :
//   https://health.aws.amazon.com/public/currentevents          événements en cours, encodés en UTF-16 (BOM)
//   https://servicedata-<région>-prod.s3.amazonaws.com/services.json  catalogue service × région (BOM UTF-8)
// Code d'état AWS (bundle de la page) : 0 resolved, 1 impacted (info), 2 degraded, 3 disrupted.
// Le périmètre est restreint aux services dont service_name vaut source.serviceName
const CODE = { 1: 'degradation', 2: 'degradation', 3: 'incident_majeur' };

export function awsCode(code) {
  const n = Number(code);
  return n === 0 ? 'operationnel' : CODE[n] ?? 'inconnu';
}

// fetch décode toujours en UTF-8 : on lit les octets et on détecte le BOM
export async function decodeAwsBody(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const enc = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8';
  return JSON.parse(new TextDecoder(enc, { ignoreBOM: false }).decode(bytes));
}

export async function collectAws(provider, get) {
  const { eventsUrl, servicesUrl, serviceName } = provider.source;
  try {
    const [eres, sres] = await Promise.all([get(eventsUrl), get(servicesUrl)]);
    if (!eres.ok || !sres.ok) {
      return { status: 'inconnu', collect: { state: 'error', error: `HTTP ${eres.status} sur currentevents, HTTP ${sres.status} sur services.json` } };
    }
    const events = await decodeAwsBody(eres);
    const catalog = await decodeAwsBody(sres);
    if (!Array.isArray(events) || !Array.isArray(catalog)) {
      return { status: 'inconnu', collect: { state: 'error', error: 'schéma currentevents ou services.json inattendu' } };
    }
    const scoped = catalog.filter((s) => s.service_name === serviceName);
    if (scoped.length === 0) {
      return { status: 'inconnu', collect: { state: 'error', error: `aucun service « ${serviceName} » dans services.json` } };
    }
    const label = (s) => `${serviceName} (${s.region_name ?? s.service})`;
    // État d'un service-région = pire code parmi les événements ouverts qui le citent,
    // soit directement (event.service), soit dans impacted_services (état courant)
    const open = events.filter((e) => Number(e.status) !== 0 && !e.end_time);
    const codeFor = (id) => open.flatMap((e) => [
      ...(e.service === id ? [e.status] : []),
      ...(e.impacted_services?.[id] ? [e.impacted_services[id].current] : []),
    ]);
    const components = scoped.map((s) => {
      const codes = codeFor(s.service).map(awsCode).filter((c) => c !== 'operationnel');
      return { name: label(s), status: worstOf(codes) };
    });
    const impacted = new Set(components.filter((c) => c.status !== 'operationnel').map((c) => c.name));
    const incidents = open
      .map((e) => ({
        title: e.summary ?? e.service_name ?? 'event',
        state: 'en cours',
        impact: awsCode(e.status),
        createdAt: e.date ? new Date(Number(e.date) * 1000).toISOString() : null,
        updatedAt: null,
        url: 'https://health.aws.amazon.com/health/status',
        components: scoped.filter((s) => e.service === s.service || Number(e.impacted_services?.[s.service]?.current) > 0).map(label),
      }))
      .filter((i) => i.components.length > 0);
    return {
      status: worstOf(components.map((c) => c.status)),
      rawStatus: impacted.size ? `${impacted.size} region(s) impacted` : `No open event (${serviceName}, ${scoped.length} regions)`,
      rawIndicator: impacted.size ? 'open_event' : 'none',
      components,
      incidents,
      collect: { state: 'ok', error: null },
    };
  } catch (err) {
    return {
      status: 'inconnu',
      collect: { state: 'error', error: err.name === 'AbortError' ? 'timeout' : `erreur réseau : ${err.message}` },
    };
  }
}
