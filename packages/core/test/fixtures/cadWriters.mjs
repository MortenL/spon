// Minimal writers for the STEP and IGES test fixtures (see make-fixtures.mjs). They cover exactly what the fixtures need:
// axis-aligned boxes, vertical through holes and freeform arches (STEP only) and one product per body.

/** The [x, z] control points of an arch's cubic Bézier cross-section, half width `w` and height `h`; it starts and ends on Z 0. */
export function archProfile(w, h) {
  return [[-w, 0], [-0.9 * w, 1.3 * h], [0.9 * w, 1.3 * h], [w, 0]];
}

/**
 * STEP AP214 with one product (a MANIFOLD_SOLID_BREP) per body: a box `{ name, origin: [x, y, z], size: [sx, sy, sz], holes?: [{ center: [x, y], diameter }] }`
 * or an arch `{ name, arch: { halfWidths: [atY0, atLength], length, height } }`.
 */
export function stepFile(fileName, bodies) {
  const ents = [];
  const e = (s) => { ents.push(s); return `#${ents.length}`; };
  const f = (n) => (Number.isInteger(n) ? `${n}.` : String(n));
  const pt = (x, y, z) => e(`CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}))`);
  const dir = (x, y, z) => e(`DIRECTION('',(${f(x)},${f(y)},${f(z)}))`);
  const axis = (o, z, x) => e(`AXIS2_PLACEMENT_3D('',${pt(...o)},${dir(...z)},${dir(...x)})`);
  const vertex = (p) => e(`VERTEX_POINT('',${pt(...p)})`);
  const line = (p, d) => e(`LINE('',${pt(...p)},${e(`VECTOR('',${dir(...d)},1.)`)})`);
  const edge = (v1, v2, curve) => e(`EDGE_CURVE('',${v1},${v2},${curve},.T.)`);
  const oe = (ec, fwd) => e(`ORIENTED_EDGE('',*,*,${ec},${fwd ? '.T.' : '.F.'})`);
  const loop = (edges) => e(`EDGE_LOOP('',(${edges.join(',')}))`);
  const outer = (l) => e(`FACE_OUTER_BOUND('',${l},.T.)`);
  const inner = (l) => e(`FACE_BOUND('',${l},.T.)`);
  const face = (bounds, surface, same = true) => e(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${same ? '.T.' : '.F.'})`);
  const plane = (o, n, x) => e(`PLANE('',${axis(o, n, x)})`);

  const u1 = e(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const u2 = e(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const u3 = e(`( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`);
  const unc = e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${u1},'distance_accuracy_value','confusion accuracy')`);
  const ctx = e(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${u1},${u2},${u3})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);
  const appctx = e(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appctx})`);
  const pc = e(`PRODUCT_CONTEXT('',${appctx},'mechanical')`);
  const pdc = e(`PRODUCT_DEFINITION_CONTEXT('part definition',${appctx},'design')`);

  for (const b of bodies) {
    const faces = b.arch ? archFaces(b.arch) : boxFaces(b);
    const brep = e(`MANIFOLD_SOLID_BREP('${b.name}',${e(`CLOSED_SHELL('',(${faces.join(',')}))`)})`);
    const rep = e(`ADVANCED_BREP_SHAPE_REPRESENTATION('${b.name}',(${brep},${axis([0, 0, 0], [0, 0, 1], [1, 0, 0])}),${ctx})`);
    const prod = e(`PRODUCT('${b.name}','${b.name}','',(${pc}))`);
    e(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const pd = e(`PRODUCT_DEFINITION('design','',${e(`PRODUCT_DEFINITION_FORMATION('','',${prod})`)},${pdc})`);
    e(`SHAPE_DEFINITION_REPRESENTATION(${e(`PRODUCT_DEFINITION_SHAPE('','',${pd})`)},${rep})`);
  }

  // A tapered arch along +Y on Z 0: its top is one B-spline surface, cubic Bézier across (archProfile), straight along Y.
  function archFaces({ halfWidths: [w0, wL], length: L, height: h }) {
    const P = [[-w0, 0, 0], [w0, 0, 0], [-wL, L, 0], [wL, L, 0]];
    const [V0, V1, V2, V3] = P.map(vertex);
    const ruled = (a, b) => line(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const profile = (w, y) => archProfile(w, h).map(([x, z]) => [x, y, z]);
    const bezier = (w, y) => e(`B_SPLINE_CURVE_WITH_KNOTS('',3,(${profile(w, y).map((p) => pt(...p)).join(',')}),.UNSPECIFIED.,.F.,.F.,(4,4),(0.,1.),.UNSPECIFIED.)`);
    const front = edge(V0, V1, bezier(w0, 0)), back = edge(V2, V3, bezier(wL, L));
    const front0 = edge(V0, V1, ruled(P[0], P[1])), back0 = edge(V2, V3, ruled(P[2], P[3]));
    const left = edge(V0, V2, ruled(P[0], P[2])), right = edge(V1, V3, ruled(P[1], P[3]));
    const rows = profile(w0, 0).map((p, i) => `(${pt(...p)},${pt(...profile(wL, L)[i])})`).join(',');
    const top = e(`B_SPLINE_SURFACE_WITH_KNOTS('',3,1,(${rows}),.UNSPECIFIED.,.F.,.F.,.F.,(4,4),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)`);
    return [
      face([outer(loop([oe(left, true), oe(back0, true), oe(right, false), oe(front0, false)]))], plane([0, 0, 0], [0, 0, -1], [1, 0, 0])),
      face([outer(loop([oe(front0, true), oe(front, false)]))], plane([0, 0, 0], [0, -1, 0], [1, 0, 0])),
      face([outer(loop([oe(back0, false), oe(back, true)]))], plane([0, L, 0], [0, 1, 0], [1, 0, 0])),
      face([outer(loop([oe(front, true), oe(right, true), oe(back, false), oe(left, false)]))], top),
    ];
  }

  function boxFaces(b) {
    const [x0, y0, z0] = b.origin, [sx, sy, sz] = b.size;
    const V = (i, j, k) => [x0 + i * sx, y0 + j * sy, z0 + k * sz];
    const v = {};
    for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) v[`${i}${j}${k}`] = vertex(V(i, j, k));
    const ex = {}, ey = {}, ez = {};
    for (const a of [0, 1]) for (const c of [0, 1]) {
      ex[`${a}${c}`] = edge(v[`0${a}${c}`], v[`1${a}${c}`], line(V(0, a, c), [1, 0, 0]));
      ey[`${a}${c}`] = edge(v[`${a}0${c}`], v[`${a}1${c}`], line(V(a, 0, c), [0, 1, 0]));
      ez[`${a}${c}`] = edge(v[`${a}${c}0`], v[`${a}${c}1`], line(V(a, c, 0), [0, 0, 1]));
    }
    // each hole: a vertical cylinder through the whole box, seam at +X
    const topInner = [], bottomInner = [], holeFaces = [];
    for (const h of b.holes ?? []) {
      const [cx, cy] = h.center, r = h.diameter / 2;
      const vb = vertex([cx + r, cy, z0]), vt = vertex([cx + r, cy, z0 + sz]);
      const cb = edge(vb, vb, e(`CIRCLE('',${axis([cx, cy, z0], [0, 0, 1], [1, 0, 0])},${f(r)})`));
      const ct = edge(vt, vt, e(`CIRCLE('',${axis([cx, cy, z0 + sz], [0, 0, 1], [1, 0, 0])},${f(r)})`));
      const seam = edge(vb, vt, line([cx + r, cy, z0], [0, 0, 1]));
      topInner.push(inner(loop([oe(ct, false)])));
      bottomInner.push(inner(loop([oe(cb, true)])));
      const cyl = e(`CYLINDRICAL_SURFACE('',${axis([cx, cy, z0], [0, 0, 1], [1, 0, 0])},${f(r)})`);
      holeFaces.push(face([outer(loop([oe(ct, true), oe(seam, false), oe(cb, false), oe(seam, true)]))], cyl, false));
    }
    const faces = [
      face([outer(loop([oe(ey['00'], true), oe(ex['10'], true), oe(ey['10'], false), oe(ex['00'], false)])), ...bottomInner], plane(V(0, 0, 0), [0, 0, -1], [1, 0, 0])),
      face([outer(loop([oe(ex['01'], true), oe(ey['11'], true), oe(ex['11'], false), oe(ey['01'], false)])), ...topInner], plane(V(0, 0, 1), [0, 0, 1], [1, 0, 0])),
      face([outer(loop([oe(ex['00'], true), oe(ez['10'], true), oe(ex['01'], false), oe(ez['00'], false)]))], plane(V(0, 0, 0), [0, -1, 0], [1, 0, 0])),
      face([outer(loop([oe(ez['01'], true), oe(ex['11'], true), oe(ez['11'], false), oe(ex['10'], false)]))], plane(V(0, 1, 0), [0, 1, 0], [1, 0, 0])),
      face([outer(loop([oe(ez['00'], true), oe(ey['01'], true), oe(ez['01'], false), oe(ey['00'], false)]))], plane(V(0, 0, 0), [-1, 0, 0], [0, 1, 0])),
      face([outer(loop([oe(ey['10'], true), oe(ez['11'], true), oe(ey['11'], false), oe(ez['10'], false)]))], plane(V(1, 0, 0), [1, 0, 0], [0, 1, 0])),
      ...holeFaces,
    ];
    return faces;
  }
  const data = ents.map((s, i) => `#${i + 1}=${s};`).join('\n');
  return [
    'ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('Spon test fixture'),'2;1');",
    `FILE_NAME('${fileName}','2026-01-01T00:00:00',('Spon'),(''),'Spon make-fixtures','Spon','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;', 'DATA;', data, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}

/** IGES 5.3 surface model of a box: six trimmed planes (144 → 108 plane, bounded by 142 → 102 composite of 110 lines). */
export function igesFile(fileName, box) {
  const entities = [];
  const add = (type, params, status = '00010000') => { entities.push({ type, status, params }); return entities.length * 2 - 1; };
  const [x0, y0, z0] = box.origin, [sx, sy, sz] = box.size;
  const P = (i, j, k) => [x0 + i * sx, y0 + j * sy, z0 + k * sz];
  const quads = [
    { n: [0, 0, -1], c: [P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)] },
    { n: [0, 0, 1], c: [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)] },
    { n: [0, -1, 0], c: [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)] },
    { n: [0, 1, 0], c: [P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0)] },
    { n: [-1, 0, 0], c: [P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)] },
    { n: [1, 0, 0], c: [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)] },
  ];
  for (const q of quads) {
    const d = q.n[0] * q.c[0][0] + q.n[1] * q.c[0][1] + q.n[2] * q.c[0][2];
    const plane = add(108, [...q.n, d, 0, 0, 0, 0, 0]);
    const lines = q.c.map((a, i) => add(110, [...a, ...q.c[(i + 1) % 4]]));
    const composite = add(102, [lines.length, ...lines]);
    const curve = add(142, [0, plane, 0, composite, 2]);
    add(144, [plane, 1, 0, curve], '00000000');
  }
  const col = (s, w) => String(s).padStart(w).slice(-w);
  const hol = (s) => `${s.length}H${s}`;
  const S = ['Spon test fixture'.padEnd(72) + 'S' + col(1, 7)];
  const global = [',', ';'].map(hol).concat([
    hol('Spon'), hol(fileName), hol('Spon make-fixtures'), hol('1'), '32', '38', '6', '308', '15', hol('Spon'), '1.0', '2', hol('MM'),
    '1', '0.1', hol('20260101.000000'), '1.0E-06', '100.0', hol('Spon'), hol('Spon'), '11', '0', hol('20260101.000000'),
  ]).join(',') + ';';
  const G = [];
  for (let i = 0; i < global.length; i += 72) G.push(global.slice(i, i + 72).padEnd(72) + 'G' + col(G.length + 1, 7));
  const D = [], Pd = [];
  entities.forEach((ent, i) => {
    const de = i * 2 + 1;
    const text = [ent.type, ...ent.params.map(String)].join(',') + ';';
    const start = Pd.length + 1;
    for (let k = 0; k < text.length; k += 64) Pd.push(text.slice(k, k + 64).padEnd(64) + col(de, 8) + 'P' + col(Pd.length + 1, 7));
    const count = Pd.length - start + 1;
    D.push(col(ent.type, 8) + col(start, 8) + col(0, 8).repeat(6) + ent.status + 'D' + col(de, 7));
    D.push(col(ent.type, 8) + col(0, 8) + col(0, 8) + col(count, 8) + col(0, 8) + ' '.repeat(24) + col(0, 8) + 'D' + col(de + 1, 7));
  });
  const T = `S${col(S.length, 7)}G${col(G.length, 7)}D${col(D.length, 7)}P${col(Pd.length, 7)}`.padEnd(72) + 'T' + col(1, 7);
  return [...S, ...G, ...D, ...Pd, T, ''].join('\n');
}
