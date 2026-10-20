// ===================== 26-vehicles.js — K.vehicles: traffic and parked vehicles of Act 2 =====================
// Extracted from 25-city.js (FOUNDATION, v3): the vehicle types (VT half extents: the collision boxes), the walkable
// top profile, the paint palette, the geometry (v2 boxes, written with the city's mesh builder) and the traffic
// material. 25-city.js keeps traffic, parking, collisions and asks this part for everything vehicle-shaped.
//   K.vehicles.VT                    [{name, hx, hy, hz}] per type: 0 sedan, 1 taxi, 2 van, 3 bus, 4 cable car, 5 tram,
//                                    6 road works, 7 double-parked delivery van — half extents of the collision box
//                                    (the box sits on the road: centre y = hy). PHYSICS AND TESTS DEPEND ON THEM.
//   K.vehicles.vehicleTop(type, lz)  walkable height above the road at local z (roofs, windshields, hoods). Same rule.
//   K.vehicles.build(type)           -> { geometry, material } in the local frame (+z = front, y = 0 on the road,
//                                    x lateral) for an InstancedMesh; per-instance colour = paint (kind PAINT only).
//   K.vehicles.material()            the shared traffic material
//   K.vehicles.paint(type, i)        THREE.Color of traffic instance i of a type (taxis yellow, delivery vans by i)
//   K.vehicles.parkedPaint(type, s)  THREE.Color of a parked vehicle at route distance s
//   K.vehicles.addTo(mb, type, M, paint)  writes a vehicle into a city mesh builder (parked cars are baked into the
//                                    street chunks), M: THREE.Matrix4 placement, paint: THREE.Color (null = white)
//   K.vehicles.update(dt, t)         lamp / blinker clock (called by K.city.update; t = the city clock in seconds)
//   K.vehicles.PAINT (30), BLINK (31) surface kinds: per-instance paint, flashing amber lamps; PAINTS: palette (hex)
// PORT(vehicles): v2 look = boxes with vertex colours, glossy paint (rough 0.28, metal 0.35), emissive head/tail
// lamps (kind glow) and blinkers; v3: real car shapes (rounded body, wheel arches, separate glass, detailed wheels,
// chrome, plates), clearcoat flake paint (MeshPhysicalNodeMaterial), LOD near/far, all types upgraded (SPEC3 §5),
// keeping VT, vehicleTop() and the instancing exactly.
(() => {
'use strict';
const lerp = (a, b, t) => a + (b - a) * t;
const lib = () => K.cityLib; // 25-city.js publishes its mesh builder & co. at load time (used at call time only)
const VT = [
  { name: 'sedan', hx: 0.93, hy: 0.73, hz: 2.3 },
  { name: 'taxi', hx: 0.93, hy: 0.73, hz: 2.3 },
  { name: 'van', hx: 1.0, hy: 1.08, hz: 2.6 },
  { name: 'bus', hx: 1.3, hy: 1.58, hz: 6.0 },
  { name: 'cable', hx: 1.25, hy: 1.68, hz: 4.3 },
  { name: 'tram', hx: 1.35, hy: 1.72, hz: 7.0 },
  { name: 'works', hx: 1.2, hy: 0.6, hz: 1.9 },
  { name: 'dvan', hx: 1.0, hy: 1.08, hz: 2.6 }
];
const BLINK = 31; // amber lamps that flash (works, hazard lights)
const PAINT = 30;
const PAINTS = ['#f2f2ef', '#1d1f24', '#b8bec6', '#c0392b', '#2e5c9a', '#2f6b4f', '#e2d4b0', '#8a1f2e', '#5a6470', '#f0c419', '#3a8fb7', '#d9662b'];
const col = hex => new THREE.Color(hex);
const HEAD = col('#fff3d6'), TAIL = col('#ff2a1a'), GLASS = col('#1c2430'), TIRE = col('#1b1b1d'), CHROME = col('#c9ced6');
function vehicleTop(type, lz) {
  // walkable top height above the road at local z (roof, windshield ramps, hood)
  if (type <= 1) {
    if (lz > 1.2 || lz < -1.45) return 0.98;
    if (lz > 0.6) return lerp(1.45, 0.98, (lz - 0.6) / 0.6);
    if (lz < -0.95) return lerp(1.45, 1.0, (-0.95 - lz) / 0.5);
    return 1.45;
  }
  if (type === 2 || type === 7) return lz > 1.7 ? lerp(2.15, 1.2, (lz - 1.7) / 0.9) : 2.15;
  if (type === 6) return 1.02;
  return VT[type].hy * 2;
}
const _vm = new THREE.Matrix4(), _gv = new THREE.Vector3();
function addTo(mb, type, M, paint) {
  const { templates, TRS, KIND, C_WHITE, IRON, STEEL, WOOD, lin } = lib();
  if (mb.hd) mb = mb.hd; // a detail: drawn near the camera only
  const T = templates(), P = paint || C_WHITE;
  const at = (x, y, z, sx, sy, sz, rx) => { const L = TRS(x, y, z, rx || 0, 0, 0, sx, sy, sz); return _vm.copy(M).multiply(L); };
  const box = (x, y, z, sx, sy, sz, c, k, e) => mb.geo(T.box, at(x, y, z, sx, sy, sz), c, k, e || 0);
  const wheel = (x, z, r) => { const L = TRS(x, r, z, 0, 0, Math.PI / 2, r, 0.26, r); mb.geo(paint ? T.cyl8 : T.cyl12, _vm.copy(M).multiply(L), TIRE, KIND.plain, 0); };
  if (type <= 1) {
    box(0, 0.62, 0, 1.86, 0.64, 4.6, P, PAINT);
    // cabin (tapered) with glass all round and a painted roof
    const q = (a, b, c, d, cc, k) => { const w = [a, b, c, d].map(p => { _gv.set(p[0], p[1], p[2]).applyMatrix4(M); return [_gv.x, _gv.y, _gv.z]; }); mb.quad(w[0], w[1], w[2], w[3], cc, k, 0, 1, 1); };
    const yb = 0.94, yt = 1.45, wb = 0.85, wt = 0.74;
    const zf0 = 1.15, zf1 = 0.55, zr0 = -1.4, zr1 = -0.95;
    q([-wb, yb, zf0], [wb, yb, zf0], [wt, yt, zf1], [-wt, yt, zf1], GLASS, KIND.glass);
    q([wb, yb, zr0], [-wb, yb, zr0], [-wt, yt, zr1], [wt, yt, zr1], GLASS, KIND.glass);
    q([wb, yb, zf0], [wb, yb, zr0], [wt, yt, zr1], [wt, yt, zf1], GLASS, KIND.glass);
    q([-wb, yb, zr0], [-wb, yb, zf0], [-wt, yt, zf1], [-wt, yt, zr1], GLASS, KIND.glass);
    q([-wt, yt, zf1], [wt, yt, zf1], [wt, yt, zr1], [-wt, yt, zr1], P, PAINT);
    // pillars
    for (const sx of [-1, 1]) q([sx * 0.86, yb, -0.2], [sx * 0.86, yb, -0.05], [sx * 0.75, yt, -0.05], [sx * 0.75, yt, -0.2], P, PAINT);
    box(0, 0.42, 2.32, 1.9, 0.2, 0.12, CHROME, KIND.metal);
    box(0, 0.42, -2.32, 1.9, 0.2, 0.12, CHROME, KIND.metal);
    box(0, 0.68, 2.31, 0.9, 0.18, 0.04, IRON, KIND.metal);
    for (const sx of [-1, 1]) { box(sx * 0.68, 0.74, 2.31, 0.36, 0.16, 0.04, HEAD, KIND.glow, 2.4); box(sx * 0.72, 0.76, -2.31, 0.3, 0.14, 0.04, TAIL, KIND.glow, 1.6); }
    for (const sx of [-1, 1]) for (const z of [-1.45, 1.45]) wheel(sx * 0.82, z, 0.34);
    if (type === 1) {
      box(0, 1.6, -0.2, 0.7, 0.28, 0.32, lin('#fff1b0'), KIND.glow, 1.2);
      for (const sx of [-1, 1]) box(sx * 0.935, 0.62, 0, 0.02, 0.14, 4.2, lin('#1b1b1b'), KIND.dentil);
    }
  } else if (type === 2 || type === 7) {
    box(0, 1.17, -0.25, 2.0, 1.95, 4.7, P, PAINT);
    box(0, 0.75, 2.2, 1.96, 0.9, 0.8, P, PAINT);
    box(0, 1.5, 2.12, 1.86, 0.7, 0.62, GLASS, KIND.glass);
    for (const sx of [-1, 1]) box(sx * 1.0, 1.55, 1.2, 0.04, 0.6, 1.1, GLASS, KIND.glass);
    box(0, 0.4, 2.62, 2.02, 0.22, 0.1, CHROME, KIND.metal);
    for (const sx of [-1, 1]) { box(sx * 0.72, 0.85, 2.6, 0.36, 0.18, 0.04, HEAD, KIND.glow, 2.4); box(sx * 0.85, 1.0, -2.61, 0.22, 0.4, 0.04, TAIL, KIND.glow, 1.6); }
    for (const sx of [-1, 1]) for (const z of [-1.7, 1.75]) wheel(sx * 0.88, z, 0.38);
    if (type === 7) {
      // double-parked: hazard lights at the four corners, a beacon on the roof, the rear doors open
      const amb = lin('#ffa31a');
      for (const sx of [-1, 1]) { box(sx * 0.93, 0.85, 2.63, 0.16, 0.14, 0.03, amb, BLINK, 2.6); box(sx * 0.93, 1.35, -2.63, 0.16, 0.14, 0.03, amb, BLINK, 2.6); }
      mb.geo(T.sph8, at(0, 2.22, 0.9, 0.22, 0.16, 0.22), amb, BLINK, 3.0);
      box(0, 2.16, 0.9, 0.5, 0.05, 0.5, IRON, KIND.metal);
      for (const sx of [-1, 1]) box(sx * 1.32, 1.2, -2.48, 0.62, 1.8, 0.05, P, PAINT);
      box(0, 1.2, -2.57, 1.7, 1.7, 0.04, lin('#2a2622'), KIND.plain);
      box(0.25, 0.42, -2.25, 0.7, 0.5, 0.55, lin('#b58a55'), KIND.plank);
    }
  } else if (type === 3) {
    const red = lin('#c8352c'), wh = lin('#f1ece2');
    box(0, 1.65, 0, 2.6, 2.7, 12, wh, KIND.plain);
    box(0, 0.75, 0, 2.62, 0.7, 12.02, red, KIND.plain);
    for (const sx of [-1, 1]) box(sx * 1.31, 2.05, 0.2, 0.03, 0.9, 10.6, GLASS, KIND.glass, 0.5);
    box(0, 2.0, 6.0, 2.4, 1.3, 0.04, GLASS, KIND.glass);
    box(0, 3.1, 0, 2.2, 0.25, 9, lin('#d8d2c6'), KIND.plain);
    box(0, 2.85, 6.01, 1.6, 0.3, 0.03, lin('#ffb020'), KIND.glow, 1.4);
    for (const sx of [-1, 1]) { box(sx * 0.95, 0.75, 6.01, 0.36, 0.2, 0.04, HEAD, KIND.glow, 2.4); box(sx * 1.05, 0.9, -6.01, 0.25, 0.4, 0.04, TAIL, KIND.glow, 1.6); }
    for (const sx of [-1, 1]) for (const z of [-4.2, 3.9]) wheel(sx * 1.08, z, 0.48);
  } else if (type === 4) {
    // the cable car: maroon base, cream panels, open bench ends with brass poles, clerestory roof
    const mar = lin('#7a1f22'), cream = lin('#efe1bf'), red = lin('#b8322a'), wood = lin('#7b5634'), brass = lin('#d6b25a');
    box(0, 0.75, 0, 2.4, 0.7, 8.6, mar, KIND.plain);
    box(0, 0.42, 0, 2.5, 0.1, 8.7, wood, KIND.plank);
    box(0, 1.85, 0, 2.3, 1.5, 4.2, cream, KIND.plain);
    for (const sx of [-1, 1]) for (let k = -3; k <= 3; k++) box(sx * 1.16, 2.1, k * 0.58, 0.03, 0.8, 0.44, GLASS, KIND.glass, 0.6);
    box(0, 1.3, 0, 2.32, 0.18, 4.22, red, KIND.plain);
    for (const z of [-3.2, 3.2]) {
      box(0, 1.15, z, 2.3, 0.1, 2.0, wood, KIND.plank);
      for (const sx of [-1, 1]) for (const dz of [-0.85, 0.85]) mb.geo(T.cyl8, at(sx * 1.1, 2.0, z + dz, 0.035, 1.6, 0.035), brass, KIND.metal, 0);
    }
    box(0, 2.9, 0, 2.5, 0.16, 8.8, cream, KIND.plain);
    box(0, 3.15, 0, 1.4, 0.35, 7.0, red, KIND.plain);
    for (const sx of [-1, 1]) box(sx * 0.71, 3.15, 0, 0.02, 0.2, 6.6, GLASS, KIND.glass, 0.8);
    box(0, 3.15, 4.3, 0.9, 0.35, 0.3, lin('#1a1a1a'), KIND.plain);
    box(0, 3.15, 4.46, 0.7, 0.2, 0.04, lin('#fff3c0'), KIND.glow, 1.0);
    box(0, 1.3, 4.35, 0.3, 0.3, 0.08, HEAD, KIND.glow, 2.6);
    box(0, 1.3, -4.35, 0.3, 0.3, 0.08, HEAD, KIND.glow, 2.0);
    for (const sx of [-1, 1]) for (const z of [-2.6, 2.6]) wheel(sx * 0.75, z, 0.32);
  } else if (type === 6) {
    // road works on the crown of the street: sawhorse barriers front and back, striped side boards, flashing lamps,
    // a blue "keep left / right" sign, a heap of earth, a pick and a toolbox inside
    const ora = lin('#ff7a1a'), leg = lin('#d9d2c4'), amb = lin('#ffa31a'), blue = lin('#1f5fb8');
    for (const z of [-1.78, 1.78]) {
      for (const h of [0.55, 0.92]) box(0, h, z, 2.4, 0.2, 0.06, ora, KIND.awning);
      for (const sx of [-1.12, 1.12]) box(sx, 0.5, z, 0.1, 1.0, 0.42, leg, KIND.plain);
      for (const sx of [-0.95, 0.95]) mb.geo(T.sph8, at(sx, 1.12, z, 0.1, 0.1, 0.1), amb, BLINK, 2.8);
    }
    for (const sx of [-1.15, 1.15]) { box(sx, 0.48, 0, 0.05, 0.22, 3.4, ora, KIND.awning); box(sx, 0.24, 0, 0.06, 0.48, 0.08, leg, KIND.plain); }
    mb.geo(T.sph8, at(0, 0.05, 0.2, 0.75, 0.42, 1.0), lin('#6b5236'), KIND.plain, 0);
    box(0, 0.01, -0.9, 1.6, 0.03, 1.0, lin('#1d1b1a'), KIND.plain);
    box(-0.55, 0.2, -0.95, 0.45, 0.4, 0.3, lin('#c0392b'), KIND.metal);
    mb.geo(T.cyl8, at(0.45, 0.6, 0.35, 0.03, 1.1, 0.03, 0.5), WOOD, KIND.plank, 0);
    for (const z of [-1.97, 1.97]) {
      mb.geo(T.cyl8, at(0, 1.32, z, 0.035, 0.7, 0.035), STEEL, KIND.metal, 0);
      mb.geo(T.cyl12, at(0, 1.72, z, 0.3, 0.025, 0.3, Math.PI / 2), blue, KIND.plain, 0);
      box(0, 1.72, z + Math.sign(z) * 0.02, 0.32, 0.07, 0.01, C_WHITE, KIND.paint);
      box(-0.12, 1.79, z + Math.sign(z) * 0.02, 0.07, 0.07, 0.01, C_WHITE, KIND.paint);
      box(-0.12, 1.65, z + Math.sign(z) * 0.02, 0.07, 0.07, 0.01, C_WHITE, KIND.paint);
    }
  } else {
    // vintage streetcar: green and cream with a trolley pole
    const grn = lin('#2f6b4f'), cream = lin('#efe4c7');
    box(0, 1.0, 0, 2.7, 1.2, 14, grn, KIND.plain);
    box(0, 2.3, 0, 2.6, 1.4, 13.6, cream, KIND.plain);
    for (const sx of [-1, 1]) for (let k = -5; k <= 5; k++) box(sx * 1.31, 2.35, k * 1.15, 0.03, 0.9, 0.8, GLASS, KIND.glass, 0.6);
    box(0, 3.2, 0, 2.4, 0.4, 12.8, grn, KIND.plain);
    for (const z of [-6.95, 6.95]) { box(0, 2.3, z, 2.2, 1.0, 0.04, GLASS, KIND.glass); box(0, 1.15, z * 1.003, 0.35, 0.3, 0.06, HEAD, KIND.glow, 2.4); }
    mb.geo(T.cyl8, at(0, 4.6, -1.0, 0.04, 5.6, 0.04, -0.85), lin('#2a2a2a'), KIND.metal, 0);
    for (const sx of [-1, 1]) for (const z of [-4.5, 4.5]) wheel(sx * 0.8, z, 0.4);
  }
}
let MAT = null;
function material() {
  if (!MAT) MAT = lib().cityMaterial({ vehicle: true });
  return MAT;
}
function build(type) {
  const L = lib(), mb = new L.MB();
  addTo(mb, type, new THREE.Matrix4(), null);
  return { geometry: mb.build(), material: material() };
}
function paint(type, i) {
  const L = lib();
  return type === 1 ? col('#f4c21b') : type === 7 ? col(['#7a5230', '#f2f2ef', '#c0392b'][i % 3]) : type >= 3 ? L.C_WHITE.clone() : col(PAINTS[(i * 5 + type) % PAINTS.length]);
}
function parkedPaint(type, s) {
  const h = lib().hash;
  return type === 1 ? col('#f4c21b') : col(PAINTS[Math.floor(h(s * 1.7) * PAINTS.length) % PAINTS.length]);
}
function update(dt, t) { /* the v2 blinkers read the city clock in the material; v3 lamps can animate here */ }
K.vehicles = { VT, PAINT, BLINK, PAINTS, vehicleTop, build, material, paint, parkedPaint, addTo, update };
})();
