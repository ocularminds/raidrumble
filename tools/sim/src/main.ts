import { createApp } from '../../../apps/server/src/app.js';
import type { Scenario } from '../../../apps/server/src/model.js';

const args = process.argv.slice(2).filter((argument) => argument !== '--');
const value = (name: string) => args[args.indexOf(name) + 1];
const scenario = (args.includes('--scenario') ? value('--scenario') : 'normal') as Scenario;
const speed = Number(args.includes('--speed') ? value('--speed') : 1);
const valid: readonly string[] = ['normal', 'stranger-raid', 'hate-raid', 'collab'];
if (!valid.includes(scenario) || !Number.isFinite(speed) || speed < 1 || speed > 30) {
  console.error(
    'Usage: pnpm sim -- --scenario normal|stranger-raid|hate-raid|collab [--headless] [--speed 1..30] [--json]',
  );
  process.exitCode = 1;
} else {
  const remote =
    args.includes('--headless') || args.includes('--json') ? false : await liveServer();
  if (!remote) await headless();
}

async function liveServer(): Promise<boolean> {
  const base = process.env.SIM_SERVER_URL ?? 'http://localhost:3000';
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
    if (!health.ok) return false;
  } catch {
    return false;
  }
  const response = await fetch(`${base}/api/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, speed }),
  });
  const body = (await response.json()) as {
    decision?: { verdict: string; reasonCodes: string[] };
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? 'Simulator request failed.');
  console.info(`LOCAL SIMULATION · ${scenario} · ${body.decision?.verdict}`);
  console.info(body.decision?.reasonCodes.join(', ') ?? '');
  console.info('Dashboard: http://localhost:5174');
  console.info('Arena: http://localhost:5173/overlay/demo?preview=1');
  if (body.decision?.verdict === 'ESCALATE')
    console.info('The host has 10 seconds to accept in the dashboard.');
  return true;
}

async function headless(): Promise<void> {
  const { app, rooms, ledger } = await createApp({ autoTick: false, quiet: true, openai: false });
  try {
    await app.ready();
    const room = await rooms.demo(scenario, 1);
    const initial = room.view();
    let approved = false;
    if (initial.pending) approved = await room.approve(initial.pending.decisionId, 'demo');
    let view = room.view();
    if (view.match) {
      for (let tick = 0; tick < 1800; tick++) room.step(100);
      view = room.view();
      await room.flush();
    }
    const match = view.match;
    if (match) {
      for (let tick = 0; tick < 300; tick++) room.step(1000);
      await room.flush();
    }
    const report = {
      simulated: true,
      scenario,
      verdict: initial.decision?.verdict,
      reasonCodes: initial.decision?.reasonCodes,
      scriptedHostApproval: approved,
      durationMs: match?.elapsedMs ?? 0,
      results:
        match?.results.map(({ roundId, winner, stats }) => ({ round: roundId, winner, stats })) ??
        [],
      degraded: match?.degraded ?? false,
      retention: match ? ledger.match(match.matchId)?.retention : undefined,
    };
    if (args.includes('--json')) console.info(JSON.stringify(report, null, 2));
    else {
      console.info(`HEADLESS LOCAL SIMULATION · ${scenario} · ${report.verdict}`);
      console.info((report.reasonCodes ?? []).join(', '));
      if (approved)
        console.info('Simulated host accepted the held action using a single-use grant.');
      for (const result of report.results) console.info(`${result.round}: ${result.winner}`);
      if (match)
        console.info(
          `180 seconds completed · degraded: ${report.degraded} · raiders at +5 min: ${report.retention}`,
        );
      else console.info('No match started. No Twitch actions were taken.');
      console.info('Run pnpm dev, then pnpm sim to watch the same modules in the overlay.');
    }
    if (match && (match.status !== 'finished' || match.degraded)) process.exitCode = 1;
    if (scenario === 'hate-raid' && match) process.exitCode = 1;
    if (scenario !== 'hate-raid' && !match) process.exitCode = 1;
  } finally {
    await app.close();
  }
}
