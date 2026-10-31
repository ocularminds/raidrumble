import type { PlayerInput, RoundView, Team } from './model.js';

export interface ChatCommand {
  readonly userId: string;
  readonly team: Team;
  readonly atMs: number;
  readonly text: string;
  /** The caller must gate a display name before providing it. */
  readonly displayName?: string;
  readonly weight?: number;
}

/** The sole projection from raw chat into the engine's recognised command vocabulary. */
export class InputParser {
  parse(source: ChatCommand, view: RoundView): PlayerInput | undefined {
    if (view.phase !== 'active' || source.text.length > 200) return undefined;
    const text = source.text.trim().toUpperCase();
    let kind: PlayerInput['kind'];
    let value: string;
    if (view.quiz) {
      if (text !== 'A' && text !== 'B' && text !== 'C') return undefined;
      kind = 'answer';
      value = text;
    } else if (view.boss) {
      if (text === '!HIT') {
        kind = 'hit';
        value = '!hit';
      } else if (view.boss.weakPointActive && text === view.boss.weakPoint.toUpperCase()) {
        kind = 'keyword';
        value = view.boss.weakPoint;
      } else return undefined;
    } else {
      if (!view.keyword || text !== view.keyword.toUpperCase()) return undefined;
      kind = 'keyword';
      value = view.keyword;
    }
    return {
      userId: source.userId,
      team: source.team,
      atMs: source.atMs,
      kind,
      value,
      ...(source.displayName !== undefined ? { displayName: source.displayName } : {}),
      ...(source.weight !== undefined ? { weight: source.weight } : {}),
    };
  }
}
