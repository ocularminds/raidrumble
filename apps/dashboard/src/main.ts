import type { DashboardView } from '../../server/src/model.js';
import { Api, apiBase, element, toast } from './api.js';
import { layout } from './layout.js';
import { RivalryMap } from './network.js';
import { warlord } from './warlord.js';
import { StreamControls } from './controls.js';
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
  const streamControls = new StreamControls(hostId, api, poll);
  const authUrl = `${apiBase}/auth/host`;
  element<HTMLAnchorElement>('authHost').href = authUrl;
  element<HTMLAnchorElement>('connectHost').href = authUrl;
  element<HTMLAnchorElement>('authBot').href = `${apiBase}/auth/bot`;
  element<HTMLIFrameElement>('preview').src =
    `${import.meta.env.VITE_OVERLAY_URL ?? 'http://localhost:5173'}/overlay/${host}?preview=1`;

  async function poll(): Promise<void> {
    try {
      data = await api.get<DashboardView>(`/api/status/${host}`);
      element('connection').textContent =
        hostId === 'demo' ? 'Local arena online' : 'Channel connected';
      element('channelName').textContent =
        hostId === 'demo' ? 'Practice arena' : data.arena.hostName;
      element('channelStatus').textContent =
        hostId === 'demo' ? 'LOCAL / NO ACCOUNT NEEDED' : 'TWITCH / CONNECTED';
      const active = data.arena.status === 'active' || data.arena.status === 'pending';
      element('matchPill').textContent =
        data.arena.match?.round?.title.toUpperCase() ??
        (data.arena.status === 'pending' ? 'AWAITING APPROVAL' : 'STANDING BY');
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
      element('approval').hidden = !data.arena.pending;
      if (data.arena.pending)
        element('acceptTime').textContent = String(
          Math.max(0, Math.ceil((data.arena.pending.expiresAt - Date.now()) / 1000)),
        );
      element('authState').textContent = data.twitch.configured
        ? `${data.twitch.hostConnected ? 'Host connected' : 'Host not connected'} · ${data.twitch.botConnected ? 'Bot connected' : 'Bot not connected'}`
        : 'Set TWITCH_* in .env to connect real channels.';
      if (!populated) {
        for (const key of ['allow', 'block', 'blockedTerms'] as const)
          element<HTMLInputElement>(key).value = data.settings[key].join(', ');
        element<HTMLTextAreaElement>('facts').value = data.settings.facts.join('\n');
        element<HTMLSelectElement>('mode').value = data.settings.mode;
        element<HTMLInputElement>('reducedMotion').checked = data.settings.reducedMotion;
        populated = true;
      }
      renderDecisions(data);
      streamControls.update(data);
    } catch {
      element('connection').textContent = 'Waiting for server';
      if (!data) element('authState').textContent = 'Run pnpm dev to bring the arena online.';
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
      const ownPreview = hostId !== 'demo' && scenario === 'normal';
      const result = await api.post<{ status: string; decision?: { verdict: string } }>(
        ownPreview ? `/api/test/${host}` : '/api/demo',
        { scenario },
      );
      if (hostId !== 'demo' && !ownPreview) location.href = '/';
      else if (result.decision?.verdict === 'BLOCK' && result.status === 'idle')
        toast('Raid blocked. Your arena stays quiet.');
    });
  }
  element('testRaid').addEventListener('click', () => launch('normal'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scenario]'))
    button.addEventListener('click', () => launch(button.dataset.scenario ?? 'normal'));
  element('accept').addEventListener('click', () => {
    void run(() =>
      api.post(`/api/approve/${host}`, { decisionId: data?.arena.pending?.decisionId }),
    );
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
    }, 'OBS browser source URL copied.');
  };
  element('copyOverlay').addEventListener('click', copy);
  element('setupCopy').addEventListener('click', copy);
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

function renderDecisions(data: DashboardView): void {
  const container = element('decisions');
  element('decisionCount').textContent = `${data.decisions.length} RECENT DECISIONS`;
  if (!data.decisions.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Run a test raid to see the gate in action.';
    container.replaceChildren(empty);
    return;
  }
  const labels: Record<string, string> = {
    'rumble.start': 'Raid requested',
    'rumble.start.collab': 'Collab requested',
    'special.fire': 'Special requested',
    'ledger.settle': 'Match recorded',
    'events.subscribe': 'Chat connection',
    'chat.send': 'Chat announcement',
    'shoutout.send': 'Community shoutout',
  };
  container.replaceChildren(
    ...data.decisions.slice(0, 15).map((decision) => {
      const row = document.createElement('div');
      row.className = 'decision';
      row.title = decision.decisionId;
      const tag = document.createElement('span');
      tag.className = `tag ${decision.verdict.toLowerCase()}`;
      tag.textContent = decision.verdict;
      const text = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = labels[decision.action] ?? decision.action;
      const reason = document.createElement('small');
      reason.textContent = decision.reasonCodes.join(' · ').replaceAll('_', ' ').toLowerCase();
      text.append(title, reason);
      const mode = document.createElement('span');
      mode.className = 'mode';
      mode.textContent = decision.mode === 'shadow' ? 'SHADOW' : 'ENFORCED';
      row.append(tag, text, mode);
      return row;
    }),
  );
}
