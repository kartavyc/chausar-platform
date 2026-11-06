import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasPosts } from '../runtime/venture/playbooks/social/canvas.ts';
test('canvas binds owner-review plans to exact post ordinals',()=>{
 const posts=canvasPosts('run1','X: A useful idea.\nLinkedIn: Another useful idea.\n\n## Post plan\nPost 2 | Sell | Goal: Explain our service | Reader action: Ask us | Hook: Story\nPost 1 | Value | Goal: Teach one idea | Reader action: Try it | Hook: Question');
 assert.equal(posts.length,2);
 assert.deepEqual(posts[0].plan,{kind:'value',goals:['Teach one idea'],actions:['Try it'],hookFormula:'Question'});
 assert.deepEqual(posts[1].plan,{kind:'sell',goals:['Explain our service'],actions:['Ask us'],hookFormula:'Story'});
});
test('invalid plan metadata never masquerades as a validated post plan',()=>{
 const posts=canvasPosts('run1','X: A useful idea.\n\n## Post plan\nPost 2 | Sell | Goal: Explain | Reader action: Ask | Hook: Story');
 assert.equal(posts[0].plan,null);
});
