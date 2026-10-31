import type { DecisionView } from '../../server/src/model.js';
import { element } from './api.js';
import { plural, reasonText } from './copy.js';

const labels: Record<string, string> = {
  'rumble.start': 'Raid requested',
  'rumble.start.collab': 'Collab Rumble requested',
  'special.fire': 'Special requested',
  'ledger.settle': 'Match recorded',
  'events.subscribe': 'Twitch connection',
  'content.render': 'Stream content checked',
  'chat.send': 'Chat announcement',
  'shoutout.send': 'Community shoutout',
  'rewards.configure': 'Reinforcements setup',
};

export function groupDecisions(decisions: readonly DecisionView[]) {
  const system = (decision: DecisionView) =>
    decision.action === 'events.subscribe' || decision.action === 'content.render';
  return {
    host: decisions.filter((decision) => !system(decision)),
    system: decisions.filter(system),
  };
}

export class PolicyActivity {
  render(decisions: readonly DecisionView[]): void {
    const groups = groupDecisions(decisions);
    element('decisionCount').textContent = plural(
      groups.host.length,
      'RECENT DECISION',
    ).toUpperCase();
    element('systemCount').textContent = `System · ${plural(groups.system.length, 'event')}`;
    element('systemActivity').hidden = !groups.system.length;
    element('systemDecisions').replaceChildren(...groups.system.slice(0, 15).map(row));
    if (groups.host.length) {
      element('decisions').replaceChildren(...groups.host.slice(0, 15).map(row));
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      'Your next raid starts the story. Try a test raid to see your rules in action.';
    element('decisions').replaceChildren(empty);
  }
}

function row(decision: DecisionView): HTMLElement {
  const item = document.createElement('div');
  item.className = 'decision';
  item.title = decision.decisionId;
  const tag = document.createElement('span');
  tag.className = `tag ${decision.verdict.toLowerCase()}`;
  tag.textContent = decision.verdict;
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = labels[decision.action] ?? 'Stream action';
  const reason = document.createElement('small');
  reason.textContent = [...new Set(decision.reasonCodes.map(reasonText))].join(' · ');
  reason.title = decision.reasonCodes.join(' · ');
  text.append(title, reason);
  const mode = document.createElement('span');
  mode.className = 'mode';
  mode.textContent = decision.mode === 'shadow' ? 'SHADOW' : 'ENFORCED';
  item.append(tag, text, mode);
  return item;
}
