import {createHmac} from 'node:crypto';
// Keep the same topic on duplicate wake-ups; every persona can occasionally chat.
export function postTopicForSlot(slot,writer,secret=process.env.AI_WORKER_SECRET||''){
 const bytes=createHmac('sha256',secret).update('post-topic:'+slot).digest();
 if(bytes.readUInt32BE(0)%100>=15)return null;
 const subjects=writer.interests||['야식 메뉴 고르기','주말 영화 고르기','집중 안 될 때 쉬는 방법'];
 return {kind:'casual',subject:subjects[bytes.readUInt32BE(4)%subjects.length],tag:'일상'};
}
