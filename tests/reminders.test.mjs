import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const cron=require('../api/reminders.js');
const config=require('../api/push-config.js');
function response(){return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(c){this.code=c;return this},json(b){this.body=b;return this}};}
test('Sao Paulo Thursday is workday',()=>assert.equal(cron.isWorkday(new Date('2026-11-05T21:30:00Z')),true));
test('Sao Paulo Saturday is weekend',()=>assert.equal(cron.isWorkday(new Date('2026-11-07T21:30:00Z')),false));
test('cron requires authorization',async()=>{const r=response();await cron({method:'GET',headers:{}},r);assert.equal(r.code,401);});
test('cron requires GET',async()=>{const r=response();await cron({method:'POST',headers:{}},r);assert.equal(r.code,405);});
test('push config returns boolean enabled',()=>{const r=response();config({method:'GET'},r);assert.equal(typeof r.body.enabled,'boolean');});
test('push config rejects POST',()=>{const r=response();config({method:'POST'},r);assert.equal(r.code,405);});
