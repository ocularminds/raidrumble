import type { ContentPack, Question } from '@raidrumble/engine';
import { PolicyExecutor, type PolicyGate } from '@raidrumble/policy';
import type { Channels, ContentGenerator, Selection } from './model.js';
import { display, object } from './model.js';
import { channelTemplates, questionFrom, safeContent } from './templates.js';

export class ContentService {
  private readonly executor: PolicyExecutor;

  constructor(
    private readonly gate: PolicyGate,
    private readonly generator?: ContentGenerator,
    private readonly timeoutMs = 1800,
  ) {
    this.executor = new PolicyExecutor(gate);
  }

  async create(channels: Channels): Promise<ContentPack> {
    const templates = channelTemplates(channels);
    let questions = [...templates.questions];
    let boss = templates.boss;
    let moderationFlagged = false;
    if (this.generator) {
      try {
        const generated = await this.withTimeout(this.generator.generate(channels));
        if (object(generated)) {
          questions = this.questions(generated.selections, channels, questions);
          if (
            object(generated.boss) &&
            typeof generated.boss.name === 'string' &&
            typeof generated.boss.flavour === 'string'
          ) {
            const name = display(generated.boss.name, 60);
            const flavour = display(generated.boss.flavour, 140);
            if (name && flavour) boss = { name, flavour };
          }
          if (this.generator.flagged)
            moderationFlagged = await this.withTimeout(
              this.generator.flagged(JSON.stringify({ questions, boss })),
            );
        }
      } catch {
        questions = [...templates.questions];
        boss = templates.boss;
      }
    }
    const safe = safeContent();
    const gated = await Promise.all(
      questions.map(async (question, index) =>
        (await this.allowed(JSON.stringify(question), channels.host.id, moderationFlagged))
          ? question
          : safe.questions[index]!,
      ),
    );
    return {
      ...safe,
      questions: gated,
      boss: (await this.allowed(
        `${boss.name} ${boss.flavour}`,
        channels.host.id,
        moderationFlagged,
      ))
        ? boss
        : safe.boss,
    };
  }

  async name(value: string, hostId: string, fallback = 'Viewer'): Promise<string> {
    const name = display(value, 32);
    return name && (await this.allowed(name, hostId, false)) ? name : fallback;
  }

  private async allowed(
    text: string,
    hostId: string,
    moderationFlagged: boolean,
  ): Promise<boolean> {
    try {
      const decision = await this.gate.authorize({
        action: 'content.render',
        actor: { kind: 'llm' },
        channel: { hostId },
        payload: { text, moderationFlagged },
      });
      if (decision.verdict !== 'ALLOW') return false;
      return (await this.executor.execute(decision, () => true)).executed;
    } catch {
      return false;
    }
  }

  private questions(raw: unknown, channels: Channels, fallback: Question[]): Question[] {
    if (!Array.isArray(raw)) return fallback;
    return fallback.map((question, index) => {
      const selection: unknown = raw[index];
      if (
        !object(selection) ||
        selection.about !== question.about ||
        !['category', 'title', 'fact'].includes(String(selection.kind))
      )
        return question;
      const kind = selection.kind as Selection['kind'];
      const factIndex = Number(selection.factIndex);
      if (
        kind === 'fact' &&
        (!Number.isInteger(factIndex) ||
          factIndex < 0 ||
          factIndex > 2 ||
          !channels[question.about].facts[factIndex])
      )
        return question;
      return questionFrom(channels, { about: question.about, kind, factIndex }, index);
    });
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Content timeout')), this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
