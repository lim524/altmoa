import {inject} from './vendor/vercel-analytics.mjs';
import {injectSpeedInsights} from './vendor/vercel-speed-insights.mjs';
import configuration from './telemetry-config.mjs';
const privateScreen=()=>location.pathname==='/contact'||['activity','saved'].includes(new URLSearchParams(location.search).get('view'))||Boolean(location.hash);
function redact(event){if(privateScreen())return null;try{const url=new URL(event.url,location.origin);event.url=url.origin+url.pathname;}catch{return null;}return event;}
if(!privateScreen()&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){
 const conf=JSON.stringify(configuration);
 inject({mode:'production',beforeSend:redact},conf);
 injectSpeedInsights({sampleRate:.1,beforeSend:redact},conf);
}
