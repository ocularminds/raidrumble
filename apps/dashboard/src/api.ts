export const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class Api {
  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }
  async post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, body);
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const value: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value === 'object' && value !== null && 'error' in value
          ? String(value.error)
          : 'Connection unavailable.',
      );
    return value as T;
  }
}

export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

export function toast(message: string): void {
  const target = element('toast');
  target.textContent = message;
  target.hidden = false;
  setTimeout(() => {
    target.hidden = true;
  }, 4500);
}
