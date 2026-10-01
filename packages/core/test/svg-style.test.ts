import { describe, expect, it } from 'vitest';
import { computeStyle, INITIAL_STYLE, normalizeColor, parseCss, parseDeclarations } from '../src/import/svg/style';
import { parseXml } from '../src/import/svg/xml';

describe('SVG styles', () => {
  it('normalises colours', () => {
    expect(normalizeColor('#F00')).toBe('#ff0000');
    expect(normalizeColor(' #1A2b3C ')).toBe('#1a2b3c');
    expect(normalizeColor('rgb(255, 0, 128)')).toBe('#ff0080');
    expect(normalizeColor('rgb(100%,0%,50%)')).toBe('#ff0080');
    expect(normalizeColor('Blue')).toBe('#0000ff');
    expect(normalizeColor('none')).toBeNull();
    expect(normalizeColor('url(#grad)')).toBeNull();
  });

  it('parses declarations and simple CSS rules (Illustrator style, review focus 1)', () => {
    expect(parseDeclarations('fill:#f00; stroke : none ;')).toEqual({ fill: '#f00', stroke: 'none' });
    const rules = parseCss('/* c */ .cls-1, .cls-2 { fill: #ff0000 } #x{stroke:blue} path{fill:green} g > path{fill:red} @media print { .p{fill:red} }');
    expect(rules.map((r) => [r.type, r.cls, r.id])).toEqual([[null, 'cls-1', null], [null, 'cls-2', null], [null, null, 'x'], ['path', null, null]]);
  });

  it('resolves precedence and inheritance', () => {
    const doc = parseXml(`<svg><g fill="blue" visibility="hidden">
      <path id="x" class="a" fill="red" style="stroke:#00f"/>
      <path class="a" visibility="visible"/>
      <g style="display:none"><path/></g>
    </g></svg>`);
    const rules = parseCss('.a { fill: #00ff00 } #x { fill: #123456 }');
    const g = computeStyle(doc.children[0], INITIAL_STYLE, rules);
    expect(g).toEqual({ fill: '#0000ff', stroke: null, hidden: false, visible: false });
    // attribute < class rule < id rule; inline style wins for stroke
    expect(computeStyle(doc.children[0].children[0], g, rules)).toEqual({ fill: '#123456', stroke: '#0000ff', hidden: false, visible: false });
    expect(computeStyle(doc.children[0].children[1], g, rules)).toMatchObject({ fill: '#00ff00', visible: true });
    expect(computeStyle(doc.children[0].children[2], g, rules).hidden).toBe(true);
  });
});
