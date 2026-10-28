    // ---- dressing: half-buried stones along the foot of the valley walls, boulders on the shore, more flower tufts
    for (let i = 0; i < n; i += 6) {
      const zr = PA.z[i];
      for (const sg of [-1, 1]) {
        const hw = keyInterp(HALFW, zr, sg > 0 ? 2 : 1);
        const rx = Math.cos(PA.yaw[i]) * sg, rz = -Math.sin(PA.yaw[i]) * sg;
        const at = (lat) => [PA.x[i] + rx * lat, PA.z[i] + rz * lat];
        if (rng() < 0.45) {
          const [x, z] = at(hw - 0.4 + rng() * 0.6);
          put('rock', x, z, 0.6, 0.5, { s: 0.22 + rng() * 0.25, y0: -0.12, rx: (rng() - 0.5) * 0.6, rz: (rng() - 0.5) * 0.6, tier: 1 });
        }
        if (rng() < 0.5) {
          const [x, z] = at(hw + 12 + rng() * 30);
          put('flower', x, z, 0.8, 0.7, { s: 1 + rng() * 0.5, tier: 1 });
        }
        // shore: walk out from the hill until the ground meets the sea
        if (i % 12 === 0 && rng() < 0.7) {
          for (let lat = hw + 8; lat < hw + 90; lat += 1.5) {
            const [x, z] = at(lat), h = terrainY(x, z);
            if (h < 0.5) {
              const k = 1 + Math.floor(rng() * 3);
              for (let j = 0; j < k; j++) {
                const xx = x + (rng() - 0.5) * 5, zz = z + (rng() - 0.5) * 5, hh = terrainY(xx, zz);
                if (hh > -1.6 && hh < 1.2 && !kept(xx, zz, 1.5) && Math.hypot(xx - ARENA.x, zz - ARENA.z) > ARENA.flat + 2) {
                  items.rock.push({ x: xx, y: hh - 0.25, z: zz, ry: rng() * TAU, s: 0.7 + rng() * 1.3, rx: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.5, tier: 1 });
                }
              }
              break;
            }
          }
        }
      }
    }
    if (S.touch) for (const k in items) { let nf = 0, nl = 0; items[k] = items[k].filter(it => (it.far ? nf++ % 4 === 0 : true) && (k === 'flower' ? nl++ % 2 === 0 : true)); }
    // tiers: Moyen / Économie draw tier 0 only (geometry draw range), Ultra / Élevé everything
    { let nf = 0, nl = 0; for (const k in items) for (const it of items[k]) if (it.tier == null) it.tier = (it.far && nf++ % 4 !== 0) || (k === 'flower' && nl++ % 2) ? 1 : 0; }
    // ---- bake: per zone, one solid and one foliage mesh (templates in a few variants)
    const split = t => {
      const s = new DB(), f = new DB(), ms = new Int32Array(t.n).fill(-1), mf = new Int32Array(t.n).fill(-1);
      const cp = (d, map, v) => {
        if (map[v] < 0) map[v] = d.v(t.P[v * 3], t.P[v * 3 + 1], t.P[v * 3 + 2], t.N[v * 3], t.N[v * 3 + 1], t.N[v * 3 + 2], { r: t.C[v * 3], g: t.C[v * 3 + 1], b: t.C[v * 3 + 2] },
          t.U[v * 2], t.U[v * 2 + 1], t.K[v * 4], t.K[v * 4 + 1], t.K[v * 4 + 2], t.K[v * 4 + 3]);
        return map[v];
      };
      for (let i = 0; i < t.I.length; i += 3) {
        const fol = t.K[t.I[i] * 4] >= 10, d = fol ? f : s, map = fol ? mf : ms;
        d.tri(cp(d, map, t.I[i]), cp(d, map, t.I[i + 1]), cp(d, map, t.I[i + 2]));
      }
      return { s, f };
    };
    const TPL = {
      palm: [0, 1, 2, 3].map(v => split(tplPalm(101 + v * 17))), sunflower: [split(tplSunflower())],
      flower: [0, 1, 2, 3].map(v => split(tplFlowers(301 + v * 13))), bush: [0, 1, 2].map(v => split(tplBush(401 + v * 7))),
      rock: [0, 1, 2, 3].map(v => split(tplRock(501 + v * 11))), totem: [split(tplTotem())]
    };
    const zones = new Map();
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new V3(), sv = new V3();
    const tierOrder = [0, 1];
    const zoneOf = key => { let zn = zones.get(key); if (!zn) { zn = { s: new DB(), f: new DB(), s0: 0, f0: 0 }; zones.set(key, zn); } return zn; };
    for (const tier of tierOrder) {
      for (const type in items) for (const it of items[type]) {
        if ((it.tier || 0) !== tier) continue;
        const vars = TPL[type], vi = Math.floor(ihash(Math.round(it.x * 10), Math.round(it.z * 10), 77) * vars.length) % vars.length, tp = vars[vi];
        e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ'); q.setFromEuler(e);
        const s = it.s || 1;
        mt.compose(pv.set(it.x, it.y + (it.y0 || 0) * s, it.z), q, sv.set(s, s, s));
        const ph = ihash(Math.round(it.x * 7), Math.round(it.z * 7), 91) * 40;
        const tint = type === 'totem' ? null : tintOf('#ffffff', rngOf(Math.round(it.x * 13 + it.z * 7)), type === 'flower' ? 0 : 0.16);
        const zn = zoneOf(Math.floor(it.z / ZONE));
        zn.s.put(tp.s, mt, s, ph, tint); zn.f.put(tp.f, mt, s, ph, tint);
      }
      if (tier === 0) for (const zn of zones.values()) { zn.s0 = zn.s.I.length; zn.f0 = zn.f.I.length; }
    }
    const mats = decorMaterials();
    S.decor = [];
    for (const [key, zn] of zones) {
      for (const [db, mat, n0, nm] of [[zn.s, mats.solid, zn.s0, 'w-decor'], [zn.f, mats.foliage, zn.f0, 'w-foliage']]) {
        if (!db.n) continue;
        const mesh = new THREE.Mesh(db.build(), mat);
        mesh.name = nm;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.userData.tier0 = n0;
        scene.add(mesh);
        S.decor.push(mesh);
      }
      void key;
    }
    applyDecorTier();
    S.decorCounts = { palm: items.palm.length, sunflower: items.sunflower.length, flower: items.flower.length, bush: items.bush.length, rock: items.rock.length, totem: items.totem.length };
  }
  // Moyen / Économie draw the tier-0 decor only (the rest of each zone's index buffer is cut off by the draw range)
  function applyDecorTier() {
    if (!S.decor) return;
    const pre = (K.gfx && K.gfx.preset) || 'high', full = pre === 'ultra' || pre === 'high';
    for (const m of S.decor) {
      const n = full ? Infinity : m.userData.tier0;
      m.geometry.setDrawRange(0, n);
      m.visible = n > 0 || full;
    }
  }
  // Decor materials (every zone shares them). Wind: positionNode (the shadow pass uses it too), gusts travelling over
  // the island + leaf flutter. Solid: bark / rock / painted wood / bush leaves picked by aK.x, with their normal and ORM
  // maps. Foliage: palm fronds (alpha-cut texture), petals and leaves (vertex colour), double-sided, with sun
  // translucency (MeshSSSNodeMaterial: light through the leaves, shadowed like the direct light).
  function decorWind() {
    const K4 = attribute('aK', 'vec4'), pg = positionGeometry;
    const wv = TIME.mul(1.2).add(pg.x.mul(0.045)).add(pg.z.mul(0.035));
    const gust = tsin(wv.add(K4.z.mul(0.12))).mul(0.5).add(tsin(wv.mul(0.37).add(1.3)).mul(0.45)).add(0.3);
    const bend = K4.y.mul(gust);
    const fl = K4.w.mul(tsin(TIME.mul(5.7).add(K4.z).add(pg.x.mul(0.9)).add(pg.z.mul(0.7))));
    return positionLocal.add(vec3(bend.mul(0.8).add(fl.mul(0.3)), fl.mul(0.7).sub(bend.abs().mul(0.15)), bend.mul(0.6).add(fl.mul(0.3))));
  }
  const isKind = (kind, k) => float(1).sub(tstep(0.5, tabs(kind.sub(k))));
  function decorMaterials() {
    const K4 = attribute('aK', 'vec4'), kind = K4.x, vc = attribute('color', 'vec3'), uvn = tuv();
    const sol = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
    {
      const isB = isKind(kind, DK.BARK), isR = isKind(kind, DK.ROCK), isW = isKind(kind, DK.WOOD), isL = isKind(kind, DK.LEAVES);
      const isP = float(1).sub(isB).sub(isR).sub(isW).sub(isL);
      const bA = ttexture(wtex('bark_albedo'), uvn), bN = ttexture(wtex('bark_normal'), uvn), bO = ttexture(wtex('bark_orm'), uvn);
      const rA = ttexture(wtex('rock_albedo'), uvn), rN = ttexture(wtex('rock_normal'), uvn), rO = ttexture(wtex('rock_orm'), uvn);
      const wA = ttexture(wtex('wood_albedo'), uvn), wN = ttexture(wtex('wood_normal'), uvn);
      const lA = ttexture(wtex('leaves_albedo'), uvn), lN = ttexture(wtex('leaves_normal'), uvn);
      const alb = bA.rgb.mul(meanInv('bark')).mul(isB).add(rA.rgb.mul(meanInv('rock')).mul(isR))
        .add(mix(vec3(1), wA.rgb.mul(meanInv('wood')), 0.45).mul(isW)).add(lA.rgb.mul(meanInv('leaves')).mul(isL)).add(vec3(1).mul(isP));
      sol.colorNode = vc.mul(alb);
      const flatN = vec3(0.5, 0.5, 1);
      const nT = bN.xyz.mul(isB).add(rN.xyz.mul(isR)).add(mix(flatN, wN.xyz, 0.5).mul(isW)).add(lN.xyz.mul(isL)).add(flatN.mul(isP));
      sol.normalNode = TSL.normalMap(nT);
      sol.roughnessNode = bO.g.mul(isB).add(rO.g.mul(isR)).add(float(0.48).mul(isW)).add(float(0.7).mul(isL)).add(float(0.62).mul(isP));
      sol.aoNode = bO.r.mul(isB).add(rO.r.mul(isR)).add(isW).add(isL).add(isP);
      sol.positionNode = decorWind();
    }
    const fol = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
    {
      const isF = isKind(kind, DK.FROND);
      const fA = ttexture(wtex('frond_albedo', { wrap: 'clamp' }), uvn), fN = ttexture(wtex('frond_normal', { wrap: 'clamp' }), uvn);
      const alb = vc.mul(mix(vec3(1), fA.rgb, isF));
      fol.colorNode = alb;
      fol.maskNode = fA.a.greaterThan(0.42).or(isF.lessThan(0.5));
      fol.normalNode = TSL.normalMap(mix(vec3(0.5, 0.5, 1), fN.xyz, isF));
      fol.thicknessColorNode = alb.mul(0.85);
      fol.thicknessDistortionNode = float(0.2);
      fol.thicknessAmbientNode = float(0.0);
      fol.thicknessAttenuationNode = float(0.9);
      fol.thicknessPowerNode = float(3.0);
      fol.thicknessScaleNode = float(3.0);
      fol.positionNode = decorWind();
    }
    return { solid: sol, foliage: fol };
  }
