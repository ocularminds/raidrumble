import { describe, expect, it, vi } from 'vitest';
import { DecionisGate, LocalPolicyGate, defaultPolicy, type Decision } from '@raidrumble/policy';
import { demoChannels } from '@raidrumble/content';
import { Ledger } from '@raidrumble/ledger';
import { authorityConfig } from '../src/services/authority.js';
import { Room } from '../src/services/room.js';
import { Rooms } from '../src/services/rooms.js';
import { SettingsStore } from '../src/services/settings.js';

describe('authority configuration', () => {
  it('keeps local judge mode independent of hosted credentials', () => {
    expect(authorityConfig({ DECIONIS_API_KEY: 'runtime' }).gateKind).toBe('local');
  });

  it('separates authority runtime keys from gateway and policy credentials', () => {
    const config = authorityConfig({
      POLICY_GATE: 'decionis',
      DECIONIS_API_BASE: 'https://api.decionis.com',
      DECIONIS_ORG_ID: 'organization',
      DECIONIS_API_KEY: 'runtime',
      DECIONIS_ENFORCE_API_KEY: 'enforce',
      DECIONIS_POLICY_API_KEY: 'must-not-enter-runtime',
      AGENTSAFE_TENANT_KEY: 'must-not-enter-authority',
      DECIONIS_GATEWAY_URL: 'https://proxy.decionisedge.com',
      DECIONIS_MODE: 'ENFORCEMENT',
    });
    expect(config).toEqual({
      gateKind: 'decionis',
      initialMode: 'enforce',
      decionis: {
        apiBase: 'https://api.decionis.com',
        apiKey: 'runtime',
        enforceApiKey: 'enforce',
        orgId: 'organization',
      },
    });
    expect(JSON.stringify(config)).not.toContain('must-not-enter');
  });

  it('defaults new hosted installs to shadow and rejects ambiguous modes', () => {
    expect(authorityConfig({ POLICY_GATE: 'decionis' }).initialMode).toBe('shadow');
    expect(() => authorityConfig({ POLICY_GATE: 'decionis', DECIONIS_MODE: 'PARALLEL' })).toThrow(
      'DECIONIS_MODE',
    );
  });

  it('normalizes the existing live deployment label to enforcement', () => {
    expect(authorityConfig({ POLICY_GATE: 'decionis', DECIONIS_MODE: 'live' }).initialMode).toBe(
      'enforce',
    );
  });

  it('keeps the judge room local when real channels use hosted authority', async () => {
    const ledger = new Ledger(':memory:');
    const rooms = new Rooms({
      ledger,
      settings: new SettingsStore(),
      gateKind: 'decionis',
      quiet: true,
    });
    try {
      rooms.addHost({ ...demoChannels.host, id: 'realhost' });
      expect(rooms.get('demo').gate).toBeInstanceOf(LocalPolicyGate);
      expect(rooms.get('demo').gate).not.toBeInstanceOf(DecionisGate);
      expect(rooms.get('realhost').gate).toBeInstanceOf(DecionisGate);
      await rooms.demo('normal');
      expect(rooms.get('demo').view().status).toBe('active');
    } finally {
      await rooms.close();
      ledger.close();
    }
  });
});

describe('hosted match holds', () => {
  it('refuses a remote allow that arrives after the original challenge expires', async () => {
    let now = 1000;
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const room = new Room({ hostId: 'host', config, quiet: true, now: () => now });
    const decision = await room.raid({
      channels: demoChannels,
      raiderLogin: 'stranger',
      accountAgeDays: 300,
      hostFollowsRaider: false,
      viewers: 300,
      simulated: true,
    });
    let release!: (value: Decision) => void;
    let entered!: () => void;
    const approving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(room.gate, 'approve').mockImplementation(
      () =>
        new Promise<Decision>((resolve) => {
          release = resolve;
          entered();
        }),
    );
    const execute = vi
      .spyOn(room.executor, 'execute')
      .mockResolvedValue({ executed: true, value: true });
    const approval = room.approve(decision.decisionId, 'host');
    await approving;
    now += 10000;
    room.step(10000);
    release({ ...decision, verdict: 'ALLOW', source: 'decionis' });
    expect(await approval).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(room.view().match).toBeUndefined();
    await room.close();
  });

  it('keeps a remote hold pending without extending the original host deadline', async () => {
    let now = 1000;
    const config = defaultPolicy();
    config.defaults.mode = 'enforce';
    const room = new Room({ hostId: 'host', config, quiet: true, now: () => now });
    const decision = await room.raid({
      channels: demoChannels,
      raiderLogin: 'stranger',
      accountAgeDays: 300,
      hostFollowsRaider: false,
      viewers: 300,
      simulated: true,
    });
    const deadline = room.view().pending?.expiresAt;
    vi.spyOn(room.gate, 'approve').mockResolvedValue({
      ...decision,
      source: 'decionis',
      reasonCodes: ['HOSTED_APPROVAL_REQUIRED'],
    });
    now += 1500;
    expect(await room.approve(decision.decisionId, 'host')).toBe(false);
    expect(room.view().pending).toEqual({
      decisionId: decision.decisionId,
      expiresAt: deadline,
      viewers: 300,
      raiderLogin: 'stranger',
    });
    expect(room.view().match).toBeUndefined();
    now = deadline!;
    expect(await room.approve(decision.decisionId, 'host')).toBe(false);
    await room.close();
  });
});
