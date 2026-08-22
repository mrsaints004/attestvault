import { useEffect, useRef } from 'react';

export function Gauge({ score }: { score: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.86;
      const r = w * 0.38;
      const start = Math.PI;

      ctx!.lineWidth = w * 0.045;
      ctx!.lineCap = 'round';

      ctx!.beginPath();
      ctx!.arc(cx, cy, r, start, 0, true);
      ctx!.strokeStyle = cssVar('--surface-2') || '#ddd';
      ctx!.stroke();

      const frac = Math.max(0, Math.min(1000, score)) / 1000;
      const scoreEnd = start - frac * Math.PI;
      ctx!.beginPath();
      ctx!.arc(cx, cy, r, start, scoreEnd, true);
      ctx!.strokeStyle = cssVar('--accent') || '#B8791F';
      ctx!.stroke();

      ctx!.strokeStyle = cssVar('--slate-dim') || '#888';
      ctx!.lineWidth = 2;
      [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
        const a = start - f * Math.PI;
        const x1 = cx + Math.cos(a) * (r + w * 0.03);
        const y1 = cy + Math.sin(a) * (r + w * 0.03);
        const x2 = cx + Math.cos(a) * (r + w * 0.07);
        const y2 = cy + Math.sin(a) * (r + w * 0.07);
        ctx!.beginPath();
        ctx!.moveTo(x1, y1);
        ctx!.lineTo(x2, y2);
        ctx!.stroke();
      });

      const needleAngle = start - frac * Math.PI;
      ctx!.beginPath();
      ctx!.moveTo(cx, cy);
      ctx!.lineTo(cx + Math.cos(needleAngle) * r * 0.82, cy + Math.sin(needleAngle) * r * 0.82);
      ctx!.strokeStyle = cssVar('--ink') || '#141B26';
      ctx!.lineWidth = w * 0.012;
      ctx!.stroke();

      ctx!.beginPath();
      ctx!.arc(cx, cy, w * 0.02, 0, Math.PI * 2);
      ctx!.fillStyle = cssVar('--ink') || '#141B26';
      ctx!.fill();
    }

    draw();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', draw);
    return () => mq.removeEventListener('change', draw);
  }, [score]);

  return <canvas ref={ref} width={520} height={300} style={{ width: '100%', height: 'auto' }} />;
}
