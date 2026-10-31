import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultPolicy,
  LocalPolicyGate,
  PolicyExecutor,
  type Decision,
  type FailureRule,
} from '@raidrumble/policy';
import { Ledger } from '@raidrumble/ledger';
import { MatchArchive, type MatchCompletion } from '../src/services/archive.js';
import type { CompletedMatch } from '../src/models/room.js';

const openLedgers: Ledger[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const ledger of openLedgers.splice(0)) ledger.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fixture(
  options: { source?: Decision['source']; failure?: FailureRule; path?: string } = {},
) {
  const config = defaultPolicy();
  config.defaults.mode = 'enforce';
  config.actions['ledger.settle'].onFailure = options.failure ?? 'LOCAL';
  const gate = new LocalPolicyGate(config, { now: () => 10_000, logger: () => undefined });
  const authorize = gate.authorize.bind(gate);
  vi.spyOn(gate, 'authorize').mockImplementation(async (request) => ({
    ...(await authorize(request)),
    source: options.source ?? 'decionis',
    dossierId: 'remoteDossier',
  }));
  const executor = new PolicyExecutor(gate);
  const execute = vi.spyOn(executor, 'execute').mockResolvedValue({
    executed: false,
    reason: 'GRANT_UNAVAILABLE',
  });
  const ledger = new Ledger(options.path);
  openLedgers.push(ledger);
  const record: MatchCompletion = {
    matchId: 'match',
    hostId: 'host',
    raiderId: 'raider',
    results: [],
    atMs: 10_000,
    hostName: 'Home',
    raiderName: 'Visitors',
    startDecision: {
      decisionId: 'start',
      dossierId: 'startDossier',
      verdict: 'ALLOW',
      source: 'decionis',
      mode: 'enforce',
      reasonCodes: [],
    },
  };
  const onSettle = vi.fn((result: CompletedMatch) => {
    ledger.settle({
      matchId: result.matchId,
      hostId: result.hostId,
      raiderId: result.raiderId,
      endedAtMs: result.atMs,
      winner: 'none',
      bossKilled: false,
      startDecisionId: result.startDecision.decisionId,
      startDossierId: result.startDecision.dossierId,
      settleDecisionId: result.settleDecision.decisionId,
      settleDossierId: result.settleDecision.dossierId,
      unsigned: result.settleDecision.source === 'local',
    });
  });
  const onRetention = vi.fn((id: string, count: number, decision: Decision) =>
    ledger.retention(id, count, decision.source === 'local'),
  );
  const archive = new MatchArchive(gate, executor, {
    onSettle,
    onRetention,
    now: () => 10_000,
    quiet: true,
  });
  return { gate, execute, ledger, record, onSettle, onRetention, archive };
}

describe('Local ledger fallback after unavailable hosted claims', () => {
  it('authorizes a separate unsigned settlement and preserves the failed remote receipt IDs', async () => {
    const authorizations = vi.spyOn(LocalPolicyGate.prototype, 'authorize');
    const f = fixture();
    expect(await f.archive.settle(f.record)).toBe(true);
    await f.archive.flush();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.onSettle).toHaveBeenCalledOnce();
    const remote = f.execute.mock.calls[0]![0];
    const fallback = f.onSettle.mock.calls[0]![0].settleDecision;
    expect(fallback).toMatchObject({
      verdict: 'ALLOW',
      source: 'local',
      reasonCodes: ['HOSTED_GRANT_UNAVAILABLE', 'UNSIGNED_LEDGER_FALLBACK'],
    });
    expect(fallback.decisionId).not.toBe(remote.decisionId);
    expect(fallback.grant).toBeUndefined();
    expect(fallback.dossierId).toBeUndefined();
    const requests = authorizations.mock.calls
      .map(([request]) => request)
      .filter((request) => request.payload.failedDecisionId === remote.decisionId);
    expect(requests).toEqual([
      expect.objectContaining({
        action: 'ledger.settle',
        matchId: 'match',
        channel: { hostId: 'host', raiderId: 'raider' },
        payload: {
          startDecisionId: 'start',
          phase: 'result',
          failedDecisionId: remote.decisionId,
          failedDossierId: 'remoteDossier',
        },
      }),
    ]);
    expect(f.ledger.match('match')).toMatchObject({
      unsigned: true,
      settleDecisionId: fallback.decisionId,
    });
    expect(f.ledger.pair('host', 'raider')?.matches).toBe(1);
  });

  it('keeps the first local receipt and one aggregate when the match is settled again', async () => {
    const f = fixture();
    expect(await f.archive.settle(f.record)).toBe(true);
    const original = f.ledger.match('match');
    expect(await f.archive.settle(f.record)).toBe(true);
    await f.archive.flush();
    expect(f.ledger.match('match')).toEqual(original);
    expect(f.ledger.pair('host', 'raider')?.matches).toBe(1);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.onSettle).toHaveBeenCalledTimes(2);
  });

  it.each(['GRANT_INVALID_OR_USED', 'DECISION_INVALID_OR_USED', 'GRANT_EXPIRED'])(
    'does not fall back for %s',
    async (reason) => {
      const f = fixture();
      f.execute.mockResolvedValue({ executed: false, reason });
      expect(await f.archive.settle(f.record)).toBe(false);
      await expect(f.archive.flush()).rejects.toThrow(reason);
      expect(f.onSettle).not.toHaveBeenCalled();
      expect(f.ledger.match('match')).toBeUndefined();
      expect(f.execute).toHaveBeenCalledOnce();
    },
  );

  it.each(['local source', 'nonlocal failure rule', 'different action', 'missing request'])(
    'does not infer permission from an unavailable claim with %s',
    async (condition) => {
      const f = fixture({
        ...(condition === 'local source' ? { source: 'local' as const } : {}),
        ...(condition === 'nonlocal failure rule' ? { failure: 'BLOCK' as const } : {}),
      });
      if (condition === 'missing request')
        vi.spyOn(f.gate, 'getRequest').mockReturnValue(undefined);
      if (condition === 'different action') {
        vi.spyOn(f.gate, 'getRequest').mockReturnValue({
          action: 'chat.send',
          actor: { kind: 'system' },
          channel: { hostId: 'host' },
          payload: {},
        });
      }
      expect(await f.archive.settle(f.record)).toBe(false);
      await expect(f.archive.flush()).rejects.toThrow('GRANT_UNAVAILABLE');
      expect(f.onSettle).not.toHaveBeenCalled();
    },
  );

  it.each(['EFFECT_FAILED', 'RECEIPT_PENDING', 'GRANT_UNAVAILABLE'])(
    'never re-dispatches persistence after %s',
    async (reason) => {
      const f = fixture();
      f.execute.mockImplementation(async (_decision, effect) => {
        const value = await effect();
        return { executed: reason === 'RECEIPT_PENDING', value, reason };
      });
      expect(await f.archive.settle(f.record)).toBe(reason === 'RECEIPT_PENDING');
      if (reason === 'RECEIPT_PENDING') await f.archive.flush();
      else await expect(f.archive.flush()).rejects.toThrow(reason);
      expect(f.execute).toHaveBeenCalledOnce();
      expect(f.onSettle).toHaveBeenCalledOnce();
      expect(f.onSettle.mock.calls[0]![0].settleDecision.source).toBe('decionis');
      expect(f.ledger.pair('host', 'raider')?.matches).toBe(1);
    },
  );

  it('persists an unsigned retention fallback after a hosted settlement, including across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'raidrumblearchive'));
    directories.push(directory);
    const path = join(directory, 'ledger.sqlite');
    const f = fixture({ path });
    f.execute.mockImplementationOnce(async (_decision, effect) => ({
      executed: true,
      value: await effect(),
    }));
    const settled = f.archive.settle(f.record);
    expect(await settled).toBe(true);
    expect(f.ledger.match('match')?.unsigned).toBe(false);
    f.archive.retention(
      { matchId: 'match', hostId: 'host', raiderId: 'raider', startDecisionId: 'start' },
      8,
      settled,
    );
    await f.archive.flush();
    expect(f.onRetention).toHaveBeenCalledOnce();
    expect(f.onRetention).toHaveBeenCalledWith(
      'match',
      8,
      expect.objectContaining({
        source: 'local',
        reasonCodes: ['HOSTED_GRANT_UNAVAILABLE', 'UNSIGNED_LEDGER_FALLBACK'],
      }),
    );
    expect(f.execute).toHaveBeenCalledTimes(2);
    f.ledger.close();
    const reopened = new Ledger(path);
    openLedgers.push(reopened);
    expect(reopened.match('match')).toMatchObject({ unsigned: true, retention: 8 });
    expect(reopened.pair('host', 'raider')?.matches).toBe(1);
  });
});
