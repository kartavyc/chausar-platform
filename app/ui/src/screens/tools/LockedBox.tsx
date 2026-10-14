/**
 * The locked box with its doors (TL-05): a box drawn with one door per thing a plugin may
 * reach (calculations it may read, actions it may propose, sites it may reach), each drawn
 * open or shut and labelled in words. Labels are text nodes; nothing here is markup from
 * the package.
 */
import { useId } from 'react';
import { fill } from './words.ts';
import type { Words } from './shared';
import s from './LockedBox.module.css';

const STEP = 30, TOP = 30, BOX_X = 40, BOX_W = 150, DOOR_H = 20;

export function doorLabel(id: string, w: Words): string {
  const k = id.toLowerCase();
  return k.startsWith('calc') ? w['door.calculation'] : k.startsWith('action') ? w['door.action'] : k.startsWith('site') ? w['door.site'] : id;
}

export function LockedBox({ doors, w }: { doors: readonly { readonly id: string; readonly open: boolean }[]; w: Words }) {
  const titleId = useId();
  const height = TOP * 2 + Math.max(1, doors.length) * STEP;
  const wall = BOX_X + BOX_W;
  return (
    <figure className={s.figure}>
      <svg className={s.svg} viewBox={`0 0 640 ${height}`} role="img" aria-labelledby={titleId} focusable="false">
        <title id={titleId}>{w.boxAlt}</title>
        {/* The box: top, left and bottom walls; the right wall is the doors. */}
        <path className={s.wall} d={`M${wall} ${TOP} H${BOX_X} V${height - TOP} H${wall}`} />
        <rect className={s.lock} x={BOX_X + 55} y={height / 2 - 6} width={40} height={24} rx={3} />
        <path className={s.wall} d={`M${BOX_X + 63} ${height / 2 - 6} v-8 a12 12 0 0 1 24 0 v8`} />
        {doors.map((d, i) => {
          const y = TOP + i * STEP + (STEP - DOOR_H) / 2;
          return (
            <g key={`${d.id}-${i}`} data-door={d.id} data-open={d.open ? 'yes' : 'no'}>
              <path className={s.wall} d={`M${wall} ${TOP + i * STEP} V${y} M${wall} ${y + DOOR_H} V${TOP + (i + 1) * STEP}`} />
              {d.open
                ? <line className={s.doorOpen} x1={wall} y1={y} x2={wall + 16} y2={y + DOOR_H - 6} />
                : <line className={s.doorShut} x1={wall} y1={y} x2={wall} y2={y + DOOR_H} />}
              <text className={s.text} x={wall + 28} y={y + DOOR_H - 5}>{fill(w.doorState, { label: doorLabel(d.id, w), state: d.open ? w.doorOpen : w.doorShut })}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className={s.caption}>{w.box}</figcaption>
    </figure>
  );
}
