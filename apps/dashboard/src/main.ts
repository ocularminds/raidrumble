import type { DashboardView } from '../../server/src/model.js';
import { Api, element, toast } from './api.js';
import { layout } from './layout.js';
import { RivalryMap } from './network.js';
import { warlord } from './warlord.js';
import { StreamControls } from './controls.js';
import { HostApproval } from './approval.js';
import { PolicyActivity } from './activity.js';
import { SetupGuide } from './setup.js';
import { avatar, twitchSummary } from './copy.js';
import { overlayBase } from './origin.js';
import './style.css';

const root = element('app');
if (location.pathname.startsWith('/warlord/')) {
  warlord(root, location.pathname.split('/')[2] ?? '');
} else {
  root.innerHTML = layout;
  dashboard();
}

function dashboard(): void {
  const hostId = new URLSearchParams(location.search).get('host') ?? 'demo';
  const host = encodeURIComponent(hostId);
  const api = new Api();
  const map = new RivalryMap(element('network'), hostId);
  let data: DashboardView | undefined;
  let populated = false;
  let busy = false;
  let refreshAllow = false;
  const streamControls = new StreamControls(hostId, api, poll);
  const approval = new HostApproval();
  const activity = new PolicyActivity();
  const setup = new SetupGuide(hostId);
  element('reset').hidden = hostId !== 'demo';
  element<HTMLIFrameElement>('preview').src = `${overlayBase}/overlay/${host}?preview=1`;

  async function poll(): Promise<void> {
    try {
      data = await api.get<DashboardView>(`/api/status/${host}`);
      element('connection').textContent =
        hostId === 'demo'
          ? 'Local arena online'
          : data.twitch.hostEventsConnected && data.twitch.chatEventsConnected
            ? 'Twitch ready'
            : 'Twitch setup incomplete';
      element('channelName').textContent =
        hostId === 'demo' ? 'Practice arena' : data.arena.hostName;
      element('avatar').textContent = avatar(hostId, data.arena.hostName);
      element('channelStatus').textContent =
        hostId === 'demo'
          ? 'LOCAL / NO ACCOUNT NEEDED'
          : data.twitch.hostConnected
            ? 'TWITCH / SIGNED IN'
            : 'TWITCH / RECONNECT';
      const active = ['active', 'pending', 'incoming'].includes(data.arena.status);
      element('matchPill').textContent =
        data.arena.practice === 'realchat'
          ? 'TEST RAID · REAL TWITCH CHAT'
          : (data.arena.match?.round?.title.toUpperCase() ??
            (data.arena.status === 'incoming'
              ? 'RAID INCOMING'
              : data.arena.status === 'pending'
                ? 'AWAITING APPROVAL'
                : 'STANDING BY'));
      for (const button of document.querySelectorAll<HTMLButtonElement>(
        '[data-scenario], #testRaid',
      ))
        button.disabled = active || busy;
      element<HTMLButtonElement>('oil').disabled =
        data.arena.match?.round?.id !== 'siege' ||
        data.arena.match?.status !== 'playing' ||
        data.budgets?.oil !== 1;
      element('oilBudget').textContent = data.budgets?.oil === 0 ? 'USED' : '1 / MATCH';
      element<HTMLAnchorElement>('openOverlay').href = `${data.overlayUrl}?preview=1`;
      approval.update(data);
      element('authState').textContent = twitchSummary(data.twitch);
      setup.update(data);
      if (!populated) {
        for (const key of ['allow', 'block', 'blockedTerms'] as const)
          element<HTMLInputElement>(key).value = data.settings[key].join(', ');
        element<HTMLTextAreaElement>('facts').value = data.settings.facts.join('\n');
        element<HTMLSelectElement>('mode').value = data.settings.mode;
        element<HTMLInputElement>('reducedMotion').checked = data.settings.reducedMotion;
        element<HTMLSelectElement>('layout').value = data.settings.layout ?? 'lower';
        element<HTMLInputElement>('sound').checked = data.settings.sound ?? false;
        populated = true;
      }
      if (refreshAllow) {
        element<HTMLInputElement>('allow').value = data.settings.allow.join(', ');
        refreshAllow = false;
      }
      activity.render(data.decisions);
      streamControls.update(data);
    } catch {
      element('connection').textContent = 'Waiting for server';
      if (!data)
        element('authState').textContent = 'The arena is offline. Reconnect when it’s ready.';
    }
  }

  async function run(task: () => Promise<unknown>, success?: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await task();
      if (success) toast(success);
      await poll();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The action could not be completed.');
    } finally {
      busy = false;
    }
  }

  function launch(scenario: string): void {
    void run(async () => {
      const result = await api.post<{ status: string; decision?: { verdict: string } }>(
        '/api/demo',
        { scenario },
      );
      if (hostId !== 'demo') location.href = '/';
      else if (result.decision?.verdict === 'BLOCK' && result.status === 'idle')
        toast('Raid blocked. Your arena stays quiet.');
    });
  }
  element('testRaid').addEventListener('click', () => launch('normal'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scenario]'))
    button.addEventListener('click', () => launch(button.dataset.scenario ?? 'normal'));
  element('accept').addEventListener('click', () => {
    const request = approval.request();
    if (!request) return;
    void run(async () => {
      const result = await api.post<{ accepted: boolean }>(`/api/approve/${host}`, request);
      if (result.accepted && request.trustNextTime) {
        refreshAllow = true;
        toast('Challenge accepted. Your trusted channels have been updated.');
      }
    });
  });
  element('decline').addEventListener('click', () => {
    void run(() => api.post(`/api/decline/${host}`));
  });
  element('oil').addEventListener('click', () => {
    void run(
      () => api.post(`/api/oil/${host}`),
      'Boiling Oil fired. Raider force is halved for 5 seconds.',
    );
  });
  element('reset').addEventListener('click', () => {
    void run(() => api.post('/api/demo/reset'), 'Practice match ended.');
  });
  element('settings').addEventListener('submit', (event) => {
    event.preventDefault();
    const list = (id: string) =>
      element<HTMLInputElement>(id)
        .value.split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    void run(
      () =>
        api.post(`/api/settings/${host}`, {
          allow: list('allow'),
          block: list('block'),
          blockedTerms: list('blockedTerms'),
          mode: element<HTMLSelectElement>('mode').value,
          reducedMotion: element<HTMLInputElement>('reducedMotion').checked,
          layout: element<HTMLSelectElement>('layout').value,
          sound: element<HTMLInputElement>('sound').checked,
          facts: element<HTMLTextAreaElement>('facts')
            .value.split('\n')
            .map((fact) => fact.trim())
            .filter(Boolean)
            .slice(0, 3),
        }),
      'Preferences saved.',
    );
  });
  const copy = () => {
    void run(async () => {
      if (!data) throw new Error('The arena is still connecting. Try again in a moment.');
      await navigator.clipboard.writeText(data.overlayUrl);
      setup.markCopied(data.overlayUrl);
    }, 'OBS browser source URL copied.');
  };
  element('copyOverlay').addEventListener('click', copy);
  element('setupCopy').addEventListener('click', copy);
  element('stepCopy').addEventListener('click', copy);
  async function graph(): Promise<void> {
    try {
      map.render(await api.get(`/api/network?host=${host}`));
    } catch {
      /* Retry without disturbing an active game. */
    }
  }
  void poll();
  void graph();
  setInterval(() => {
    void poll();
  }, 1000);
  setInterval(() => {
    void graph();
  }, 5000);
}
