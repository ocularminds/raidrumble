import type {
  Answer,
  MatchContext,
  Mvp,
  PlayerInput,
  Question,
  RoundModule,
  RoundResult,
  RoundView,
  Team,
  TeamMvps,
  TeamValues,
} from '../model.js';

interface QuizResponse {
  readonly question: number;
  readonly userId: string;
  readonly team: Team;
  readonly answer: Answer;
  readonly correct: boolean;
  readonly displayName?: string;
}

export interface QuizState {
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly questions: readonly Question[];
  readonly denominators: TeamValues;
  readonly responses: readonly QuizResponse[];
}

const answerMs = 10_000;
const questionMs = 12_500;
const questionCount = 4;

/** Authored game rules only. No real-person facts are synthesized by the engine. */
const fallbacks: readonly Question[] = [
  {
    id: 'quizFallback0',
    about: 'host',
    prompt: "Which team is the host's community?",
    choices: ['Home Guard ●', 'Raiders ▲', 'Neither team'],
    answer: 'A',
    explanation: "The host's community is the Home Guard ●.",
  },
  {
    id: 'quizFallback1',
    about: 'raider',
    prompt: 'Which team arrives with the raiding streamer?',
    choices: ['Home Guard ●', 'Raiders ▲', 'No team'],
    answer: 'B',
    explanation: 'The incoming community joins the Raiders ▲.',
  },
  {
    id: 'quizFallback2',
    about: 'host',
    prompt: 'How can a newcomer choose their team?',
    choices: [
      'Type !join home or !join raiders',
      'Repeat the same message',
      'Wait for another raid',
    ],
    answer: 'A',
    explanation: 'Choose before your first counted move.',
  },
  {
    id: 'quizFallback3',
    about: 'raider',
    prompt: "Who is the incoming community's Warlord?",
    choices: ['The host', 'The raiding streamer', 'The fusion boss'],
    answer: 'B',
    explanation: 'The raiding streamer leads the Raiders ▲.',
  },
];

/** Stateless plug-in: four introductions, each followed by an answer reveal. */
export class QuizRound implements RoundModule<QuizState> {
  readonly id = 'know-your-host';
  readonly durationMs = questionMs * questionCount;

  start(ctx: MatchContext): QuizState {
    const supplied = ctx.content.questions.filter(usable);
    const questions = Array.from({ length: questionCount }, (_, index) => {
      const about = index % 2 === 0 ? 'host' : 'raider';
      const question =
        supplied.filter((item) => item.about === about)[Math.floor(index / 2)] ?? fallbacks[index]!;
      return { ...question, choices: [...question.choices] as [string, string, string] };
    });
    return {
      startedAtMs: ctx.nowMs,
      elapsedMs: 0,
      questions,
      denominators: { home: denominator(ctx.teams.home), raiders: denominator(ctx.teams.raiders) },
      responses: [],
    };
  }

  onInput(state: QuizState, input: PlayerInput, ctx: MatchContext): QuizState {
    const currentTime = state.startedAtMs + state.elapsedMs;
    if (
      state.elapsedMs >= this.durationMs ||
      state.elapsedMs % questionMs >= answerMs ||
      input.kind !== 'answer' ||
      !isAnswer(input.value) ||
      !input.userId ||
      !Number.isFinite(input.atMs) ||
      input.atMs !== currentTime ||
      input.atMs > ctx.nowMs
    )
      return state;
    const index = questionIndex(state);
    const question = state.questions[index]!;
    const team = scoringTeam(question);
    if (
      input.team !== team ||
      state.responses.some(
        (response) => response.question === index && response.userId === input.userId,
      )
    )
      return state;
    const response: QuizResponse = {
      question: index,
      userId: input.userId,
      team,
      answer: input.value,
      correct: input.value === question.answer,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    };
    return { ...state, responses: [...state.responses, response] };
  }

  tick(state: QuizState, dtMs: number, ctx: MatchContext): QuizState {
    if (
      state.elapsedMs >= this.durationMs ||
      !Number.isFinite(dtMs) ||
      dtMs <= 0 ||
      !Number.isFinite(ctx.nowMs)
    )
      return state;
    return { ...state, elapsedMs: Math.min(this.durationMs, state.elapsedMs + dtMs) };
  }

  view(state: QuizState): RoundView {
    const index = questionIndex(state);
    const question = state.questions[index]!;
    const finished = state.elapsedMs >= this.durationMs;
    const reveal = finished || state.elapsedMs % questionMs >= answerMs;
    const team = scoringTeam(question);
    const scores = this.scores(state, true);
    return {
      id: this.id,
      title: 'Know Your Host',
      phase: finished ? 'finished' : reveal ? 'reveal' : 'active',
      elapsedMs: state.elapsedMs,
      durationMs: this.durationMs,
      remainingMs: Math.max(0, this.durationMs - state.elapsedMs),
      keyword: finished ? 'TOGETHER' : reveal ? `ANSWER: ${question.answer}` : 'A / B / C',
      instruction: finished
        ? 'Two communities. One boss next.'
        : reveal
          ? question.explanation || 'Answer revealed. Next question soon.'
          : `${team === 'raiders' ? 'Raiders ▲' : 'Home Guard ●'} · Type A, B or C. First answer counts.`,
      progress: state.elapsedMs / this.durationMs,
      scores,
      quiz: {
        index,
        total: questionCount,
        prompt: question.prompt,
        choices: question.choices,
        scoringTeam: team,
        ...(reveal ? { answer: question.answer } : {}),
        ...(reveal && question.explanation ? { explanation: question.explanation } : {}),
      },
      ...(finished ? { mvps: this.mvps(state) } : {}),
    };
  }

  result(state: QuizState): RoundResult {
    const scores = this.scores(state, false);
    const difference = scores.raiders - scores.home;
    return {
      roundId: this.id,
      winner: Math.abs(difference) < 1e-9 ? 'none' : difference > 0 ? 'raiders' : 'home',
      mvps: this.mvps(state),
      stats: {
        homeScore: scores.home,
        raidersScore: scores.raiders,
        homeAnswers: state.responses.filter((response) => response.team === 'home').length,
        raidersAnswers: state.responses.filter((response) => response.team === 'raiders').length,
        homeCorrect: state.responses.filter(
          (response) => response.team === 'home' && response.correct,
        ).length,
        raidersCorrect: state.responses.filter(
          (response) => response.team === 'raiders' && response.correct,
        ).length,
      },
    };
  }

  private scores(state: QuizState, revealedOnly: boolean): TeamValues {
    const counts = { home: 0, raiders: 0 };
    for (const response of state.responses) {
      if (
        response.correct &&
        (!revealedOnly || state.elapsedMs >= response.question * questionMs + answerMs)
      )
        counts[response.team]++;
    }
    return {
      home: counts.home / state.denominators.home,
      raiders: counts.raiders / state.denominators.raiders,
    };
  }

  private mvps(state: QuizState): TeamMvps {
    const home = new Map<string, Mvp>();
    const raiders = new Map<string, Mvp>();
    for (const response of state.responses) {
      if (!response.correct) continue;
      const team = response.team === 'home' ? home : raiders;
      const previous = team.get(response.userId);
      team.set(response.userId, {
        userId: response.userId,
        contribution: (previous?.contribution ?? 0) + 1,
        ...(response.displayName !== undefined ? { displayName: response.displayName } : {}),
      });
    }
    const top = (players: Map<string, Mvp>) =>
      [...players.values()]
        .sort(
          (a, b) =>
            b.contribution - a.contribution ||
            (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
        )
        .slice(0, 3);
    return { home: top(home), raiders: top(raiders) };
  }
}

function questionIndex(state: QuizState): number {
  return Math.min(questionCount - 1, Math.floor(state.elapsedMs / questionMs));
}

function scoringTeam(question: Question): Team {
  return question.about === 'host' ? 'raiders' : 'home';
}
function isAnswer(value: string): value is Answer {
  return value === 'A' || value === 'B' || value === 'C';
}
function denominator(size: number): number {
  return Math.max(5, Number.isFinite(size) ? size : 0);
}
function usable(question: Question): boolean {
  return Boolean(
    question &&
    question.id &&
    question.prompt &&
    (question.about === 'host' || question.about === 'raider') &&
    isAnswer(question.answer) &&
    question.choices?.length === 3 &&
    question.choices.every((choice) => typeof choice === 'string' && choice.trim()),
  );
}
