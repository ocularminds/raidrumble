export const palette = {
  white: '#f4f5f0',
  muted: '#a7b2c4',
  ink: '#101723',
  panel: 'rgba(15, 23, 35, 0.94)',
  line: '#334253',
  home: '#79b7ff',
  raiders: '#ffa066',
  lime: '#d6f99a',
};

export class Paint {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  text(
    text: string,
    x: number,
    y: number,
    size = 32,
    color = palette.white,
    align: CanvasTextAlign = 'left',
    weight = 600,
  ): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px "Avenir Next", "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  fit(text: string, width: number, size = 32): string {
    this.ctx.font = `600 ${size}px "Avenir Next", "Segoe UI", sans-serif`;
    if (this.ctx.measureText(text).width <= width) return text;
    let result = text;
    while (result.length && this.ctx.measureText(`${result}…`).width > width)
      result = result.slice(0, -1);
    return `${result}…`;
  }

  panel(
    x: number,
    y: number,
    width: number,
    height: number,
    radius = 28,
    fill = palette.panel,
    border = palette.line,
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 2): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  shape(team: 'home' | 'raiders', x: number, y: number, radius = 18): void {
    const ctx = this.ctx;
    ctx.beginPath();
    if (team === 'home') ctx.arc(x, y, radius, 0, Math.PI * 2);
    else {
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
    }
    ctx.fillStyle = palette[team];
    ctx.fill();
  }

  wrap(
    text: string,
    x: number,
    y: number,
    width: number,
    size: number,
    color = palette.white,
    maxLines = 4,
    centered = false,
  ): void {
    this.ctx.font = `600 ${size}px "Avenir Next", "Segoe UI", sans-serif`;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (this.ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    const visible = lines.slice(0, maxLines);
    if (lines.length > maxLines) visible[maxLines - 1] += '…';
    const top = centered ? y - ((visible.length - 1) * size * 1.3) / 2 : y;
    visible.forEach((value, row) =>
      this.text(this.fit(value, width, size), x, top + row * size * 1.3, size, color, 'center'),
    );
  }
}
