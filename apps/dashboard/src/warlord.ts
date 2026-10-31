import { Api, element, toast } from './api.js';

interface WarlordView {
  authorized: boolean;
  active: boolean;
  available: boolean;
  loginUrl: string;
  raiderName: string;
  simulated: boolean;
}

export function warlord(root: HTMLElement, token: string): void {
  root.innerHTML = `<div class="warlord"><span class="eyebrow">▲ THE WARLORD’S CONTROL</span><h1>MAKE YOUR<br>ENTRANCE.</h1><p id="warlordName">One strike. Make it count.</p><div class="ramArt" aria-hidden="true">▲</div><button id="ram" class="button primary" disabled>FIRE BATTERING RAM ↗</button><a id="warlordLogin" class="button subtle">Log in as the raiding streamer ↗</a><p class="muted" id="warlordStatus">Connecting to your match…</p><p class="muted">Double your team’s force for 5 seconds.<br>One use per match, during Siege.</p></div><div id="toast" class="toast" role="status" hidden></div>`;
  const api = new Api();
  let pending = false;
  async function poll(): Promise<void> {
    try {
      const view = await api.get<WarlordView>(`/api/warlord/${encodeURIComponent(token)}`);
      element('warlordName').textContent = `${view.raiderName}, your community is counting on you.`;
      element<HTMLAnchorElement>('warlordLogin').href = view.loginUrl;
      element('warlordLogin').hidden = view.authorized;
      element<HTMLButtonElement>('ram').disabled =
        !view.authorized || !view.active || !view.available || pending;
      const state = !view.authorized
        ? 'Your Twitch identity must match the raiding streamer.'
        : !view.active
          ? 'Waiting for Siege.'
          : view.available
            ? 'Your Battering Ram is ready.'
            : 'Battering Ram used. Rally your Raiders!';
      element('warlordStatus').textContent = view.simulated ? `LOCAL PRACTICE · ${state}` : state;
    } catch {
      element('warlordStatus').textContent =
        'This match link has expired or the server is offline.';
    }
  }
  element('ram').addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    try {
      await api.post(`/api/warlord/${encodeURIComponent(token)}`);
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
