import q from './QrCode.module.css';

/**
 * The engine's QR matrix as squares (as the invoice sheet draws the UPI code); nothing about the link is worked out
 * here. Used by Business > Notifications and by the phone row in Connections (C5 task 3).
 */
export function QrCode({ rows, label }: { rows: readonly string[]; label: string }) {
  const side = rows.length + 8;
  const path = rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '1' ? [`M${x + 4} ${y + 4}h1v1h-1z`] : []))).join('');
  return (
    <svg className={q.qr} role="img" aria-label={label} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" focusable="false">
      <rect className={q.qrLight} width={side} height={side} />
      <path className={q.qrDark} d={path} />
    </svg>
  );
}
