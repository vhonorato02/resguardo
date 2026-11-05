'use strict';
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  const enabled = Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY
    && process.env.RESGUARDO_CRON_RPC_TOKEN
    && process.env.CRON_SECRET && process.env.VAPID_PUBLIC_KEY
    && process.env.VAPID_PRIVATE_KEY
  );
  return res.status(200).json({
    enabled, publicKey: enabled ? process.env.VAPID_PUBLIC_KEY : null,
    timezone: 'America/Sao_Paulo', supportedReminder: '18:30', precision: 'hourly',
  });
};
