import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../../dashboard/src/api.js';
import { StreamControls } from '../../dashboard/src/controls.js';

/** A minimal DOM surface for observing the controls' real click handlers. */
class ControlElement {
  hidden = false;
  disabled = false;
  href = '';
  rel = '';
  target = '';
  innerHTML = '';
  textContent = '';
  className = '';
  private readonly listeners = new Map<string, () => void>();
  addEventListener(event: string, callback: () => void): void {
    this.listeners.set(event, callback);
  }
  append(): void {}
  click(): void {
    this.listeners.get('click')?.();
  }
  removeAttribute(name: string): void {
    if (name === 'href') this.href = '';
  }
}

function fixture() {
  const elements = new Map<string, ControlElement>();
  const element = (id: string): ControlElement => {
    if (!elements.has(id)) elements.set(id, new ControlElement());
    return elements.get(id)!;
  };
  vi.stubGlobal('document', {
    createElement: () => new ControlElement(),
    getElementById: element,
  });
  const api = new Api();
  const get = vi.spyOn(api, 'get').mockResolvedValue({ configured: false });
  const post = vi.spyOn(api, 'post');
  const refresh = vi.fn(async () => undefined);
  const decision = { decisionId: 'local1', verdict: 'ESCALATE', source: 'local' };
  const expiresAt = Date.now() + 10_000;
  return { element, api, get, post, refresh, decision, expiresAt };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Reward approval controls', () => {
  it('keeps a hosted hold visible and reports success only after configuration', async () => {
    const f = fixture();
    const held = {
      configured: false,
      pending: true,
      decision: {
        decisionId: 'hosted1',
        verdict: 'ESCALATE',
        source: 'decionis',
        approval: { url: 'https://presence.example/review/reward', expiresAt: f.expiresAt },
      },
      expiresAt: f.expiresAt,
    };
    f.post
      .mockResolvedValueOnce({ decision: f.decision, expiresAt: f.expiresAt })
      .mockResolvedValueOnce(held)
      .mockResolvedValueOnce({ configured: true, rewardId: 'reward1' });
    new StreamControls('10', f.api, f.refresh);
    f.element('configureReward').click();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
    f.element('approveReward').click();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(2));
    expect(f.element('rewardApproval').hidden).toBe(false);
    expect(f.element('toast').textContent).not.toContain('is ready');
    expect(f.element('rewardLink').href).toBe(held.decision.approval.url);
    expect(f.element('rewardLink').hidden).toBe(false);
    expect(f.element('approveReward').textContent).toBe('Check approval');
    f.element('approveReward').click();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(3));
    expect(f.post).toHaveBeenLastCalledWith('/api/rewards/10/approve', {
      decisionId: 'hosted1',
    });
    expect(f.element('rewardApproval').hidden).toBe(true);
    expect(f.element('toast').textContent).toBe('Reinforcements is ready on your channel.');
  });

  it('restores a host-only pending proposal without approving it', async () => {
    const f = fixture();
    f.get.mockResolvedValue({
      configured: false,
      pending: {
        decision: {
          ...f.decision,
          source: 'decionis',
          approval: { url: 'https://presence.example/review/reward', expiresAt: f.expiresAt },
        },
        expiresAt: f.expiresAt,
      },
    });
    new StreamControls('10', f.api, f.refresh);
    await vi.waitFor(() => expect(f.get).toHaveBeenCalledWith('/api/rewards/10'));
    expect(f.element('rewardApproval').hidden).toBe(false);
    expect(f.element('rewardLink').href).toBe('https://presence.example/review/reward');
    expect(f.post).not.toHaveBeenCalled();
  });
});
