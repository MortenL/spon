/** A parsed XML element. `text` is the element's own character data (CDATA included), used for <style>. */
export interface XmlElement { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string; line: number }

export class XmlError extends Error {
  override name = 'XmlError';
  constructor(message: string, readonly line: number) {
    super(`${message} at line ${line}`);
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e] ?? whole;
  });
}

/** The element type without a namespace prefix: "svg:path" → "path". */
export const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

const ATTR = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')|\s*(\/?>)/y;

/** A small, non-validating XML parser: elements, attributes, entities, CDATA, comments, PIs and the doctype. */
export function parseXml(text: string): XmlElement {
  const doc: XmlElement = { name: '#document', attrs: {}, children: [], text: '', line: 1 };
  const stack: XmlElement[] = [doc];
  let i = 0;
  let line = 1;
  const advance = (to: number) => {
    for (let k = i; k < to; k++) if (text.charCodeAt(k) === 10) line++;
    i = to;
  };
  const err = (message: string) => new XmlError(message, line);
  const top = () => stack[stack.length - 1];
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      top().text += decodeEntities(text.slice(i));
      advance(text.length);
      break;
    }
    if (lt > i) {
      top().text += decodeEntities(text.slice(i, lt));
      advance(lt);
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw err('Unclosed comment');
      advance(end + 3);
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end < 0) throw err('Unclosed CDATA section');
      top().text += text.slice(i + 9, end);
      advance(end + 3);
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) throw err('Unclosed processing instruction');
      advance(end + 2);
    } else if (text.startsWith('<!', i)) {
      let k = i + 2;
      let depth = 0;
      for (; k < text.length; k++) {
        const c = text[k];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (k >= text.length) throw err('Unclosed declaration');
      advance(k + 1);
    } else if (text[i + 1] === '/') {
      const end = text.indexOf('>', i);
      if (end < 0) throw err('Unclosed end tag');
      const name = text.slice(i + 2, end).trim();
      const open = top();
      if (stack.length === 1 || open.name !== name) throw err(`Unexpected </${name}>`);
      stack.pop();
      advance(end + 1);
    } else {
      const startLine = line;
      const nameMatch = /^[^\s/>]+/.exec(text.slice(i + 1, i + 257));
      if (!nameMatch) throw err('Invalid tag');
      const el: XmlElement = { name: nameMatch[0], attrs: {}, children: [], text: '', line: startLine };
      let k = i + 1 + nameMatch[0].length;
      let selfClosing = false;
      for (;;) {
        ATTR.lastIndex = k;
        const m = ATTR.exec(text);
        if (!m) throw err(`Malformed attributes in <${el.name}>`);
        k = ATTR.lastIndex;
        if (m[4]) {
          selfClosing = m[4] === '/>';
          break;
        }
        el.attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      }
      top().children.push(el);
      if (!selfClosing) stack.push(el);
      advance(k);
    }
  }
  if (stack.length > 1) throw err(`Unclosed <${top().name}>`);
  const root = doc.children[0];
  if (!root) throw err('No root element');
  return root;
}
