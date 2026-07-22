const pool = require('../db/pool');
const ghlService = require('../services/ghlService');
const satDownloadService = require('../services/satDownloadService');
const efosService = require('../services/efosService');
const cfdiStatusService = require('../services/cfdiStatusService');
const autoPolizaService = require('../services/autoPolizaService');
const bankPolizaService = require('../services/bankPolizaService');
const auditoriaService = require('../services/auditoriaService');
const notificationsService = require('../services/notificationsService');
const rateLimitStore = require('../middleware/rateLimitStore');

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
        ORDER BY received_at ASC
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

    // SAT Descarga Masiva backstop: advance any request the user opened but left
    // (the page auto-verifies while open; this catches the rest). The SAT is
    // async, so a request accepted minutes/hours ago may now be ready to import.
    const { rows: satRows } = await pool.query(
      `SELECT id, organization_id FROM finance.sat_download_requests
        WHERE status IN ('accepted','in_progress','downloading')
          AND sat_request_id IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 25`
    );
    let satChecked = 0;
    let satCompleted = 0;
    for (const row of satRows) {
      if (!row.id || !row.organization_id) continue;
      try {
        const updated = await satDownloadService.checkRequest(row.organization_id, row.id);
        satChecked += 1;
        if (updated?.status === 'completed') satCompleted += 1;
      } catch (err) {
        request.log.warn(
          { request_id: row.id, err: err.message },
          'cron: SAT verifica failed'
        );
      }
    }

    // Monitoreo diario (paridad Siigo): cruce EFOS 69-B y validación de
    // estatus de CFDIs ante el SAT para cada organización activa. Presupuesto
    // acotado por corrida para caber en la invocación serverless.
    const { rows: orgs } = await pool.query(
      `SELECT DISTINCT organization_id FROM finance.invoices LIMIT 20`
    );
    let efosHits = 0;
    let cfdisChecked = 0;
    let cfdisCanceled = 0;
    // Contabilidad autónoma: genera pólizas del mes en curso desde CFDIs y corre
    // la auditoría preventiva; si hay errores, levanta una alerta (deduplicada
    // por mes) para que el contador la vea antes de declarar.
    const nowD = new Date();
    const cy = nowD.getUTCFullYear();
    const cm = nowD.getUTCMonth() + 1;
    let polizasPosted = 0;
    let auditErrors = 0;
    for (const org of orgs) {
      try {
        const { hits } = await efosService.check(org.organization_id);
        efosHits += hits.length;
      } catch (err) {
        request.log.warn({ org: org.organization_id, err: err.message }, 'cron: EFOS check failed');
      }
      try {
        const v = await cfdiStatusService.verifyBatch(org.organization_id, { limit: 15 });
        cfdisChecked += v.checked;
        cfdisCanceled += v.nuevos_cancelados;
      } catch (err) {
        request.log.warn({ org: org.organization_id, err: err.message }, 'cron: validación SAT failed');
      }
      // Generación automática de pólizas: APAGADA por defecto. Las pólizas se
      // generan solo cuando el usuario lo pide (botón "Generar desde CFDIs",
      // conciliación o copiloto con confirmación). Prende con AUTO_POLIZAS=1.
      if (String(process.env.AUTO_POLIZAS || '') === '1') {
        try {
          const g = await autoPolizaService.generateForPeriod(org.organization_id, { year: cy, month: cm });
          polizasPosted += g.posted;
        } catch (err) {
          request.log.warn({ org: org.organization_id, err: err.message }, 'cron: auto-póliza failed');
        }
        try {
          // Pólizas de flujo (cobro/pago) de los movimientos ya conciliados.
          const bp = await bankPolizaService.generateForPeriod(org.organization_id, { year: cy, month: cm });
          polizasPosted += bp.posted;
        } catch (err) {
          request.log.warn({ org: org.organization_id, err: err.message }, 'cron: póliza de flujo failed');
        }
      }
      try {
        const a = await auditoriaService.run(org.organization_id, { year: cy, month: cm });
        if (a.resumen.error > 0) {
          auditErrors += a.resumen.error;
          const criticos = a.hallazgos.filter((h) => h.severidad === 'error').map((h) => h.titulo).join('; ');
          await notificationsService.notify(org.organization_id, {
            type: 'contabilidad_auditoria',
            severity: 'warning',
            title: `Auditoría contable: ${a.resumen.error} problema(s) en ${cm}/${cy}`,
            body: criticos,
            ref_type: 'periodo',
            ref_id: `${cy}-${String(cm).padStart(2, '0')}`,
          });
        }
      } catch (err) {
        request.log.warn({ org: org.organization_id, err: err.message }, 'cron: auditoría failed');
      }
    }

    // Purga ventanas viejas del store de rate limiting (best-effort).
    let rateLimitsPurged = 0;
    try {
      const p = await rateLimitStore.purge();
      rateLimitsPurged = p.deleted || 0;
    } catch (err) {
      request.log.warn({ err: err.message }, 'cron: purga de rate_limits falló');
    }

    request.log.info(
      {
        source: 'cron_daily',
        found: rows.length,
        retried,
        still_pending: stillPending,
        sat_checked: satChecked,
        sat_completed: satCompleted,
        efos_hits: efosHits,
        cfdis_checked: cfdisChecked,
        cfdis_canceled: cfdisCanceled,
        polizas_posted: polizasPosted,
        audit_errors: auditErrors,
        rate_limits_purged: rateLimitsPurged,
      },
      'cron: daily maintenance done'
    );
    reply.send({
      data: {
        found: rows.length,
        retried,
        still_pending: stillPending,
        sat_checked: satChecked,
        sat_completed: satCompleted,
        efos_hits: efosHits,
        cfdis_checked: cfdisChecked,
        cfdis_canceled: cfdisCanceled,
        polizas_posted: polizasPosted,
        audit_errors: auditErrors,
      },
    });
  });
}

module.exports = cronRoutes;
