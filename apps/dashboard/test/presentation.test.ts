import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  avatar,
  channelLabel,
  reasonText,
  plural,
  twitchSummary,
  warlordState,
} from '../src/copy.js';
import { groupDecisions, PolicyActivity } from '../src/activity.js';
import { SetupGuide } from '../src/setup.js';
import { dashboard, dom } from './fixture.js';

afterEach(() => vi.unstubAllGlobals());

describe('Host-facing dashboard presentation', () => {
  it('translates policy reasons and groups plumbing away from raid decisions', () => {
    expect(reasonText('RAIDER_BLOCKLISTED')).toBe('On your blocked list');
    expect(reasonText('RAIDER_ACCOUNT_TOO_NEW')).toBe('Account is less than 7 days old');
    expect(reasonText('UNKNOWN_RAIDER')).toBe('Not on your trusted list: asked you');
    expect(reasonText('RAID_FLOOD')).toBe('Too many raids from this channel this hour');
    expect(reasonText('UNRECOGNIZED_INTERNAL_DETAIL')).toBe('Policy decision recorded');
    const decision = {
      decisionId: 'one',
      action: 'events.subscribe',
      verdict: 'ALLOW' as const,
      reasonCodes: [],
      mode: 'enforce' as const,
      source: 'local' as const,
    };
    const groups = groupDecisions([decision, { ...decision, action: 'rumble.start' }]);
    expect(groups.system).toHaveLength(1);
    expect(groups.host.map((item) => item.action)).toEqual(['rumble.start']);
    expect(plural(1, 'RECENT DECISION')).toBe('1 RECENT DECISION');
    expect(plural(2, 'RECENT DECISION')).toBe('2 RECENT DECISIONS');
    const f = dom();
    new PolicyActivity().render([
      { ...decision, action: 'rumble.start', reasonCodes: ['RAIDER_BLOCKLISTED'] },
    ]);
    const row = f.element('decisions').children[0]!;
    const reason = row.children[1]!.children[1]!;
    expect(reason.textContent).toBe('On your blocked list');
    expect(reason.title).toBe('RAIDER_BLOCKLISTED');
    expect(f.element('decisionCount').textContent).toBe('1 RECENT DECISION');
  });

  it('uses meaningful identity and connection labels without IDs or developer setup instructions', () => {
    expect(avatar('demo', 'Garden')).toBe('▲');
    expect(avatar('10', 'babafesti')).toBe('B');
    expect(channelLabel({ id: '123456' }, 1)).toBe('Rival Community 2');
    expect(channelLabel({ id: '123456', name: 'Garden' }, 1)).toBe('Garden');
    const view = dashboard();
    expect(twitchSummary({ ...view.twitch, configured: false })).toBe(
      "Live mode isn't set up on this server yet. See the README's Go live section.",
    );
    expect(twitchSummary({ ...view.twitch, eventCount: 1 })).toContain('1 event received');
  });

  it('collapses setup only after host, bot, events and copying this host’s OBS URL', () => {
    const f = dom();
    const guide = new SetupGuide('10');
    const view = dashboard();
    guide.update(view);
    expect(f.element('setupSteps').hidden).toBe(false);
    guide.markCopied(view.overlayUrl);
    view.twitch.hostConnected = view.twitch.botConnected = true;
    guide.update(view);
    expect(f.element('setupSteps').hidden).toBe(false);
    view.twitch.hostEventsConnected = view.twitch.chatEventsConnected = true;
    guide.update(view);
    expect(f.element('setupSteps').hidden).toBe(true);
    f.element('reviewSetup').click();
    expect(f.element('setupSteps').hidden).toBe(false);
    const other = new SetupGuide('30');
    other.update({ ...view, overlayUrl: 'http://localhost:5173/overlay/30' });
    expect(f.element('setupSteps').hidden).toBe(false);
  });

  it('labels a used Battering Ram without making a waiting match look spent', () => {
    const view = {
      authorized: true,
      active: true,
      available: false,
      simulated: false,
      raiderName: 'Speed',
      loginUrl: '',
    };
    expect(warlordState(view).label).toBe('RAM USED ✓');
    expect(warlordState(view).disabled).toBe(true);
    expect(warlordState({ ...view, active: false }).label).toBe('FIRE BATTERING RAM');
    expect(warlordState({ ...view, available: true }).disabled).toBe(false);
  });
});
