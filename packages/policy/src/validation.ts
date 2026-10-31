import type { ActionRequest } from './models.js';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096)
    throw new Error('Invalid policy string');
  return value;
}

export function finite(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value < 0))
    throw new Error('Invalid policy number');
  return value;
}

function boolean(value: unknown): void {
  if (typeof value !== 'boolean') throw new Error('Invalid policy boolean');
}

export function validateRequest(req: ActionRequest): void {
  string(req.channel.hostId);
  const payload = req.payload;
  if (req.action === 'rumble.start') {
    string(req.channel.raiderId);
    string(payload.raiderLogin);
    if (payload.factsUnavailable !== undefined) boolean(payload.factsUnavailable);
    if (!(payload.factsUnavailable === true && payload.raiderAccountAgeDays === null))
      finite(payload.raiderAccountAgeDays, true);
    for (const key of ['raidViewers', 'raidsLastHour']) finite(payload[key], true);
    if (!(payload.factsUnavailable === true && payload.hostFollowsRaider === null))
      boolean(payload.hostFollowsRaider);
    boolean(payload.hasPriorMatch);
  }
  if (req.action === 'content.render' || req.action === 'chat.send') string(payload.text);
  if (req.action === 'content.render' && payload.moderationFlagged !== undefined)
    boolean(payload.moderationFlagged);
  if (req.action === 'chat.send') boolean(payload.templated);
  if (
    (req.action === 'chat.send' || req.action === 'shoutout.send') &&
    payload.lastSentAt !== undefined
  )
    finite(payload.lastSentAt);
  if (req.action === 'special.fire') finite(payload.budgetRemaining, true);
}
