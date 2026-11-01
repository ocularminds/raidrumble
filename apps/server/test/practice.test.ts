import { describe, expect, it, vi } from 'vitest';
import { streamFixture } from './streamfixture.js';
import { SettingsStore } from '../src/services/settings.js';

describe('isolated Test Raid with real Twitch chat', () => {
  it('selects a local practice room without replacing the live authority or preferences', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.get('10');
      const settings = primary.settings();
      const practice = await f.rooms.practice('10');
      expect(practice).not.toBe(primary);
      expect(f.rooms.primary('10')).toBe(primary);
      expect(f.rooms.all.get('10')).toBe(primary);
      expect(f.rooms.get('10')).toBe(practice);
      expect(f.rooms.active()).toContain(practice);
      expect(f.rooms.active()).not.toContain(primary);
      expect(primary.settings()).toEqual(settings);
      expect(practice.view()).toMatchObject({
        simulated: true,
        practice: 'realchat',
        status: 'active',
        decision: { source: 'local', verdict: 'ALLOW' },
        match: { teams: { home: 5, raiders: 5 } },
      });
      await f.rooms.endPractice('10');
      expect(f.rooms.get('10')).toBe(primary);
      expect(practice.view().match).toBeUndefined();
      expect(primary.settings()).toEqual(settings);
    } finally {
      await f.app.close();
    }
  });

  it('moves only for actual counted chat and displays only gated names', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.get('10');
      primary.configure({ ...primary.settings(), blockedTerms: ['forbidden'] });
      const practice = await f.rooms.practice('10');
      f.advance(10_000);
      expect(practice.view().match?.round?.scores).toEqual({ home: 0, raiders: 0 });
      expect(practice.assignment('home0')).toBeUndefined();
      expect(practice.assignment('raider0')).toBeUndefined();
      expect(practice.view().match?.feedback).toBeUndefined();
      await f.rooms.chat('10', { userId: 'realviewer', text: '!join raiders' });
      const message = {
        userId: 'realviewer',
        text: practice.view().match!.round!.keyword,
        displayName: 'forbidden',
      };
      expect(await f.rooms.chat('10', message)).toBe(true);
      expect(await f.rooms.chat('10', message)).toBe(false);
      expect(practice.view().match?.feedback?.pops).toEqual([
        expect.objectContaining({ displayName: 'Viewer', team: 'raiders' }),
      ]);
      f.advance(2000);
      expect(practice.view().match?.round?.scores.raiders).toBeGreaterThan(0);
      expect(JSON.stringify(practice.view().match?.feedback)).not.toContain('forbidden');
      await f.actions.step();
      expect(f.calls).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });

  it('shows only real Afterglow activity, expires it, and never stores a practice rivalry', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.get('10');
      const practice = await f.rooms.practice('10');
      await f.rooms.chat('10', { userId: 'realraider', text: '!join raiders' });
      await f.rooms.chat('10', {
        userId: 'realraider',
        text: practice.view().match!.round!.keyword,
        displayName: 'Real Viewer',
      });
      f.advance(170_000);
      await f.rooms.chat('10', { userId: 'realraider', text: 'Still here' });
      f.advance(10_000);
      await f.rooms.flush();
      await f.actions.step();
      expect(practice.view().afterglow).toEqual({ count: 1, remainingMs: 300_000 });
      expect(f.rooms.graph().edges).toEqual([]);
      expect(f.calls).toHaveLength(0);
      f.advance(120_001);
      expect(practice.view().afterglow?.count).toBe(0);
      f.advance(179_999);
      await f.rooms.flush();
      expect(f.rooms.get('10')).toBe(primary);
      expect(practice.view().afterglow).toBeUndefined();
      expect(practice.assignment('realraider')).toBeUndefined();
      expect(f.rooms.graph().edges).toEqual([]);
      expect(f.calls).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });

  it('lets an actual raid supersede practice through the original live authority', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.get('10');
      const practice = await f.rooms.practice('10');
      await f.start();
      expect(f.rooms.get('10')).toBe(primary);
      expect(primary.view()).toMatchObject({
        simulated: false,
        status: 'active',
        decision: { verdict: 'ALLOW' },
      });
      expect(primary.raiderId).toBe('30');
      expect(practice.view().match).toBeUndefined();
      expect(await practice.chat({ userId: 'late', text: 'PUSH' })).toBe(false);
    } finally {
      await f.app.close();
    }
  });

  it('cannot start practice in the asynchronous handoff before a real raid is authorized', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.primary('10');
      const incoming = f.start();
      await expect(f.rooms.practice('10').then(() => 'started')).rejects.toThrow(/already active/i);
      await incoming;
      expect(f.rooms.get('10')).toBe(primary);
      expect(primary.view()).toMatchObject({ simulated: false, status: 'active' });
    } finally {
      await f.app.close();
    }
  });

  it('cannot replace a live match or run a second practice concurrently', async () => {
    const f = streamFixture();
    try {
      await f.rooms.practice('10');
      await expect(f.rooms.practice('10')).rejects.toThrow(/already active/i);
      await f.rooms.endPractice('10');
      await f.start();
      await expect(f.rooms.practice('10')).rejects.toThrow(/already active/i);
      await expect(f.rooms.practice('demo')).rejects.toThrow(/connected.*host/i);
    } finally {
      await f.app.close();
    }
  });

  it('cancels in-flight practice setup and makes repeated exit safe', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.get('10');
      const pending = f.rooms.practice('10');
      const rejected = expect(pending).rejects.toThrow(/cancelled/i);
      await f.rooms.endPractice('10');
      await rejected;
      await f.rooms.endPractice('10');
      expect(f.rooms.get('10')).toBe(primary);
      expect(primary.view().match).toBeUndefined();
    } finally {
      await f.app.close();
    }
  });

  it('saves primary preferences even if practice changed its temporary settings', async () => {
    const f = streamFixture();
    try {
      const primary = f.rooms.primary('10');
      const settings = primary.settings();
      const practice = await f.rooms.practice('10');
      practice.configure({ ...practice.settings(), allow: ['temporary'], mode: 'shadow' });
      const saved = vi.spyOn(SettingsStore.prototype, 'set');
      f.rooms.save('10');
      expect(saved).toHaveBeenCalledWith('10', settings);
      expect(primary.settings()).toEqual(settings);
      expect(practice.settings()).toEqual(settings);
    } finally {
      await f.app.close();
    }
  });

  it('keeps first-seen host evidence from practice chat for the next real raid', async () => {
    const f = streamFixture();
    try {
      await f.rooms.practice('10');
      f.advance(1000);
      await f.rooms.chat('10', { userId: 'presentbeforetheraid', text: 'Hello from real chat' });
      f.advance(1000);
      await f.start();
      f.advance(1000);
      const primary = f.rooms.primary('10');
      await f.rooms.chat('10', {
        userId: 'presentbeforetheraid',
        text: primary.view().match!.round!.keyword,
      });
      expect(primary.assignment('presentbeforetheraid')).toMatchObject({ team: 'home' });
    } finally {
      await f.app.close();
    }
  });
});
