import {createHmac} from 'node:crypto';
// Stable across serverless instances/retries, unpredictable outside the worker.
// The minute poll is only a wake-up; each five-minute window has its own due minute.
export function aiScheduleDue(kind,at=Date.now(),secret=process.env.AI_WORKER_SECRET||''){
 const slot=Math.floor(at/300000);
 const offset=createHmac('sha256',secret).update(kind+':'+slot).digest().readUInt32BE(0)%5;
 return at>=slot*300000+offset*60000;
}
