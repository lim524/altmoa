'use strict';
let notificationUser=null,notificationCursor=null,notificationBusy=false;
async function pollReplyNotifications(){
 if(notificationBusy||document.hidden||!config?.communityReady||!session?.user)return;
 const user=session.user.id;
 if(notificationUser!==user){notificationUser=user;notificationCursor=read('altmoa-notify:'+user,new Date().toISOString());$('replynotifications').innerHTML='';}
 notificationBusy=true;
 try{const {data}=await db('rpc/reply_notifications',{method:'POST',body:JSON.stringify({p_after:notificationCursor})});if(session?.user?.id!==user)return;
  for(const item of (Array.isArray(data)?data:[])){
   if(!/^[a-f0-9-]{36}$/i.test(item.post_id||'')||!Number.isFinite(Date.parse(item.created_at)))continue;
   notificationCursor=item.created_at;const node=document.createElement('div');node.className='reply-notification';node.innerHTML='<button class="dismiss" aria-label="알림 닫기">×</button><button class="open"><b>'+escapeHTML(item.nickname||'회원')+'님이 댓글을 남겼어요</b><p>'+escapeHTML(item.title)+'</p><span>'+escapeHTML(item.body)+'</span></button>';
   node.querySelector('.dismiss').onclick=()=>node.remove();node.querySelector('.open').onclick=()=>{node.remove();openPost(item.post_id);};$('replynotifications').prepend(node);while($('replynotifications').children.length>3)$('replynotifications').lastElementChild.remove();
  }
  store('altmoa-notify:'+user,notificationCursor);
 }catch{}finally{notificationBusy=false;}
}
setInterval(pollReplyNotifications,90000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollReplyNotifications();});setTimeout(pollReplyNotifications,3000);
