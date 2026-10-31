import { vi } from 'vitest';
import type { DashboardView } from '../../server/src/model.js';

/** Only the element properties used by dashboard controls, without a browser dependency. */
export class TestElement {
  hidden = false;
  disabled = false;
  checked = false;
  href = '';
  rel = '';
  target = '';
  title = '';
  value = '';
  innerHTML = '';
  textContent = '';
  className = '';
  children: TestElement[] = [];
  private readonly listeners = new Map<string, () => void>();
  addEventListener(event: string, callback: () => void): void {
    this.listeners.set(event, callback);
  }
  append(...children: TestElement[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: TestElement[]): void {
    this.children = children;
  }
  click(): void {
    this.listeners.get('click')?.();
  }
  removeAttribute(name: string): void {
    if (name === 'href') this.href = '';
  }
  setAttribute(): void {}
  get options(): TestElement[] {
    return this.children;
  }
}

export function dom() {
  const elements = new Map<string, TestElement>();
  const element = (id: string): TestElement => {
    if (!elements.has(id)) elements.set(id, new TestElement());
    return elements.get(id)!;
  };
  vi.stubGlobal('document', { createElement: () => new TestElement(), getElementById: element });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return { element };
}

export function dashboard(): DashboardView {
  return {
    arena: {
      hostId: '10',
      hostName: 'Garden',
      raiderName: 'Speed',
      status: 'idle',
      connected: true,
      simulated: false,
      reducedMotion: false,
    },
    decisions: [],
    settings: {
      allow: [],
      block: [],
      blockedTerms: [],
      mode: 'enforce',
      reducedMotion: false,
      facts: [],
    },
    twitch: {
      configured: true,
      hostConnected: false,
      botConnected: false,
      hostEventsConnected: false,
      chatEventsConnected: false,
      subscriptions: [],
      eventCount: 0,
    },
    overlayUrl: 'http://localhost:5173/overlay/10',
  };
}
