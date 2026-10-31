import { categoryTheme } from './categories.js';
import { display, type Channels } from './model.js';

/** Every pair uses the same vocabulary; unknown categories keep one concise supplied label. */
export function bossFrom(channels: Channels): { name: string; flavour: string } {
  const host = categoryTheme(channels.host.category);
  const raider = categoryTheme(channels.raider.category);
  const adjective = raider?.adjective ?? (display(channels.raider.category, 32) || 'Fusion');
  return {
    name: `The ${adjective} ${host?.noun ?? 'Guardian'}`,
    flavour: 'A fusion of your two worlds. Find its weak point together.',
  };
}
