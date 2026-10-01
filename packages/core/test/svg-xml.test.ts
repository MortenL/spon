import { describe, expect, it } from 'vitest';
import { decodeEntities, localName, parseXml, XmlError } from '../src/import/svg/xml';

describe('parseXml', () => {
  it('builds the element tree with attributes, namespaces and text', () => {
    const root = parseXml(`<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x" [ <!ENTITY a "b"> ]>
<!-- comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="i" width='10mm'>
  <g inkscape:label="Cut &amp; engrave" id="l1"><path d="M0 0"/></g>
  <style><![CDATA[ .a { fill: red } ]]></style>
</svg>`);
    expect(root.name).toBe('svg');
    expect(root.attrs.width).toBe('10mm');
    expect(root.children.map((c) => c.name)).toEqual(['g', 'style']);
    expect(root.children[0].attrs['inkscape:label']).toBe('Cut & engrave');
    expect(root.children[0].children[0]).toMatchObject({ name: 'path', attrs: { d: 'M0 0' }, line: 5 });
    expect(root.children[1].text.trim()).toBe('.a { fill: red }');
  });

  it('decodes entities and character references', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&unknown;')).toBe(`<>&"'AB&unknown;`);
  });

  it('reports malformed XML with a line number', () => {
    expect(() => parseXml('<svg>\n<g>\n</svg>')).toThrow(XmlError);
    expect(() => parseXml('<svg>\n<g>\n</svg>')).toThrow(/line 3/);
    expect(() => parseXml('<svg><!-- open')).toThrow(/Unclosed comment/);
    expect(() => parseXml('<svg a=b></svg>')).toThrow(/Malformed attributes/);
    expect(() => parseXml('just text')).toThrow(/No root element/);
  });

  it('strips namespace prefixes for element types', () => {
    expect(localName('svg:path')).toBe('path');
    expect(localName('rect')).toBe('rect');
  });
});
