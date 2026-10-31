import type { DashboardView } from '../../server/src/model.js';
import { element } from './api.js';

/** A hosted hold remains visible until its original challenge deadline. */
export class HostApproval {
  private readonly message = document.createElement('p');
  private readonly link = document.createElement('a');

  constructor() {
    this.message.className = 'muted';
    this.link.className = 'button subtle';
    this.link.textContent = 'Open approval ↗';
    this.link.target = '_blank';
    this.link.rel = 'noopener noreferrer';
    element('approval').append(this.message, this.link);
  }

  update(data: DashboardView): void {
    const pending = data.arena.pending;
    const remote = data.approval?.source === 'decionis';
    element('approval').hidden = !pending;
    if (pending)
      element('acceptTime').textContent = String(
        Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000)),
      );
    element('accept').textContent = remote ? 'Check approval ↗' : 'Let’s rumble ↗';
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
}
