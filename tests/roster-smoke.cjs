'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start);
assert(start >= 0 && end > start, 'application logic script exists');
const core = html.slice(start + '<script>'.length, end).split('/* ---------- init ---------- */')[0];
const values = {
  startDate:'2026-10-01', numDays:'31', weekOffs:'0', attempts:'1200',
  restAfterNight:'1', balance:'shifts', shortPolicy:'cover', rotate:'1',
  autoLeave:'0', maxPosts:'2', minBlock:'1'
};
const document = {getElementById: id => ({value:values[id] || '', checked:false})};
const context = vm.createContext({console,document,values,Date,Math,Set,Map,JSON,Array,Number,String,Object});
vm.runInContext(core, context, {timeout:10000});
const ev = expression => vm.runInContext(expression,context,{timeout:10000});
const setMonth = (y,m) => {
  values.startDate = y+'-'+String(m).padStart(2,'0')+'-01';
  values.numDays = String(new Date(y,m,0).getDate());
};
function check(label, action){action();console.log('PASS '+label);}
check('11-night contingent limit and old default',()=>{
  assert.equal(ev('MAX_MONTHLY_NIGHTS'),11);
  assert.equal(ev('nightLimitFor(staff.find(s=>s.id==="s0"))'),11);
});
check('Monday and Friday pharmacy requires two day workers',()=>{
  assert.equal(ev('headsFor(posts.find(p=>p.shift==="D"&&p.req[0]==="Pharmacy"),1,cfg())'),2);
  assert.equal(ev('effectivePostMin(posts.find(p=>p.shift==="D"&&p.req[0]==="Pharmacy"),2,1,cfg())'),2);
  assert.equal(ev('headsFor(posts.find(p=>p.shift==="D"&&p.req[0]==="Pharmacy"),0,cfg())'),1);
});
check('Night-offs only follow five nights; no more than two',()=>{
  const sample=ev('({sched:Array.from({length:31},()=>({})),cycleOff:{s0:{0:"NO"}},lateShiftMap:{}})');
  context.sample=sample;
  const errors=ev('validateHardRules(sample,cfg())');
  assert(errors.some(s=>s.includes('NIGHT OFF on day 1 requires five consecutive')));
});
check('Evening map handles old and new serialized forms',()=>{
  assert.equal(ev('isEveningStaff(0,"s0",{0:"s0"})'),true);
  assert.equal(ev('isEveningStaff(0,"s0",{0:["s1","s0"]})'),true);
  assert.equal(ev('isEveningStaff(0,"s2",{0:["s1","s0"]})'),false);
});
check('Print/CSV integrity gate includes required post validation',()=>{
  const sample=ev('({sched:Array.from({length:31},()=>({})),cycleOff:{},lateShiftMap:{}})');
  context.sample=sample;
  const errors=ev('validateHardRules(sample,cfg())');
  assert(errors.some(s=>s.includes('Pharmacy needs separate DS')));
  assert(errors.some(s=>s.includes('mandatory staff')));
});
check('Carry over six workdays from preceding month',()=>{
  const prior={start:'2026-10-01',days:31,sched:Array.from({length:31},()=>({}))};
  for(let d=25;d<31;d++)prior.sched[d].s0={D:['N'],N:[]};
  context.prior=prior;
  ev('issuedHistory=[prior]; startState={}; startStateDate=""');
  setMonth(2026,11);
  assert.equal(ev('flexibleCarry(staff[0],cfg()).run'),6);
  const candidate=ev('({sched:Array.from({length:30},(_,i)=>i===0?{s0:{D:["N"],N:[]}}:{}),cycleOff:{},lateShiftMap:{}})');
  context.sample=candidate;
  assert(ev('validateHardRules(sample,cfg())').some(s=>s.includes('7 consecutive working days ending day 1')));
});
check('Cloud restore must invalidate old rules signatures',()=>{
  assert(html.includes('rulesVersion:18'));
});
console.log('Core regression checks completed.');

if(process.env.FULL_ROSTER_SMOKE==='1'){
  ev('issuedHistory=[]; startState={}; startStateDate=""; avail={}');
  for(let month=1;month<=12;month++){
    setMonth(2027,month);
    ev('ensureAvail();autoAssignLeave()');
    const begin=Date.now();
    let outcome;
    for(let retry=0;retry<3;retry++){
      outcome=ev('buildFlexible('+(12345+retry*101)+',cfg())');
      if(!outcome.error && !ev('validateHardRules(outcome,cfg())').length)break;
    }
    const errs=outcome?.error ? [outcome.error] : ev('validateHardRules(outcome,cfg())');
    if(errs.length||outcome.gaps?.length)throw new Error('2027-'+String(month).padStart(2,'0')+' failed: '+JSON.stringify(errs.slice(0,5))+' gaps='+JSON.stringify(outcome.gaps?.slice(0,4)));
    ev('issuedHistory=[...issuedHistory,{start:values.startDate,days:cfg().days,sched:outcome.sched,cycleOff:outcome.cycleOff,capWork:{}}].slice(-2)');
    console.log('PASS 2027-'+String(month).padStart(2,'0')+' continuous '+(Date.now()-begin)+'ms');
  }
}
