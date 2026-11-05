import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,segments,unionMinutes,fmtMinutes,localDay,localTime,
  mondayFor,shiftDay,validateShift,validateIncident,breakdown,statutoryWeeklyMinutes,
  statutoryWeekInfo,isWorkday,iso,
} from '../src/domain.mjs';
const shift=(start,end,extra={})=>({type:'shift',kind:'regular',start,end,breaks:[],...extra});
const seg=(s)=>unionMinutes(segments(s))/60000;
test('daily target 8h48',()=>assert.equal(DEFAULT_SETTINGS.dailyTargetMinutes,528));
test('weekly target 44h',()=>assert.equal(DEFAULT_SETTINGS.weeklyMinutes,2640));
test('8h duration',()=>assert.equal(seg(shift('2026-11-03T10:00:00Z','2026-11-03T18:00:00Z')),480));
test('60m pause',()=>assert.equal(seg(shift('2026-11-03T10:00:00Z','2026-11-03T18:00:00Z',{breaks:[{start:'2026-11-03T12:00:00Z',end:'2026-11-03T13:00:00Z'}]})),420));
test('overlapping pause intervals',()=>assert.equal(seg(shift('2026-11-03T10:00:00Z','2026-11-03T18:00:00Z',{breaks:[{start:'2026-11-03T12:00:00Z',end:'2026-11-03T13:00:00Z'},{start:'2026-11-03T12:30:00Z',end:'2026-11-03T13:30:00Z'}]})),390));
test('manual pause',()=>assert.equal(seg(shift('2026-11-03T10:00:00Z','2026-11-03T18:00:00Z',{manualBreakMinutes:30})),450));
test('interval union prevents double counting',()=>assert.equal(unionMinutes([[0,100],[50,200],[200,250]]),250));
test('interval union empty',()=>assert.equal(unionMinutes([]),0));
test('formats 8h48',()=>assert.equal(fmtMinutes(528),'8h48'));
test('formats negative duration',()=>assert.equal(fmtMinutes(-90),'−1h30'));
test('Monday start',()=>assert.equal(mondayFor('2026-11-05'),'2026-11-02'));
test('date rollover',()=>assert.equal(shiftDay('2026-12-31',1),'2027-01-01'));
test('Sao Paulo local date',()=>assert.equal(localDay('2026-11-05T02:00:00Z'),'2026-11-04'));
test('Sao Paulo local time',()=>assert.match(localTime('2026-11-05T21:30:00Z'),/18:30/));
test('Monday is workday',()=>assert.equal(isWorkday('2026-11-02'),true));
test('Sunday is rest day',()=>assert.equal(isWorkday('2026-11-01'),false));
test('EC141 original 44 hours',()=>assert.equal(statutoryWeeklyMinutes('2026-11-05'),2640));
test('EC141 42 hours after two months',()=>assert.equal(statutoryWeeklyMinutes('2026-12-16'),2520));
test('EC141 40 hours after transition',()=>assert.equal(statutoryWeeklyMinutes('2027-12-16'),2400));
test('crossing transition recognized',()=>assert.equal(statutoryWeekInfo('2026-12-15','2026-12-16').transition,true));
test('invalid date rejected',()=>assert.throws(()=>iso('nonsense'),/inválid/));
test('reversed shift rejected',()=>assert.throws(()=>validateShift({kind:'regular',start:'2026-11-03T18:00:00Z',end:'2026-11-03T10:00:00Z',manualBreakMinutes:0}),/depois/));
test('incident needs description',()=>assert.throws(()=>validateIncident({title:'Fato',description:'',at:'2026-11-03T10:00:00Z'}),/obrigat/));
test('extra shift counted once',()=>{const records=[shift('2026-11-03T10:00:00Z','2026-11-03T18:00:00Z'),shift('2026-11-03T16:00:00Z','2026-11-03T18:00:00Z',{kind:'extra'})];assert.equal(breakdown(records,'2026-11-03','2026-11-03').workedMinutes,480);});
test('shift crossing local midnight split',()=>{const result=breakdown([shift('2026-11-04T01:00:00Z','2026-11-04T05:00:00Z')],'2026-11-03','2026-11-04');assert.equal(result.byDay['2026-11-03'].workedMinutes,120);assert.equal(result.byDay['2026-11-04'].workedMinutes,120);});
