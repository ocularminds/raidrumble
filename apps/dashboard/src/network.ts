import { channelLabel, plural } from './copy.js';

interface Network {
  nodes: { id: string; name?: string }[];
  edges: { source: string; target: string; matches: number; bossKills: number }[];
}

const ns = 'http://www.w3.org/2000/svg';

/** Small deterministic spring layout: only channel aggregates reach this page. */
export class RivalryMap {
  private signature = '';
  constructor(
    private readonly target: HTMLElement,
    private readonly hostId: string,
  ) {}

  render(graph: Network): void {
    const signature = JSON.stringify(graph);
    if (this.signature === signature) return;
    this.signature = signature;
    this.target.className = graph.nodes.length ? 'network' : 'network compact';
    if (!graph.nodes.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Complete a match to make your first connection.';
      this.target.replaceChildren(empty);
      return;
    }
    const nodes = graph.nodes.slice(0, 30).map((node, index) => ({
      ...node,
      x: 390 + Math.cos((index / graph.nodes.length) * Math.PI * 2) * 190,
      y: 130 + Math.sin((index / graph.nodes.length) * Math.PI * 2) * 80,
    }));
    for (let tick = 0; tick < 160; tick++) {
      for (const node of nodes) {
        let dx = (390 - node.x) * 0.012;
        let dy = (125 - node.y) * 0.014;
        for (const other of nodes) {
          if (other === node) continue;
          const x = node.x - other.x;
          const y = node.y - other.y;
          const distance = Math.max(12, Math.hypot(x, y));
          dx += ((x / distance) * 280) / distance;
          dy += ((y / distance) * 200) / distance;
        }
        for (const edge of graph.edges) {
          const peerId =
            edge.source === node.id
              ? edge.target
              : edge.target === node.id
                ? edge.source
                : undefined;
          const other = nodes.find((candidate) => candidate.id === peerId);
          if (!other) continue;
          const distance = Math.max(1, Math.hypot(node.x - other.x, node.y - other.y));
          dx += ((other.x - node.x) / distance) * (distance - 165) * 0.018;
          dy += ((other.y - node.y) / distance) * (distance - 165) * 0.018;
        }
        node.x = Math.max(80, Math.min(700, node.x + dx));
        node.y = Math.max(45, Math.min(180, node.y + dy));
      }
    }
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 780 260');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Rivalry connections between channels');
    for (const edge of graph.edges) {
      const start = nodes.find((node) => node.id === edge.source);
      const end = nodes.find((node) => node.id === edge.target);
      if (!start || !end) continue;
      const line = document.createElementNS(ns, 'line');
      for (const [key, value] of Object.entries({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke: '#647359',
        'stroke-width': Math.min(5, 1 + edge.matches),
      }))
        line.setAttribute(key, String(value));
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${plural(edge.matches, 'match', 'matches')} · ${plural(edge.bossKills, 'boss', 'bosses')} defeated`;
      line.append(title);
      svg.append(line);
      this.label(
        svg,
        `${edge.matches} MATCH${edge.matches === 1 ? '' : 'ES'}`,
        (start.x + end.x) / 2,
        (start.y + end.y) / 2 - 15,
        '#8b9c85',
        10,
      );
    }
    for (const [index, node] of nodes.entries()) {
      const home = node.id === this.hostId;
      const circle = document.createElementNS(ns, 'circle');
      for (const [key, value] of Object.entries({
        cx: node.x,
        cy: node.y,
        r: home ? 23 : 19,
        fill: home ? '#d6f99a' : '#ffa066',
        stroke: '#263b30',
        'stroke-width': 7,
      }))
        circle.setAttribute(key, String(value));
      svg.append(circle);
      this.label(svg, channelLabel(node, index), node.x, node.y + 46, '#dce5d5', 14);
    }
    this.target.replaceChildren(svg);
  }

  private label(
    svg: SVGSVGElement,
    text: string,
    x: number,
    y: number,
    fill: string,
    size: number,
  ): void {
    const label = document.createElementNS(ns, 'text');
    label.textContent = text;
    for (const [key, value] of Object.entries({
      x,
      y,
      fill,
      'font-size': size,
      'text-anchor': 'middle',
    }))
      label.setAttribute(key, String(value));
    svg.append(label);
  }
}
