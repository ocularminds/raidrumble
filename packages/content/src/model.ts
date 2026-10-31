export interface ChannelProfile {
  id: string;
  name: string;
  category: string;
  title: string;
  tags: readonly string[];
  facts: readonly string[];
}

export interface Channels {
  host: ChannelProfile;
  raider: ChannelProfile;
}

export interface Selection {
  about: 'host' | 'raider';
  kind: 'category' | 'title' | 'fact';
  factIndex: number;
}

export interface ContentGenerator {
  generate(channels: Channels): Promise<unknown>;
  flagged?(text: string): Promise<boolean>;
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function display(value: string, maximum = 160): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- Display text intentionally strips C0/C1 controls.
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim()
      .slice(0, maximum)
  );
}
