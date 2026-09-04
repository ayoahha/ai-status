// Scanner monotone minimal pour les blocs HTML/XML consommés par les adaptateurs.
// Il ignore commentaires et CDATA, accepte les espaces avant `>` et ne rescane
// jamais les suffixes après une balise incomplète.
const tagEnd = (source, start) => {
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return -1;
};

const MAX_DEPTH = 2_048;

export function attribute(attributes, wanted, { caseInsensitive = false } = {}) {
  if (typeof attributes !== 'string' || typeof wanted !== 'string' || !wanted) return null;
  const name = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')(?=\\s|$)`, caseInsensitive ? 'gi' : 'g');
  let cursor = 0;
  let quote = null;
  let value = null;
  for (const match of attributes.matchAll(pattern)) {
    for (; cursor < match.index; cursor += 1) {
      const char = attributes[cursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
    }
    if (quote) return null;
    if (value !== null) return null;
    value = match[1] ?? match[2];
  }
  return value;
}

export function elements(source, wanted, { tolerant = false } = {}) {
  if (typeof source !== 'string') return null;
  const found = [];
  let open = null;
  let wantedDepth = 0;
  const stack = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start) || source.startsWith('<![CDATA[', start)) {
      const marker = source.startsWith('<!--', start) ? '-->' : ']]>';
      const end = source.indexOf(marker, start + 4);
      if (end < 0) return tolerant ? found : null;
      cursor = end + marker.length;
      continue;
    }
    const end = tagEnd(source, start + 1);
    if (end < 0) return tolerant ? found : null;
    let token = source.slice(start + 1, end).trim();
    cursor = end + 1;
    if (!token) return tolerant ? found : null;
    if (token.startsWith('!') || token.startsWith('?')) {
      if (!tolerant && !(token.startsWith('?') && token.endsWith('?'))) return null;
      continue;
    }
    const closing = token.startsWith('/');
    if (closing) token = token.slice(1).trimStart();
    const selfClosing = !closing && token.endsWith('/');
    if (selfClosing) token = token.slice(0, -1).trimEnd();
    const match = token.match(/^([A-Za-z_][\w:.-]*)([\s\S]*)$/);
    if (!match) {
      if (!tolerant) return null;
      continue;
    }
    const name = match[1];
    const isWanted = tolerant ? name.toLowerCase() === wanted.toLowerCase() : name === wanted;
    if (!tolerant) {
      if (closing) {
        const current = stack.pop();
        if (match[2].trim() || !current || current.name !== name) return null;
        if (isWanted) {
          wantedDepth -= 1;
          found.push({ ...current, body: source.slice(current.bodyStart, start), end: cursor });
        }
      } else if (selfClosing) {
        if (isWanted) found.push({ start, end: cursor, attributes: match[2].trim(), body: '' });
      } else {
        if (stack.length >= MAX_DEPTH || (isWanted && wantedDepth)) return null;
        stack.push({ name, start, bodyStart: cursor, attributes: match[2].trim() });
        if (isWanted) wantedDepth += 1;
      }
      continue;
    }
    if (!isWanted) continue;
    if (closing) {
      if (match[2].trim() || !open) continue;
      found.push({ ...open, body: source.slice(open.bodyStart, start), end: cursor });
      open = null;
    } else if (selfClosing) {
      found.push({ start, end: cursor, attributes: match[2].trim(), body: '' });
    } else {
      open = { start, bodyStart: cursor, attributes: match[2].trim() };
    }
  }
  return tolerant || stack.length === 0 ? found : null;
}

export function wholeElement(source, wanted, { declaration = false } = {}) {
  const found = elements(source, wanted);
  if (!found || found.length !== 1) return null;
  let before = source.slice(0, found[0].start);
  if (declaration) before = before.replace(/^\s*<\?xml\b[^?]*\?>/i, '');
  return before.trim() || source.slice(found[0].end).trim() ? null : found[0];
}

export function elementText(source, wanted) {
  const found = elements(source, wanted);
  if (!found || found.length !== 1) return null;
  const value = found[0].body.trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cdata ? cdata[1] : value).trim();
}
