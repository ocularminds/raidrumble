import type { DashboardView } from '../../server/src/model.js';
import { element } from './api.js';
import { plural } from './copy.js';

/** A hosted hold remains visible until its original challenge deadline. */
export class HostApproval {
  private readonly message = document.createElement('p');
  private readonly link = document.createElement('a');
  private pending?: NonNullable<DashboardView['arena']['pending']>;
  private decisionId?: string;

  constructor() {
    this.message.className = 'muted';
    this.link.className = 'button subtle';
    this.link.textContent = 'Open Approval ↗';
    this.link.target = '_blank';
    this.link.rel = 'noopener noreferrer';
    element('approval').append(this.message, this.link);
  }

  update(data: DashboardView): void {
    const pending = data.arena.pending;
    const checkbox = element<HTMLInputElement>('trustNextTime');
    if (pending?.decisionId !== this.decisionId) checkbox.checked = false;
    this.pending = pending;
    this.decisionId = pending?.decisionId;
    checkbox.disabled = !pending?.raiderLogin || data.arena.practice === 'realchat';
    element('trustLabel').textContent = `Trust ${data.arena.raiderName} next time`;
    element('acceptName').textContent = data.arena.raiderName;
    element('acceptAudience').textContent =
      pending?.viewers === undefined ? 'their community' : plural(pending.viewers, 'viewer');
    const remote = data.approval?.source === 'decionis';
    element('approval').hidden = !pending;
    if (pending)
      element('acceptTime').textContent = String(
        Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000)),
      );
    element('accept').textContent = remote ? 'Check Approval' : 'Let’s Rumble';
    element<HTMLButtonElement>('accept').disabled = !pending || pending.expiresAt <= Date.now();
    this.message.hidden = !remote;
    this.message.textContent = remote
      ? 'Decionis is holding this challenge. Complete approval in your connected authority, then check again before the timer expires.'
      : '';
    this.link.hidden = true;
    this.link.removeAttribute('href');
    if (!remote || !data.approval?.url || data.approval.expiresAt <= Date.now()) return;
    try {
      const url = new URL(data.approval.url);
      if (url.protocol !== 'https:' || url.username || url.password) return;
      this.link.href = url.toString();
      this.link.hidden = false;
    } catch {
      // A missing or malformed authority link never becomes a guessed destination.
    }
  }

  request(): { decisionId: string; trustNextTime: boolean } | undefined {
    if (!this.pending || this.pending.expiresAt <= Date.now()) return undefined;
    const checkbox = element<HTMLInputElement>('trustNextTime');
    return {
      decisionId: this.pending.decisionId,
      trustNextTime: checkbox.checked && !checkbox.disabled,
    };
  }
}
