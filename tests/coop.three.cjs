// Three (or more) player co-op under load: what changes when a second joiner arrives? Measures, for a host and N joiners in
// separate browser processes over real loopback WebRTC:
//   * host upload (bytes/s to all joiners), snapshots skipped because a joiner's channel was backed up, peak queued bytes
//   * steadiness of ANOTHER joiner's wizard as drawn on a joiner (Bob walks, Carol watches): coefficient of variation of the
//     per-frame displacement, compared with how the host draws Bob and how Bob's own screen draws him
//   * host and joiner frame times
// Frame times in this rig are CPU-bound by the software renderer (4 shared cores); compare the 1-joiner and 2-joiner rows, not
// the absolute numbers.
//   npm run build && npx vite preview --port 4173 &
//   (cd worker && npx wrangler dev --local --port 8799) &
//   NODE_PATH=$(npm root -g) node tests/coop.three.cjs        (EXTRA=0 for the 2-player baseline, ENEMIES=300, SECS=8)
const { session, game, check, done, stats, install, read, frameDeltas } = require('./_mp.cjs');
const J = JSON.stringify;
const EXTRA = Number(process.env.EXTRA ?? 1);
const ENEMIES = Number(process.env.ENEMIES || (EXTRA ? 300 : 210));
const SECS = Number(process.env.SECS || 8);
const [loss, delay, jitter] = process.env.NETSIM ? process.env.NETSIM.split(',').map(Number) : [0, 0, 0];

(async () => {
  console.log(`\n=== ${2 + EXTRA} players, ${ENEMIES} enemies, ${SECS}s, netsim ${loss}% ${delay}±${jitter} ms ===`);
  const s = await session({ extra: EXTRA });
  const { A, B, C } = s;
  const watcher = C || B; // the joiner that watches Bob walk (with 2 players that is Bob himself, who only sees the host)
  for (const P of [A, B, C].filter(Boolean)) { await P.evaluate((x) => { window.__netsim = x; }, { loss, delay, jitter }); await install(P); }
  await game(A, (sc) => { sc.run.god = true; });
  await game(A, (sc, n) => {
    const r = sc.run, S = window.__SA;
    r.dtime = 200;
    while (r.spells.length < 4) r.addSlot();
    const combos = [['f_orb', 'c_fire'], ['f_beam', 'c_ice'], ['f_nova', 'c_lightning'], ['f_aura', 'c_poison']];
    r.spells.forEach((sp, i) => { sp.def.capacity = 40; const root = S.newNode(combos[i][0]); root.children.push(S.newNode(combos[i][1])); sp.def.root = root; sp.c = S.compileSpell(sp.def); r.recomputeMut(sp); sp.cd = 0; });
    const T = ['grunt', 'swarmer', 'archer', 'charger', 'armored'];
    window.__swarm = setInterval(() => { let k = 0; for (const e of r.enemies) if (!e.dead) k++; for (let i = k; i < n; i++) { const a = Math.random() * 6.28; S.spawnEnemy(r, T[i % 5], r.player.x + Math.cos(a) * 330, r.player.y + Math.sin(a) * 330); } for (const p of r.players) p.player.hp = Math.max(p.player.hp, 40); }, 300);
  }, ENEMIES);
  const bobPid = await game(B, (sc) => sc.coop.pid);
  // per-frame positions of Bob as each screen draws him
  const probe = (P, how) => game(P, (sc, how2) => {
    const g = window.__SA_GAME, pos = (window.__bob = []);
    g.events.on('postrender', () => {
      const t = performance.now();
      if (how2.kind === 'host') { const gr = [...sc.coop.guests.values()][0]; const s2 = sc.coop.sprites.get(gr.shell); if (s2) pos.push([t, s2.spr.x, s2.spr.y]); }
      else if (how2.kind === 'replica') { const o = sc.coop.replica.players.get(how2.pid); if (o && o.spr.visible) pos.push([t, o.spr.x, o.spr.y]); }
      else pos.push([t, sc.coop.pred.x, sc.coop.pred.y]);
    });
  }, how);
  await probe(A, { kind: 'host' });
  if (C) await probe(C, { kind: 'replica', pid: bobPid });
  await probe(B, { kind: 'self' });
  const rep0 = await game(A, (sc) => ({ ...sc.coop.rep.stats, t: performance.now() }));
  // Bob walks back and forth along one axis for SECS seconds
  const t0 = Date.now(); let flip = 0;
  while (Date.now() - t0 < SECS * 1000) { const k = flip++ % 2 ? 'a' : 'd'; await B.keyboard.down(k); await B.waitForTimeout(900); await B.keyboard.up(k); }
  const rep1 = await game(A, (sc) => ({ ...sc.coop.rep.stats, t: performance.now() }));
  const info = await game(A, (sc) => sc.coop.netInfo());
  const sec = (rep1.t - rep0.t) / 1000;
  const kb = (k) => ((rep1[k] - rep0[k]) / sec / 1024).toFixed(0);
  console.log(` host upload: ${kb('stBytes')} KB/s state + ${kb('fxBytes')} KB/s effects to ${1 + EXTRA} joiner(s); snapshots/s ${((rep1.snaps - rep0.snaps) / sec).toFixed(1)}; skipped (joiner backed up) ${rep1.skipped - rep0.skipped}; ${rep1.enemies} enemies, ${rep1.imgs} sprites`);
  console.log(` host replication cost: ${((rep1.cpuSum - rep0.cpuSum) / (rep1.snaps - rep0.snaps)).toFixed(2)} ms/snapshot (all joiners)`);
  for (const [k, v] of Object.entries(info)) if (k !== 'snap' && v.st) console.log(` link to ${k}: st queued max ${v.st.maxBuffered} B, skipped ${v.st.skipped}; fx skipped ${v.fx.skipped}; cmd queue ${v.cmdQueue}`);
  // Bob walks at constant speed, so his drawn x against WALL-CLOCK time should be a straight line in each walk. The RMS distance
  // from the best-fit line (px) and the worst miss are independent of the rig's frame time: they measure only how unevenly the
  // position was fed to the screen. Segments are split where the direction reverses; the first and last 250 ms of each are dropped.
  const smooth = (rows) => {
    // direction of travel at each sample over a 200 ms window: -1, 0 (standing) or +1
    const dir = rows.map((r, i) => { let j = i; while (j > 0 && r[0] - rows[j][0] < 200) j--; const v = r[1] - rows[j][1]; return Math.abs(v) < 20 ? 0 : Math.sign(v); });
    const segs = []; let cur = [];
    for (let i = 0; i < rows.length; i++) { if (cur.length && dir[i] !== dir[i - 1]) { segs.push([cur, dir[i - 1]]); cur = []; } cur.push(rows[i]); }
    if (cur.length) segs.push([cur, dir[rows.length - 1]]);
    let n = 0, ss = 0, worst = 0, used = 0, speed = 0;
    for (const [sg, d] of segs) {
      if (!d || sg.length < 6) continue;
      const t0 = sg[0][0] + 200, t1 = sg[sg.length - 1][0] - 100, pts = sg.filter((r) => r[0] >= t0 && r[0] <= t1);
      if (pts.length < 5 || t1 - t0 < 250) continue;
      const mt = pts.reduce((a, r) => a + r[0], 0) / pts.length, mx = pts.reduce((a, r) => a + r[1], 0) / pts.length;
      let sxy = 0, sxx = 0; for (const r of pts) { sxy += (r[0] - mt) * (r[1] - mx); sxx += (r[0] - mt) ** 2; }
      const k = sxy / (sxx || 1);
      used++; speed += Math.abs(k) * 1000;
      for (const r of pts) { const e = r[1] - (mx + k * (r[0] - mt)); ss += e * e; n++; if (Math.abs(e) > worst) worst = Math.abs(e); }
    }
    return { rows: rows.length, walks: used, samples: n, speed: +(speed / (used || 1)).toFixed(0), rmsPx: +Math.sqrt(ss / (n || 1)).toFixed(2), worstPx: +worst.toFixed(1) };
  };
  const rowsA = await game(A, () => window.__bob), rowsB = await game(B, () => window.__bob), rowsC = C ? await game(C, () => window.__bob) : [];
  console.log(` Bob as drawn on host:   ${J(smooth(rowsA))}`);
  console.log(` Bob on his own screen:  ${J(smooth(rowsB))}`);
  if (C) console.log(` Bob as drawn on Carol:  ${J(smooth(rowsC))}`);
  for (const [n, P] of [['host', A], ['bob', B], ['carol', C]]) if (P) console.log(` frame ms ${n}: ${J(stats(frameDeltas((await read(P)).t)))}`);
  const ni = await game(watcher, (sc) => sc.coop.netInfo());
  console.log(` watcher net: delay ${ni.net.delay.toFixed(0)} ms, jitter ${ni.net.jitter.toFixed(1)}, stalls ${ni.net.stalls}, lost ${ni.net.lost}, partial ${ni.net.incomplete}, complete ${ni.net.complete}, rtt ${ni.net.rtt.toFixed(0)}`);
  check(s.errs.length === 0, `no page errors ${s.errs.slice(0, 2)}`);
  await s.close();
  done();
})();
