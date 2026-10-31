export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Twitch ${label}`);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Twitch ${label}`);
  return value;
}

export function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result) throw new Error(`Invalid Twitch ${label}`);
  return result;
}

export function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid Twitch ${label}`);
  }
  return value;
}

export function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Invalid Twitch ${label}`);
  }
  return [...value];
}

export function timestamp(value: unknown): number {
  const result = Date.parse(text(value, 'timestamp'));
  if (!Number.isFinite(result)) throw new Error('Invalid Twitch timestamp');
  return result;
}
