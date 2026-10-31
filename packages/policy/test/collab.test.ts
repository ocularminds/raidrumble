import { describe, expect, it } from 'vitest';
import type { PolicyMode } from '../src/models.js';
import { request, setup } from './helpers.js';

function collabRequest() {
  const req = request('rumble.start.collab');
  req.actor = { kind: 'host', twitchUserId: 'host' };
  req.payload = {
    participants: [
      { id: 'host', login: 'mossy' },
      { id: 'raider', login: 'trusted' },
    ],
    sessionParticipantIds: ['host', 'raider'],
  };
  return req;
}

describe.each<PolicyMode>(['shadow', 'enforce'])('Shared Chat policy in %s mode', (mode) => {
  it('implicitly trusts the host when the real session participant list includes them', async () => {
    const { gate } = setup(mode);
    expect(await gate.authorize(collabRequest())).toMatchObject({
      verdict: 'ALLOW',
      reasonCodes: ['COLLAB_ALLOWED'],
    });
  });

  it('also accepts a visitors-only list covering the real session', async () => {
    const { gate } = setup(mode);
    const req = collabRequest();
    req.payload.participants = [{ id: 'raider', login: 'trusted' }];
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
  });

  it('holds the action when any real visitor is untrusted', async () => {
    const { gate } = setup(mode);
    const req = collabRequest();
    req.payload.sessionParticipantIds = ['host', 'raider', 'stranger'];
    req.payload.participants = [
      { id: 'host', login: 'mossy' },
      { id: 'raider', login: 'trusted' },
      { id: 'stranger', login: 'unknown' },
    ];
    expect((await gate.authorize(req)).verdict).toBe('ESCALATE');
  });

  it('refuses omitted visitors, an absent selected raider, and a host-only session', async () => {
    const { gate } = setup(mode);
    const req = collabRequest();
    req.payload.sessionParticipantIds = ['host', 'raider', 'stranger'];
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.payload.sessionParticipantIds = ['host', 'raider'];
    req.channel.raiderId = 'other';
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.payload.sessionParticipantIds = ['host'];
    req.payload.participants = [{ id: 'host', login: 'mossy' }];
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
  });
});
