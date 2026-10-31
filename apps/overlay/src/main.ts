import type { ArenaView } from '../../server/src/model.js';
import { Arena } from './arena.js';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#arena');
if (!canvas) throw new Error('Missing arena canvas.');
const preview = new URLSearchParams(location.search).has('preview');
document.body.classList.toggle('preview', preview);
const arena = new Arena(canvas, preview);
const segments = location.pathname.split('/').filter(Boolean);
const hostId = segments[1] ?? 'demo';
const server = new URL(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
server.protocol = server.protocol === 'https:' ? 'wss:' : 'ws:';
server.pathname =
  segments[0] === 'mirror'
    ? `/ws/mirror/${encodeURIComponent(hostId)}`
    : `/ws/${encodeURIComponent(hostId)}`;
let view: ArenaView | undefined;
let previous: ArenaView | undefined;
let receivedAt = 0;
let backoff = 500;

function connect(): void {
  const socket = new WebSocket(server);
  socket.onopen = () => {
    backoff = 500;
  };
  socket.onmessage = (event: MessageEvent<string>) => {
    try {
      const next: ArenaView = JSON.parse(event.data);
      if (typeof next.hostId !== 'string' || typeof next.status !== 'string') return;
      previous = view;
      view = next;
      receivedAt = performance.now();
      const status = document.querySelector('#status');
      if (status) {
        const round = next.match?.round;
        status.textContent =
          next.status === 'afterglow'
            ? `Raiders still here: ${next.afterglow?.count ?? 0}.`
            : next.match?.status === 'endcard' || next.match?.status === 'finished'
              ? 'Match complete. Celebrate both communities and their MVPs.'
              : round?.phase === 'finished'
                ? `${round.instruction} Celebrate in chat with GG.`
                : round
                  ? `${round.title}. Type ${round.keyword}. ${Math.ceil(round.remainingMs / 1000)} seconds left.`
                  : next.status === 'pending'
                    ? 'Waiting for the host to accept the challenge.'
                    : 'Ready for the next raid.';
      }
    } catch {
      /* Keep the most recent valid frame while reconnecting. */
    }
  };
  socket.onclose = () => {
    setTimeout(connect, backoff);
    backoff = Math.min(10000, backoff * 2);
  };
  socket.onerror = () => socket.close();
}

function frame(time: number): void {
  let rendered = view;
  const current = view?.match?.round;
  const old = previous?.match?.round;
  if (view?.match && current && old && old.id === current.id && !view.reducedMotion) {
    const fraction = Math.min(1, (time - receivedAt) / 100);
    const round = {
      ...current,
      remainingMs: old.remainingMs + (current.remainingMs - old.remainingMs) * fraction,
    };
    if (current.gate && old.gate)
      round.gate = {
        ...current.gate,
        position: old.gate.position + (current.gate.position - old.gate.position) * fraction,
      };
    rendered = { ...view, match: { ...view.match, round } };
  }
  arena.draw(rendered, time);
  requestAnimationFrame(frame);
}

connect();
requestAnimationFrame(frame);
