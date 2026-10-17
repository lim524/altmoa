import {createHmac} from 'node:crypto';
const digest=(key,secret)=>createHmac('sha256',secret).update('irregular-v2:'+key).digest();
// Independent minute trials: no reserved action in a five-minute window and no
// catch-up. A shared secret keeps retry/instance decisions identical.
export function aiScheduleDue(kind,at=Date.now(),secret=process.env.AI_WORKER_SECRET||''){
 const minute=Math.floor(at/60000),hour=Math.floor(at/3600000);
 const activity=digest(kind+':activity:'+hour,secret).readUInt32BE(0)%3;
 const threshold=[0.12,0.20,0.28][activity];
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
