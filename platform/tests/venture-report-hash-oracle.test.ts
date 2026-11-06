import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {renderReportHtml} from '../runtime/venture/playbooks/kit/report/render-html.ts';
test('browser-safe report style hash equals the independent native SHA-256 base64 oracle',()=>{const html=renderReportHtml({title:'Source report',business:'Shop',asOf:'2026-10-29',blocks:[]});const style=/<style>([\s\S]*?)<\/style>/.exec(html)![1]!;const expected=createHash('sha256').update(style).digest('base64');assert.ok(html.includes("sha256-"+expected));});
