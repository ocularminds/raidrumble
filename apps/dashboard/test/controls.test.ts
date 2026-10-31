import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../src/api.js';
import { StreamControls } from '../src/controls.js';
import { dashboard, dom } from './fixture.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Live practice and Collab controls', () => {
  it('starts real-chat practice in the connected host room and offers explicit exit', async () => {
    const f = dom();
    const api = new Api();
    vi.spyOn(api, 'get').mockResolvedValue({ configured: false });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ simulated: true, practice: 'realchat' });
    const refresh = vi.fn(async () => undefined);
    const control = new StreamControls('10', api, refresh);
    const view = dashboard();
    view.twitch.hostConnected = view.twitch.chatEventsConnected = true;
    control.update(view);
    expect(f.element('practiceLive').disabled).toBe(false);
    f.element('practiceLive').click();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/api/test/10', { realChat: true });
    view.arena.practice = 'realchat';
    view.arena.status = 'active';
    control.update(view);
    expect(f.element('practiceLive').disabled).toBe(true);
    expect(f.element('exitPractice').hidden).toBe(false);
    expect(f.element('practiceState').textContent).toContain('!join raiders');
    f.element('exitPractice').click();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith('/api/practice/10/exit');
  });

  it('uses only session-member display names and updates labels when metadata arrives', () => {
    const f = dom();
    const api = new Api();
    vi.spyOn(api, 'get').mockResolvedValue({ configured: false });
    const control = new StreamControls('10', api, async () => undefined);
    const view = dashboard();
    view.shared = ['10', '30'];
    view.sharedChannels = [{ id: '999', name: 'Outsider' }];
    control.update(view);
    expect(f.element('collabPeer').options.map((option) => option.textContent)).toEqual([
      'Shared Channel 1',
    ]);
    view.sharedChannels = [{ id: '30', name: 'Speed' }];
    control.update(view);
    expect(f.element('collabPeer').options[0]!.textContent).toBe('Speed');
    expect(f.element('collabState').textContent).toContain('Speed');
  });
});
