// The Rituals block on the round-prep screen: the running rituals, and those on offer (see game/rituals.ts).
import { audio } from '../core/audio';
import { acceptRitual, availableRituals, claimPurity, purityPending, PURITY_CAP, ritualCost, ritualNote, ritualProgress } from '../game/rituals';
import type { Run } from '../game/run';
import { el } from './ui';

export function ritualSection(run: Run, onChange: () => void): HTMLElement {
  const n = el('<div class="ritsec"></div>');
  let msg = '';
  let bad = false;
  const render = () => {
    const cost = ritualCost(run);
    const offers = availableRituals(run).map((d) => `<div class="scard ritoffer ${cost >= 1 ? 'aff' : 'poor'}" data-rit="${d.id}" style="--rc:#c9a6ff;--c:#c9a6ff">
        <div class="sci">${d.icon}</div><div class="scn">${d.name}</div><div class="scr">${d.rounds} rounds</div>
        <ul class="ritobj"><li>${d.challenge}</li>${ritualNote(run, d) ? `<li class="ritnote"><b>${ritualNote(run, d)}</b></li>` : ''}</ul><p><b>Reward:</b> ${d.reward}.</p><div class="sprice">ACCEPT ♥ ${cost}</div></div>`).join('');
    const active = run.rituals.filter((r) => r.state === 'active').map((r) => `<div class="ritactive"><b>${r.def.icon} ${r.def.name}</b> <small>${r.roundsDone}/${r.def.rounds} rounds done</small>
        <ul class="ritobj"><li class="${r.prog[0] >= r.def.rounds ? 'met' : ''}">${r.def.challenge} <em>${ritualProgress(r, run)}</em></li></ul><small>Reward: ${r.def.reward}.</small></div>`).join('');
    const done = run.rituals.filter((r) => r.state !== 'active').map((r) => `<span class="ritdone ${r.state}" title="${r.def.reward}">${r.def.icon} ${r.def.name}: ${r.state === 'fulfilled' ? `✔ complete · ${r.def.reward}` : `✖ lapsed${r.why ? ` (${r.why})` : ''}`}</span>`).join('');
    const pick = purityPending(run) ? `<div class="picker"><b>🕯️ Oath of Purity: +${Math.round(PURITY_CAP * 100)}% capacity for?</b>${run.spells.map((s, i) => `<button data-pure="${i}">${i + 1}. ${s.def.root ? s.c.name : 'Empty'} <small>${s.c.cost}/${s.def.capacity} → ${s.def.capacity + Math.max(1, Math.round(s.def.capacity * PURITY_CAP))}</small></button>`).join('')}</div>` : '';
    n.innerHTML = `<h4>RITUAL <small>a short challenge for a permanent upgrade. It costs half of your current health; miss a round and it lapses.</small></h4>
      ${pick}${active}${done ? `<div class="ritdones">${done}</div>` : ''}
      ${offers ? `<div class="scards">${offers}</div>` : ''}
      ${msg ? `<div class="shmsg ${bad ? 'bad' : ''}">${msg}</div>` : ''}`;
  };
  n.addEventListener('click', (e) => {
    const pu = (e.target as HTMLElement).closest('[data-pure]') as HTMLElement | null;
    if (pu) {
      const err = claimPurity(run, Number(pu.dataset.pure));
      bad = !!err; msg = err ?? 'Capacity increased.';
      audio.play(err ? 'warn' : 'pick');
      render(); onChange();
      return;
    }
    const rt = (e.target as HTMLElement).closest('[data-rit]') as HTMLElement | null;
    if (!rt) return;
    const d = availableRituals(run).find((x) => x.id === rt.dataset.rit);
    const err = d ? acceptRitual(run, d) : 'Gone.';
    bad = !!err;
    msg = err ?? `${d!.name} accepted. It begins with the next round.`;
    audio.play(err ? 'warn' : 'level');
    render(); onChange();
  });
  render();
  return n;
}
