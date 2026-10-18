-- Run only after /api/market-activity is deployed.
-- One lightweight public request per ten minutes keeps a real seven-day baseline.
select cron.schedule('altmoa-market-activity-10min','*/10 * * * *', $cron$select net.http_get(url:='https://www.altmoa.com/api/market-activity',timeout_milliseconds:=90000);$cron$);
