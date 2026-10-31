export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('POLICY_ERROR');
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\r\n]/.test(value))
    throw new Error('POLICY_ERROR');
  return value;
}

export function codes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('POLICY_ERROR');
  return value.map((item: unknown) => text(item));
}

export function timestamp(value: unknown): number {
  const input = text(value, 40);
  const result = Date.parse(input);
  if (!Number.isFinite(result) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(input))
    throw new Error('POLICY_ERROR');
  return result;
}

export function hash(value: unknown): string {
  const input = text(value);
  if (!/^sha256:[a-f0-9]{64}$/.test(input)) throw new Error('POLICY_ERROR');
  return input;
}

export function uuid(value: unknown): string {
  const input = text(value);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input))
    throw new Error('POLICY_ERROR');
  return input;
}

/** Canonical JSON used by the published agent-safe.intent/1 contract. */
export function canonical(value: unknown): string {
  let entries = 0;
  function visit(item: unknown, depth: number): unknown {
    if (++entries > 5_000 || depth > 20) throw new Error('POLICY_ERROR');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (item.length > 1_000) throw new Error('POLICY_ERROR');
      return item.map((child: unknown) => visit(child, depth + 1));
    }
    const source = record(item);
    const prototype: unknown = Object.getPrototypeOf(source);
    if (prototype !== null && prototype !== Object.prototype) throw new Error('POLICY_ERROR');
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('POLICY_ERROR');
      if (source[key] !== undefined) result[key] = visit(source[key], depth + 1);
    }
    return result;
  }
  const result = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(result, 'utf8') > 100 * 1024) throw new Error('POLICY_ERROR');
  return result;
}
