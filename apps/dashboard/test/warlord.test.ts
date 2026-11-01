import { afterEach, expect, it, vi } from 'vitest';
import { Api } from '../src/api.js';
import { warlord } from '../src/warlord.js';
import { dom } from './fixture.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('resets the used label when the same demo page receives a new match', async () => {
  vi.useFakeTimers();
  const f = dom();
  const view = {
    authorized: true,
    active: true,
    available: true,
    simulated: true,
    raiderName: 'Speed',
    loginUrl: '',
    matchId: 'one',
  };
  vi.spyOn(Api.prototype, 'get')
    .mockResolvedValueOnce(view)
    .mockResolvedValueOnce({ ...view, available: false })
    .mockResolvedValue({ ...view, matchId: 'two' });
  warlord(f.element('app') as unknown as HTMLElement, 'demo');
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.element('ram').textContent).toBe('RAM USED ✓');
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.element('ram').textContent).toBe('FIRE BATTERING RAM');
  expect(f.element('ram').disabled).toBe(false);
});
