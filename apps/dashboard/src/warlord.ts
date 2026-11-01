import { Api, element, toast } from './api.js';
import { warlordState, type WarlordView } from './copy.js';

export function warlord(root: HTMLElement, token: string): void {
  root.innerHTML = `<div class="warlord"><span class="eyebrow">▲ THE WARLORD’S CONTROL</span><h1>LEAD THE<br>CHARGE.</h1><p id="warlordName">One strike. Make it count.</p><div class="ramArt" aria-hidden="true">▲</div><button id="ram" class="button primary" disabled>FIRE BATTERING RAM</button><a id="warlordLogin" class="button subtle">Log In as the Raiding Streamer</a><p class="muted" id="warlordStatus">Connecting to your match…</p><p class="muted">Double your team’s force for 5 seconds.<br>One use per match, during Siege.</p></div><div id="toast" class="toast" role="status" hidden></div>`;
  const api = new Api();
  let pending = false;
  let used = false;
  let matchId: string | undefined;
  async function poll(): Promise<void> {
    try {
      const view = await api.get<WarlordView>(`/api/warlord/${encodeURIComponent(token)}`);
      if (view.matchId !== matchId) {
        matchId = view.matchId;
        used = false;
      }
      element('warlordName').textContent = `${view.raiderName}, your community is counting on you.`;
      element<HTMLAnchorElement>('warlordLogin').href = view.loginUrl;
      element('warlordLogin').hidden = view.authorized;
      if (view.authorized && view.active && !view.available) used = true;
      const state = warlordState(view, pending, used);
      element<HTMLButtonElement>('ram').disabled = state.disabled;
      element('ram').textContent = state.label;
      element('warlordStatus').textContent = view.simulated
        ? `LOCAL PRACTICE · ${state.message}`
        : state.message;
    } catch {
      element<HTMLButtonElement>('ram').disabled = true;
      element('warlordStatus').textContent =
        'This match link has expired or the server is offline.';
    }
  }
  element('ram').addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    element<HTMLButtonElement>('ram').disabled = true;
    try {
      await api.post(`/api/warlord/${encodeURIComponent(token)}`);
      used = true;
      element('ram').textContent = 'RAM USED ✓';
      toast('Battering Ram fired. Rally your Raiders!');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The special could not be fired.');
    } finally {
      pending = false;
      await poll();
    }
  });
  void poll();
  setInterval(() => {
    void poll();
  }, 1000);
}
