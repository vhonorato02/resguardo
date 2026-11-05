'use strict';
const webpush = require('web-push');
const URL = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
function isWorkday(now = new Date()) {
  return !['Sat','Sun'].includes(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short',
  }).format(now));
}
async function rpc(name, body = {}) {
  const response = await fetch(URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: PUB, 'content-type': 'application/json' },
    body: JSON.stringify({ cron_token: process.env.RESGUARDO_CRON_RPC_TOKEN, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Supabase RPC ' + name + ' returned HTTP ' + response.status);
  if (response.status === 204) return null;
  return response.json();
}
module.exports = async function reminderCron(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  if (!isWorkday()) return res.status(200).json({ skipped: 'weekend' });
  if (!URL || !PUB || !process.env.RESGUARDO_CRON_RPC_TOKEN
    || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)
    return res.status(503).json({ error: 'Reminders are not configured' });
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:suporte@resguardo.app',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY,
    );
    const due = await rpc('resguardo_push_due');
    if (!Array.isArray(due)) throw new Error('Invalid notification queue');
    const summary = { processed: 0, delivered: 0, expired: 0, failures: 0 };
    for (const item of due) {
      summary.processed++;
      try {
        await webpush.sendNotification(item.subscription, JSON.stringify({
          title: 'Resguardo',
          body: 'Confira a sua jornada e registre os acontecimentos de hoje.',
        }), { TTL: 3600, urgency: 'normal' });
        await rpc('resguardo_push_mark_sent', { target_id: item.subscription_id });
        summary.delivered++;
      } catch (error) {
        const status = Number(error.statusCode || error.status);
        if (status === 404 || status === 410) {
          await rpc('resguardo_push_disable', { target_id: item.subscription_id });
          summary.expired++;
        } else summary.failures++;
      }
    }
    return res.status(200).json(summary);
  } catch (error) {
    console.error('Resguardo reminder error:', error.message);
    return res.status(502).json({ error: 'Reminder delivery failed' });
  }
};
module.exports.isWorkday = isWorkday;
