/**
 * In-app notifications (alert center) + best-effort email delivery.
 *
 * Email is optional: configure RESEND_API_KEY (+ NOTIFY_EMAIL_FROM/TO) and
 * alerts also go out by mail; without it, in-app notifications still work.
 */

const pool = require('../db/pool');

async function sendEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL_TO;
  if (!apiKey || !to) return { skipped: true };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM || 'Veridis Finance <alerts@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });
    return { skipped: false, ok: res.ok };
  } catch {
    return { skipped: false, ok: false };
  }
}

/** Create a notification (deduped per open ref) and optionally email it. */
async function notify(organizationId, { type, severity = 'info', title, body, ref_type, ref_id, email = false }) {
  if (ref_type && ref_id) {
    const { rows } = await pool.query(
      `SELECT id FROM finance.notifications
        WHERE organization_id = $1 AND type = $2 AND ref_type = $3 AND ref_id = $4 AND read_at IS NULL
        LIMIT 1`,
      [organizationId, type, ref_type, String(ref_id)]
    );
    if (rows[0]) return { deduped: true, id: rows[0].id };
  }
  const { rows } = await pool.query(
    `INSERT INTO finance.notifications (organization_id, type, severity, title, body, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [organizationId, type, severity, title, body || null, ref_type || null, ref_id ? String(ref_id) : null]
  );
  if (email || severity === 'critical') {
    sendEmail({ subject: `[Veridis] ${title}`, html: `<p>${body || title}</p>` }).catch(() => {});
  }
  return { deduped: false, id: rows[0].id };
}

async function list(organizationId, { limit = 30, unreadOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, type, severity, title, body, ref_type, ref_id, read_at, created_at
       FROM finance.notifications
      WHERE organization_id = $1 ${unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC LIMIT $2`,
    [organizationId, limit]
  );
  return rows;
}

async function unreadCount(organizationId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.notifications WHERE organization_id = $1 AND read_at IS NULL`,
    [organizationId]
  );
  return rows[0]?.n || 0;
}

async function markRead(organizationId, id) {
  await pool.query(
    `UPDATE finance.notifications SET read_at = now() WHERE organization_id = $1 AND id = $2`,
    [organizationId, id]
  );
}

async function markAllRead(organizationId) {
  await pool.query(
    `UPDATE finance.notifications SET read_at = now() WHERE organization_id = $1 AND read_at IS NULL`,
    [organizationId]
  );
}

module.exports = { notify, list, unreadCount, markRead, markAllRead, sendEmail };
