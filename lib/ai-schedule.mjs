import {createHmac} from 'node:crypto';
const digest=(key,secret)=>createHmac('sha256',secret).update('irregular-v2:'+key).digest();
const plans=new Map();
export function dailyPostPlan(at=Date.now(),secret=process.env.AI_WORKER_SECRET||''){
 const day=new Date(at+9*3600000).toISOString().slice(0,10),cacheKey=day+':'+secret;
 if(plans.has(cacheKey))return plans.get(cacheKey);
 const hash=s=>createHmac('sha256',secret).update('daily-v1:'+s).digest();
 const target=50+hash('target:'+day).readUInt32BE(0)%51,awake=Math.round(target*.8);
 const minutes=Array.from({length:1440},(_,i)=>({i,key:hash('minute:'+day+':'+i).toString('hex')}));
 const pick=(active,n)=>minutes.filter(m=>(m.i>=480||m.i<60)===active).sort((a,b)=>a.key.localeCompare(b.key)||a.i-b.i).slice(0,n).map(m=>m.i);
 const plan={day,target,awake,sleep:target-awake,minutes:[...pick(true,awake),...pick(false,target-awake)].sort((a,b)=>a-b)};
 if(plans.size>3)plans.clear();plans.set(cacheKey,plan);return plan;
}
// Independent minute trials: no reserved action in a five-minute window and no
// catch-up. A shared secret keeps retry/instance decisions identical.
export function aiScheduleDue(kind,at=Date.now(),secret=process.env.AI_WORKER_SECRET||''){
 if(kind==='post')return dailyPostPlan(at,secret).minutes.includes(Math.floor((at+9*3600000)/60000)%1440);
 const minute=Math.floor(at/60000),hour=Math.floor(at/3600000);
 const activity=digest(kind+':activity:'+hour,secret).readUInt32BE(0)%3;
 const threshold=(kind==='reply'?[0.24,0.40,0.56]:[0.04,0.06,0.08])[activity];
 return digest(kind+':due:'+minute,secret).readUInt32BE(0)/4294967296<threshold;
}
// Hourly activity weights let all six personas participate without a fixed
// rotation. Selection is stable within a minute, including retries.
export function aiWriterIndex(kind,at=Date.now(),count=6,secret=process.env.AI_WORKER_SECRET||''){
 if(!Number.isInteger(count)||count<1||count>32)throw Error('invalid_writer_count');
 const hour=Math.floor(at/3600000),minute=Math.floor(at/60000);
 const weights=Array.from({length:count},(_,i)=>1+digest(kind+':weight:'+hour+':'+i,secret).readUInt32BE(0)%4);
 let pick=digest(kind+':writer:'+minute,secret).readUInt32BE(0)%weights.reduce((a,b)=>a+b,0);
 for(let i=0;i<count;i++){pick-=weights[i];if(pick<0)return i;}
}
