// The screencast service reuses the measured board and exports editor instructions, never fabricated rendered media.
import {check} from '../../../contracts.ts';
import type {YoutubeBoardBody} from './board-core.ts';
import type {EditWord} from './edit-ops.ts';
import {boardFiles} from './board-core.ts';
import {scriptCoverage} from './coverage.ts';
const measured=['source-resolution','black-band','safe-zone','loudness','true-peak','reading-time','commentary-share'];
export function screencastProof(input:{board:YoutubeBoardBody;words:readonly EditWord[];script:string|null;scripted:boolean}){
 const board=input.board;boardFiles(board);
 check(board.timeline.ranges.length>0&&board.outputs.some(row=>row.kind==='interchange'&&row.decision==='approved'),'OUTPUT_APPROVAL_REQUIRED','Approve the long-video editor instructions.');
 check(board.clips?.passed&&board.clips.rows.length===3&&board.clips.rows.every(row=>row.durationMs>=20000&&row.durationMs<=55000&&!row.problems.length),'CLIP_RULES_FAILED','Choose exactly three measured independent Shorts on the current board.');
 check(board.finishingBinding&&measured.every(id=>board.finishing?.some(row=>row.id===id&&row.outcome==='pass')),'FINISHING_FAILED','Measure the current finished output and resolve its required finishing checks. Missing measurements are not a pass.');
 check(board.outputs.some(row=>row.kind==='publishing'&&row.decision==='approved'),'OUTPUT_APPROVAL_REQUIRED','Approve the exact publishing text on the board.');
 check(!input.scripted||typeof input.script==='string'&&!!input.script.trim(),'OUTPUT_APPROVAL_REQUIRED','Approve the speech script in the source desk before checking this scripted recording.');
 const coverage=input.scripted?scriptCoverage(input.script!,input.words):null;
 check(!coverage?.missing.length,'SCRIPT_COVERAGE_FAILED','The current cut is missing approved script words. Resolve the missing passages before handoff.');
 return {clipCount:3,longVideoCount:1,clips:board.clips.rows.map(row=>({...row})),coverage,capability:'handoff' as const};
}
