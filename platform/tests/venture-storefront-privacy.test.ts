import test from 'node:test';import assert from 'node:assert/strict';
import {storefrontSessions} from '../runtime/venture/build/storefront-assistant-memory.ts';
import {clearSessionMemory} from '../runtime/venture/core/session-cleanup.ts';
import type {SecretShelf} from '../runtime/venture/contracts.ts';
test('host memory cleanup synchronously removes buyer text and session authority without a package import',()=>{const secrets:SecretShelf={get:()=>null,set:()=>{},delete:()=>{},has:()=>false,clear:()=>{}};const sessions=storefrontSessions({secrets,clock:()=>new Date(0)}),s=sessions.open('b','o','c');sessions.ask(s.token,'Private buyer words',{connectionId:'m',model:'model',route:'openai-responses',maxMicros:'100',rateDigest:'r',keyDigest:'k',binding:'b'});assert.equal(sessions.ownerPending('b','o').length,1);clearSessionMemory(secrets);assert.equal(sessions.ownerPending('b','o').length,0);assert.throws(()=>sessions.poll(s.token),{code:'STOREFRONT_SESSION_EXPIRED'});});
