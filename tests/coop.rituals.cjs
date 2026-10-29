// Co-op rituals: a joiner accepts one in its own prep screen, the host evaluates it per player and sends the result back, and a
// doctored ritual is refused. Also: an elite's chest gives a choice of runes. See coop.perf.cjs for how to run.
const { session, game, check, done } = require('./_mp.cjs');
const J = JSON.stringify;
(async () => {
  const s = await session({ viewport: { width: 480, height: 270 }, beforeReady: async (A, B) => {
    await game(B, (sc) => { const r = sc.run, S = window.__SA.rituals; window.__hp = r.player.hp; window.__acc = S.acceptRitual(r, S.RITUALS[0]); });
  } });
  const { A, B } = s;
  check((await game(B, () => window.__acc)) === null, 'the joiner accepted a ritual in its own prep screen');
  const paid = await game(B, (sc) => ({ hp: sc.run.player.hp, was: window.__hp }));
  check(paid.hp === paid.was - Math.floor(paid.was / 2), `it cost half of the joiner's health (${J(paid)})`);
  const sh = await game(A, (sc) => ({ n: sc.run.players[1].rituals.length }));
  check(sh.n === 1, `the host received the joiner's ritual with its build (${J(sh)})`);
  const fall = () => game(A, (sc) => { window.__SA.rituals.ritualEvent(sc.run.players[1], { t: 'void' }); });
  const nextRound = async () => {
    await game(B, () => window.__SA.ui.clearLayers());
    await game(B, (sc) => { sc.run.pending.length = 0; sc.run.shopOpened = true; window.__SA.ui.clearLayers(); window.__SA.ui.showPrep(sc.run); });
    await B.click('[data-a=ready]'); await B.waitForTimeout(500);
    await game(A, (sc) => { window.__SA.ui.clearLayers(); sc.run.shopOpened = true; window.__SA.ui.showPrep(sc.run); });
    await A.click('[data-a=go]'); await A.waitForTimeout(1500);
  };
  const dmg0 = await game(B, (sc) => sc.run.player.dmgMul);
  await game(A, (sc) => { sc.run.god = true; });
  await fall();
  await game(A, (sc) => sc.run.endRound());
  await B.waitForSelector('#ui > .overlay', { timeout: 15000 });
  const mid = await game(B, (sc) => sc.run.rituals.map((r) => [r.state, r.roundsDone, r.prog[0]]));
  check(J(mid) === '[["active",1,1]]', `after round 1 the ritual is a third of the way on the joiner (${J(mid)})`);
  await nextRound(); await fall(); await game(A, (sc) => sc.run.endRound()); await B.waitForTimeout(1500);
  await nextRound(); await fall(); await game(A, (sc) => sc.run.endRound()); await B.waitForTimeout(1500);
  const end = await game(B, (sc) => ({ r: sc.run.rituals.map((r) => r.state), dmg: sc.run.player.dmgMul }));
  check(end.r[0] === 'fulfilled' && Math.abs(end.dmg - (dmg0 + 0.2)) < 1e-9, `fulfilled in round 3: the reward reached the joiner (${J(end)} from ${dmg0})`);
  // a doctored ritual (wrong round count) is refused when the joiner readies
  await game(B, (sc) => { sc.run.rituals.push({ def: { id: 'fall', name: 'cheat', icon: '?', rounds: 1, challenge: '', reward: '' }, startRound: 1, roundsDone: 0, prog: [0], state: 'active', why: '' }); });
  await game(B, (sc) => { window.__SA.ui.clearLayers(); sc.run.shopOpened = true; window.__SA.ui.showPrep(sc.run); });
  await game(B, (sc) => { sc.coop.setReady(true); }); await B.waitForTimeout(800);
  const ready = await game(A, (sc) => [...sc.coop.guests.values()].map((g) => g.ready));
  check(ready[0] === false, `the host refuses a doctored ritual (${J(ready)})`);
  // elite chest
  await game(A, (sc) => { sc.run.god = true; const r = sc.run; const pr = r.players[0]; pr.pending.length = 0; pr.pushPending({ type: 'cache', chest: true }); });
  const kinds = await game(A, (sc) => { const R = window.__SA; return R.generateRewards(sc.run, 'chest').map((x) => R.RUNE_BY_ID[x.rune].kind); });
  check(kinds.length === 3 && ['core', 'form'].includes(kinds[0]) && ['trigger', 'behavior'].includes(kinds[1]), `an elite chest offers a form/core, a trigger/behavior and one more (${J(kinds)})`);
  check(s.errs.length === 0, `no page errors ${s.errs.slice(0, 2)}`);
  await s.close();
  done();
})();
