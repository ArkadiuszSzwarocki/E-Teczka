import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionCountdown,setSessionDeadline,sessionDeadline,subscribeSessionClock} from '../src/services/sessionClock.ts';
test('session clock counts down, resets to twenty minutes and never displays negative time',()=>{const now=Date.now();assert.equal(sessionCountdown(now+1200000,now),'20:00');assert.equal(sessionCountdown(now+61999,now),'01:02');assert.equal(sessionCountdown(now-1,now),'00:00');let updates=0;const unsubscribe=subscribeSessionClock(()=>updates++);setSessionDeadline(now+5000);assert.equal(sessionCountdown(sessionDeadline(),now),'00:05');setSessionDeadline(now+1200000);assert.equal(sessionCountdown(sessionDeadline(),now),'20:00');assert.equal(updates,2);unsubscribe();setSessionDeadline(0);});
