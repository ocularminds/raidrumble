import { expect, it, vi } from 'vitest';
import { streamFixture } from './streamfixture.js';

it('keeps reward setup on the real host authority while a practice room is selected', async () => {
  const f = streamFixture();
  const primary = f.rooms.primary('10');
  const practice = await f.rooms.practice('10');
  const authorize = vi.spyOn(primary.gate, 'authorize');
  const approve = vi.spyOn(primary.gate, 'approve');
  const practiceAuthorize = vi.spyOn(practice.gate, 'authorize');
  const practiceExecute = vi.spyOn(practice.executor, 'executeHelix');
  const proposal = await f.actions.prepareReward('10');
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'rewards.configure' }));
  expect(practiceAuthorize).not.toHaveBeenCalled();
  expect(await f.actions.approveReward('10', '10', proposal.decision.decisionId)).toMatchObject({
    configured: true,
  });
  expect(approve).toHaveBeenCalledWith(proposal.decision.decisionId, '10');
  expect(practiceExecute).not.toHaveBeenCalled();
  await f.app.close();
});
