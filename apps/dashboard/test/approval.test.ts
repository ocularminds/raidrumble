import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostApproval } from '../src/approval.js';
import { dashboard, dom } from './fixture.js';

afterEach(() => vi.unstubAllGlobals());

describe('Explicit trust on host approval', () => {
  it('shows the current gated community and viewers and defaults to one-time approval', () => {
    const f = dom();
    const view = dashboard();
    view.arena.pending = {
      decisionId: 'one',
      expiresAt: Date.now() + 10_000,
      viewers: 21,
      raiderLogin: 'speed',
    };
    const control = new HostApproval();
    control.update(view);
    expect(f.element('acceptName').textContent).toBe('Speed');
    expect(f.element('acceptAudience').textContent).toBe('21 viewers');
    expect(f.element('trustLabel').textContent).toBe('Trust Speed next time');
    expect(control.request()).toEqual({ decisionId: 'one', trustNextTime: false });
    f.element('trustNextTime').checked = true;
    control.update(view);
    expect(control.request()).toEqual({ decisionId: 'one', trustNextTime: true });
  });

  it('never carries trust to a new decision, an expired request, or live-chat practice', () => {
    const f = dom();
    const view = dashboard();
    view.arena.pending = {
      decisionId: 'one',
      expiresAt: Date.now() + 10_000,
      raiderLogin: 'speed',
      viewers: 1,
    };
    const control = new HostApproval();
    control.update(view);
    expect(f.element('acceptAudience').textContent).toBe('1 viewer');
    f.element('trustNextTime').checked = true;
    view.arena.pending.decisionId = 'two';
    control.update(view);
    expect(control.request()).toEqual({ decisionId: 'two', trustNextTime: false });
    f.element('trustNextTime').checked = true;
    view.arena.practice = 'realchat';
    control.update(view);
    expect(f.element('trustNextTime').disabled).toBe(true);
    expect(control.request()?.trustNextTime).toBe(false);
    view.arena.pending.expiresAt = Date.now() - 1;
    control.update(view);
    expect(control.request()).toBeUndefined();
  });
});
