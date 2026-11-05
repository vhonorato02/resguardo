'use strict';
module.exports = (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Method Not Allowed'});
  const enabled = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET);
  return res.status(200).json({enabled, publicKey: enabled ? process.env.VAPID_PUBLIC_KEY : null,timezone:'America/Sao_Paulo',supportedReminder:'18:30',precision:'hourly'});
};