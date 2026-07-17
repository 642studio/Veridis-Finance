const pool = require('../db/pool');
const ghlService = require('../services/ghlService');

/**
 * Scheduled maintenance (Vercel Cron). vercel.json schedules a daily GET to
 * /api/cron/daily; Vercel automatically sends `Authorization: Bearer
 * $CRON_SECRET` when the CRON_SECRET env var is set on the project. Without a
 * configured secret the endpoint refuses to run (fail closed).
 *
 * Current job: retry GHL webhook events parked in 'pending_csf' — invoices
 * paid in the CRM whose client had no Constancia on file at the time. Once the
 * client uploads their CSF (self-service link), the retry stamps the CFDI.
 */
async function cronRoutes(app) {
  app.get('/api/cron/daily', async (request, reply) => {
    const secret = String(process.env.CRON_SECRET || '').trim();
    const auth = String(request.headers.authorization || '');
    if (!secret || auth !== `Bearer ${secret}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { rows } = await pool.query(
      `SELECT id FROM finance.ghl_webhook_events
        WHERE status = 'pending_csf'
        ORDER BY created_at ASC
        LIMIT 25`
    );

    let retried = 0;
    let stillPending = 0;
    for (const row of rows) {
      try {
        await ghlService.retryPending(row.id);
        retried += 1;
      } catch (err) {
        // Still missing CSF (or transient PAC error) — leave it parked.
        stillPending += 1;
        request.log.warn(
          { event_id: row.id, err: err.message },
          'cron: pending_csf retry failed'
        );
      }
    }

    request.log.info(
      { source: 'cron_daily', found: rows.length, retried, still_pending: stillPending },
      'cron: daily maintenance done'
    );
    reply.send({ data: { found: rows.length, retried, still_pending: stillPending } });
  });
}

module.exports = cronRoutes;
