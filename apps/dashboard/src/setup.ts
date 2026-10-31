import type { DashboardView } from '../../server/src/model.js';
import { apiBase, element } from './api.js';
import { twitchSummary } from './copy.js';

/** Per-channel setup progress; the OBS step is complete only after a successful clipboard write. */
export class SetupGuide {
  private copiedUrl = '';
  private expanded = false;
  private data?: DashboardView;
  private readonly key: string;

  constructor(hostId: string) {
    this.key = `raidrumble.obs.${hostId}`;
    try {
      this.copiedUrl = localStorage.getItem(this.key) ?? '';
    } catch {
      /* Private browsing. */
    }
    for (const id of ['authHost', 'connectHost', 'stepHost'])
      element<HTMLAnchorElement>(id).href = `${apiBase}/auth/host`;
    for (const id of ['authBot', 'stepBot'])
      element<HTMLAnchorElement>(id).href = `${apiBase}/auth/bot`;
    element('reviewSetup').addEventListener('click', () => {
      this.expanded = !this.expanded;
      if (this.data) this.update(this.data);
    });
  }

  markCopied(url: string): void {
    this.copiedUrl = url;
    try {
      localStorage.setItem(this.key, url);
    } catch {
      /* Keep progress for this visit. */
    }
    if (this.data) this.update(this.data);
  }

  update(data: DashboardView): void {
    this.data = data;
    const twitch = data.twitch;
    const copied = this.copiedUrl === data.overlayUrl;
    const ready =
      twitch.hostConnected &&
      twitch.botConnected &&
      twitch.hostEventsConnected &&
      twitch.chatEventsConnected &&
      copied;
    element('setupSteps').hidden = ready && !this.expanded;
    element('reviewSetup').hidden = !ready;
    element('reviewSetup').textContent = this.expanded ? 'Hide Setup' : 'Review Setup';
    element('reviewSetup').setAttribute('aria-expanded', String(this.expanded));
    element('setupTitle').textContent = ready
      ? 'You’re ready for the next raid.'
      : 'Go live in three steps.';
    element('stepHost').textContent = twitch.hostConnected
      ? '1. Host Connected ✓'
      : '1. Connect Host';
    element('stepBot').textContent = twitch.botConnected ? '2. Bot Connected ✓' : '2. Connect Bot';
    element('stepCopy').textContent = copied ? '3. OBS URL Copied ✓' : '3. Copy OBS URL';
    element('setupNotice').textContent = twitchSummary(twitch);
    element('setupNotice').hidden = ready && !this.expanded;
    for (const id of ['authHost', 'connectHost', 'stepHost', 'authBot', 'stepBot']) {
      const link = element<HTMLAnchorElement>(id);
      link.setAttribute('aria-disabled', String(!twitch.configured));
      if (twitch.configured) link.href = `${apiBase}/auth/${id.endsWith('Bot') ? 'bot' : 'host'}`;
      else link.removeAttribute('href');
    }
  }
}
