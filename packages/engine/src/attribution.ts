import type { Team } from './model.js';

export interface Assignment {
  readonly team: Team;
  readonly source: 'shared' | 'roster' | 'self' | 'heuristic';
  readonly confidence: number;
  readonly locked: boolean;
}

export interface AttributionState {
  readonly assignments: ReadonlyMap<string, Assignment>;
}

export interface AttributionEvidence {
  readonly userId: string;
  readonly hostId: string;
  readonly raiderId: string;
  readonly raidAtMs: number;
  readonly sourceBroadcasterId?: string;
  readonly firstHostMessageAtMs?: number | undefined;
  /** The caller derives this from salted hashes; no regular viewer list is persisted here. */
  readonly isRegular?: boolean | undefined;
  readonly roster?: ReadonlySet<string>;
  readonly chatterDelta?: ReadonlySet<string>;
}

export interface AttributionUpdate {
  readonly state: AttributionState;
  readonly assignment: Assignment;
}

/** Pure assignment rules. All match memory belongs to the returned state. */
export class AttributionEngine {
  start(): AttributionState {
    return { assignments: new Map() };
  }

  resolve(state: AttributionState, evidence: AttributionEvidence): AttributionUpdate {
    const previous = state.assignments.get(evidence.userId);
    const source = evidence.sourceBroadcasterId;
    if (source === evidence.hostId || source === evidence.raiderId) {
      return this.set(state, evidence.userId, {
        team: source === evidence.hostId ? 'home' : 'raiders',
        source: 'shared',
        confidence: 1,
        locked: previous?.locked ?? false,
      });
    }
    if (previous?.locked || previous?.source === 'shared' || previous?.source === 'self') {
      return { state, assignment: previous };
    }
    if (evidence.roster?.has(evidence.userId)) {
      return this.set(state, evidence.userId, {
        team: 'raiders',
        source: 'roster',
        confidence: 0.95,
        locked: false,
      });
    }
    if (previous?.source === 'roster') return { state, assignment: previous };
    return this.set(state, evidence.userId, this.heuristic(evidence));
  }

  select(state: AttributionState, userId: string, team: Team): AttributionUpdate {
    const previous = state.assignments.get(userId);
    if (previous?.locked || previous?.source === 'shared') return { state, assignment: previous };
    return this.set(state, userId, { team, source: 'self', confidence: 0.9, locked: false });
  }

  lock(state: AttributionState, userId: string): AttributionState {
    const previous = state.assignments.get(userId);
    if (!previous || previous.locked) return state;
    return this.set(state, userId, { ...previous, locked: true }).state;
  }

  parseSelection(message: string): Team | undefined {
    const selection = message.trim().toLowerCase();
    if (selection === '!join raiders' || selection === '!join red') return 'raiders';
    if (selection === '!join home' || selection === '!join blue') return 'home';
    return undefined;
  }

  private heuristic(evidence: AttributionEvidence): Assignment {
    let score = 0;
    if ((evidence.firstHostMessageAtMs ?? -Infinity) > evidence.raidAtMs) score += 0.35;
    if (evidence.isRegular === false) score += 0.35;
    if (evidence.chatterDelta?.has(evidence.userId)) score += 0.3;
    const team = score >= 0.6 ? 'raiders' : 'home';
    const strength = team === 'raiders' ? score : 1 - score;
    return {
      team,
      source: 'heuristic',
      confidence: Math.min(0.8, 0.5 + strength * 0.3),
      locked: false,
    };
  }

  private set(state: AttributionState, userId: string, assignment: Assignment): AttributionUpdate {
    const previous = state.assignments.get(userId);
    if (
      previous &&
      previous.team === assignment.team &&
      previous.source === assignment.source &&
      previous.confidence === assignment.confidence &&
      previous.locked === assignment.locked
    ) {
      return { state, assignment: previous };
    }
    const assignments = new Map(state.assignments);
    assignments.set(userId, assignment);
    return { state: { assignments }, assignment };
  }
}
