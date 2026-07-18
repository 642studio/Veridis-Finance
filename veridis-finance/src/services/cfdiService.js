/**
 * CFDI service — orchestrates fiscal stamping (via pacService) and persistence
 * in finance.cfdi_documents, plus reading issued/received CFDIs.
 *
 * Per-tenant issuer/credentials come from finance.cfdi_issuers when present;
 * otherwise we fall back to the FACTURAMA_* env vars (single-tenant bootstrap).
 */

const pool = require('../db/pool');
const pac = require('./pacService');
const receiversService = require('./cfdiReceiversService');
const issuersService = require('./cfdiIssuersService');
const invoicesService = require('./invoicesService');
const { round } = require('../lib/money');

/**
 * Mirror an issued CFDI de Ingreso into finance.invoices (the reconcilable
 * ledger) as a receivable. Best-effort: never fail stamping if this errors.
 * Only type 'I' (Ingreso) is a receivable — Egreso/Pago are not mirrored.
 */
async function mirrorIssuedInvoice(organizationId, doc, issuer) {
  if (!doc || doc.cfdi_type !== 'I' || !doc.uuid) return null;
  try {
    return await invoicesService.upsertFromCfdi({
      organization_id: organizationId,
      uuid_sat: doc.uuid,
      emitter: `${issuer?.rfc || 'EMISOR'} - ${issuer?.legal_name || 'Mi empresa'}`,
      receiver: `${doc.receiver_rfc || ''} - ${doc.receiver_name || ''}`.trim(),
      emitter_rfc: issuer?.rfc || null,
      receiver_rfc: doc.receiver_rfc || null,
      total: doc.total ?? 0,
      invoice_date: doc.stamped_at || doc.created_at || new Date(),
      status: doc.payment_status === 'paid' ? 'paid' : 'pending',
      paid_at: doc.paid_at || null,
      currency: doc.currency || 'MXN',
      metodo_pago: doc.metodo_pago || null,
      direction: 'issued',
      source: 'issued_cfdi',
      cfdi_document_id: doc.id,
    });
  } catch {
    return null;
  }
}

/** Load the active issuer record for a tenant (or null). */
async function getIssuer(organizationId) {
  return issuersService.getActiveIssuer(organizationId);
}

/**
 * Resolve PAC provider + decrypted credentials for a tenant.
 * Prefers the per-tenant issuer record; falls back to env for the bootstrap
 * tenant. Delegated to cfdiIssuersService so encryption lives in one place.
 */
function resolveCreds(issuer) {
  return issuersService.resolveCreds(issuer);
}

function mapRow(r) {
  return {
    id: r.id,
    cfdi_type: r.cfdi_type,
    status: r.status,
    uuid: r.uuid,
    folio: r.folio,
    receiver_rfc: r.receiver_rfc,
    receiver_name: r.receiver_name,
    total: r.total != null ? Number(r.total) : null,
    currency: r.currency,
    metodo_pago: r.metodo_pago,
    pac_document_id: r.pac_document_id,
    source: r.source,
    source_ref: r.source_ref,
    ghl_invoice_id: r.ghl_invoice_id || null,
    ghl_contact_id: r.ghl_contact_id || null,
    payment_status: r.payment_status || 'pending',
    paid_at: r.paid_at || null,
    paid_source: r.paid_source || null,
    error_message: r.error_message,
    created_at: r.created_at,
    stamped_at: r.stamped_at,
  };
}

/**
 * Issue (stamp) a CFDI de Ingreso and persist it. Idempotent per (source, source_ref).
 *
 * @param {object} input
 * @param {string} input.organization_id
 * @param {object} input.receiver  { rfc, name, fiscalRegime, use, zip }
 * @param {Array}  input.items
 * @param {string} [input.paymentForm]  '01' default
 * @param {'PUE'|'PPD'} [input.paymentMethod]  'PUE' default
 * @param {string} [input.source]      'manual' | 'ghl' | 'api'
 * @param {string} [input.source_ref]  external id for idempotency
 * @param {string} [input.invoice_id]  link to finance.invoices
 */
async function issueIngreso(input) {
  const organizationId = input.organization_id;

  // Resolve the receiver: either a stored profile (receiver_id) or inline data.
  let receiver = input.receiver;
  let receiverId = input.receiver_id || null;
  let receiverContactId = input.ghl_contact_id || null;
  if (receiverId) {
    const profile = await receiversService.getById({ organization_id: organizationId, id: receiverId });
    if (!profile) {
      const err = new Error('Receiver profile not found');
      err.statusCode = 404;
      throw err;
    }
    receiver = {
      rfc: profile.rfc,
      name: profile.name,
      fiscalRegime: profile.fiscal_regime,
      use: profile.cfdi_use,
      zip: profile.zip_code,
    };
    receiverContactId = receiverContactId || profile.ghl_contact_id || null;
  }
  input = { ...input, receiver };

  // Idempotency: return the existing CFDI for this external document.
  if (input.source_ref) {
    const { rows } = await pool.query(
      `SELECT * FROM finance.cfdi_documents
        WHERE organization_id = $1 AND source = $2 AND source_ref = $3`,
      [organizationId, input.source || 'api', input.source_ref]
    );
    if (rows[0]) return { data: mapRow(rows[0]), idempotent: true };
  }

  const issuer = await getIssuer(organizationId);
  const { provider, creds } = resolveCreds(issuer);

  let stamped;
  try {
    stamped = await pac.stampIngreso({
      provider,
      creds,
      receiver: input.receiver,
      items: input.items,
      expeditionPlace: input.expeditionPlace || issuer?.zip_code,
      paymentForm: input.paymentForm || '01',
      paymentMethod: input.paymentMethod || 'PUE',
      folio: input.folio,
    });
  } catch (err) {
    // Persist the failed attempt for observability.
    await pool.query(
      `INSERT INTO finance.cfdi_documents
        (organization_id, issuer_id, invoice_id, cfdi_type, status, receiver_rfc,
         receiver_name, metodo_pago, forma_pago, source, source_ref, error_message, pac_provider)
       VALUES ($1,$2,$3,'I','error',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        organizationId, issuer?.id || null, input.invoice_id || null,
        input.receiver.rfc, input.receiver.name,
        input.paymentMethod || 'PUE', input.paymentForm || '01',
        input.source || 'api', input.source_ref || null,
        String(err.message).slice(0, 500), provider,
      ]
    );
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO finance.cfdi_documents
      (organization_id, issuer_id, receiver_id, invoice_id, cfdi_type, status, uuid, folio,
       receiver_rfc, receiver_name, cfdi_use, metodo_pago, forma_pago, currency,
       total, pac_provider, pac_document_id, source, source_ref, ghl_contact_id, raw, stamped_at)
     VALUES ($1,$2,$3,$4,'I','stamped',$5,$6,$7,$8,$9,$10,$11,'MXN',$12,$13,$14,$15,$16,$17,$18, now())
     RETURNING *`,
    [
      organizationId, issuer?.id || null, receiverId, input.invoice_id || null,
      stamped.uuid, String(stamped.folio ?? ''),
      input.receiver.rfc, input.receiver.name, input.receiver.use || 'G03',
      input.paymentMethod || 'PUE', input.paymentForm || '01',
      round(stamped.total ?? 0), provider, stamped.id,
      input.source || 'api', input.source_ref || null, receiverContactId,
      JSON.stringify(stamped.raw || {}),
    ]
  );

  const doc = mapRow(rows[0]);

  // Mirror into the reconcilable invoice ledger (receivable).
  await mirrorIssuedInvoice(organizationId, doc, issuer);

  // Veridis -> CRM: when a CFDI is issued *inside* Veridis (not from a CRM
  // webhook) for a receiver linked to a CRM contact, mirror it as an invoice in
  // the 642 CRM. Best-effort: never fail the stamping if the CRM call errors.
  if (input.source !== 'ghl' && receiverContactId && input.pushToCrm !== false) {
    try {
      // Lazy require avoids a circular dependency (ghlService requires this).
      const ghl = require('./ghlService');
      const ghlInvoiceId = await ghl.createInvoiceForCfdi(organizationId, {
        contactId: receiverContactId,
        receiver: input.receiver,
        items: input.items,
        currency: 'MXN',
      });
      if (ghlInvoiceId) {
        const linked = await linkGhlInvoice({ organization_id: organizationId, id: doc.id, ghl_invoice_id: ghlInvoiceId });
        if (linked) return { data: linked };
      }
    } catch (err) {
      // swallow: CRM mirroring is best-effort
    }
  }

  return { data: doc };
}

/** Link a Veridis CFDI to the invoice we created in the CRM. */
async function linkGhlInvoice({ organization_id, id, ghl_invoice_id }) {
  const { rows } = await pool.query(
    `UPDATE finance.cfdi_documents
        SET ghl_invoice_id = $3
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [organization_id, id, ghl_invoice_id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Mark a CFDI as paid (reconciled). `source` is where the payment was
 * confirmed: 'veridis' (marked in-app) or 'crm' (paid in the 642 CRM).
 * Idempotent: an already-paid CFDI is returned unchanged.
 */
async function markPaid({ organization_id, id, source = 'veridis' }) {
  const { rows } = await pool.query(
    `UPDATE finance.cfdi_documents
        SET payment_status = 'paid',
            paid_at = COALESCE(paid_at, now()),
            paid_source = COALESCE(paid_source, $3)
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [organization_id, id, source]
  );
  if (!rows[0]) return null;
  const doc = mapRow(rows[0]);
  // Keep the mirrored invoice's paid status in sync.
  const issuer = await getIssuer(organization_id);
  await mirrorIssuedInvoice(organization_id, doc, issuer);
  return doc;
}

/** Find a CFDI by the CRM invoice id it was mirrored to (for payment sync). */
async function findByGhlInvoice({ organization_id, ghl_invoice_id }) {
  if (!ghl_invoice_id) return null;
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents
      WHERE organization_id = $1 AND ghl_invoice_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [organization_id, ghl_invoice_id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

async function getRawById(organization_id, id) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents WHERE organization_id = $1 AND id = $2`,
    [organization_id, id]
  );
  return rows[0] || null;
}

/**
 * Resolve the full fiscal receiver (rfc, name, régimen, uso, CP) for a stamped
 * document: an inline override wins, then the stored receiver profile, else
 * 409 — CFDI 4.0 needs régimen+CP and the document row alone doesn't carry them.
 */
async function resolveReceiverForDoc(organizationId, row, inlineReceiver) {
  if (inlineReceiver) return inlineReceiver;
  if (row.receiver_id) {
    const profile = await receiversService.getById({
      organization_id: organizationId,
      id: row.receiver_id,
    });
    if (profile) {
      return {
        rfc: profile.rfc,
        name: profile.name,
        fiscalRegime: profile.fiscal_regime,
        use: profile.cfdi_use,
        zip: profile.zip_code,
      };
    }
  }
  const err = new Error(
    'El CFDI no tiene un perfil de receptor con datos fiscales completos; envía receiver con rfc, name, fiscalRegime y zip'
  );
  err.statusCode = 409;
  throw err;
}

/** Persist a stamped E/P document row (shared by credit notes and REPs). */
async function insertStampedDoc(organizationId, params) {
  const { rows } = await pool.query(
    `INSERT INTO finance.cfdi_documents
      (organization_id, issuer_id, receiver_id, invoice_id, cfdi_type, status, uuid, folio,
       receiver_rfc, receiver_name, cfdi_use, metodo_pago, forma_pago, currency,
       total, pac_provider, pac_document_id, source, source_ref, ghl_contact_id, raw, stamped_at)
     VALUES ($1,$2,$3,$4,$5,'stamped',$6,$7,$8,$9,$10,$11,$12,'MXN',$13,$14,$15,$16,$17,$18,$19, now())
     RETURNING *`,
    [
      organizationId,
      params.issuer_id || null,
      params.receiver_id || null,
      params.invoice_id || null,
      params.cfdi_type,
      params.uuid,
      String(params.folio ?? ''),
      params.receiver_rfc,
      params.receiver_name,
      params.cfdi_use || null,
      params.metodo_pago || null,
      params.forma_pago || null,
      round(params.total ?? 0),
      params.pac_provider,
      params.pac_document_id,
      params.source || 'manual',
      params.source_ref || null,
      params.ghl_contact_id || null,
      JSON.stringify(params.raw || {}),
    ]
  );
  return mapRow(rows[0]);
}

/**
 * Issue a CFDI de Egreso (nota de crédito) related to a stamped CFDI.
 *
 * EXPERIMENTAL: the payload follows Facturama's documented shape but has not
 * been validated against the PAC sandbox yet (needs sandbox credentials).
 *
 * relationType: '01' nota de crédito | '03' devolución.
 */
async function issueCreditNote({
  organization_id,
  id,
  items,
  relationType = '01',
  paymentForm,
  receiver: inlineReceiver,
  expeditionPlace,
  folio,
  source = 'manual',
  source_ref = null,
}) {
  const row = await getRawById(organization_id, id);
  if (!row) {
    const err = new Error('CFDI not found');
    err.statusCode = 404;
    throw err;
  }
  if (row.status !== 'stamped' || !row.uuid) {
    const err = new Error('Solo se puede emitir una nota de crédito sobre un CFDI timbrado');
    err.statusCode = 409;
    throw err;
  }

  const receiver = await resolveReceiverForDoc(organization_id, row, inlineReceiver);
  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);

  const stamped = await pac.stampEgreso({
    provider,
    creds,
    receiver: { ...receiver, use: 'G02' },
    items,
    relatedUuid: row.uuid,
    relationType,
    // Default the payment form to the original document's, per common practice.
    paymentForm: paymentForm || row.forma_pago || '03',
    expeditionPlace:
      expeditionPlace || issuer?.zip_code || process.env.FACTURAMA_EXPEDITION_PLACE,
    folio,
  });

  const doc = await insertStampedDoc(organization_id, {
    cfdi_type: 'E',
    issuer_id: issuer?.id || null,
    receiver_id: row.receiver_id,
    invoice_id: row.invoice_id,
    uuid: stamped.uuid,
    folio: stamped.folio,
    receiver_rfc: receiver.rfc,
    receiver_name: receiver.name,
    cfdi_use: 'G02',
    metodo_pago: 'PUE',
    forma_pago: paymentForm || row.forma_pago || '03',
    total: stamped.total,
    pac_provider: provider,
    pac_document_id: stamped.id,
    source,
    source_ref,
    ghl_contact_id: row.ghl_contact_id,
    raw: { ...stamped.raw, related_uuid: row.uuid, relation_type: relationType },
  });
  return { data: doc };
}

/**
 * Issue a CFDI de Pago (Complemento de Pago 2.0 / REP) for a stamped PPD CFDI.
 *
 * EXPERIMENTAL: validate against the PAC sandbox before production use.
 * When the payment settles the remaining balance, the original document is
 * marked paid.
 */
async function registerPayment({ organization_id, id, payment = {}, receiver: inlineReceiver, expeditionPlace }) {
  const row = await getRawById(organization_id, id);
  if (!row) {
    const err = new Error('CFDI not found');
    err.statusCode = 404;
    throw err;
  }
  if (row.status !== 'stamped' || !row.uuid) {
    const err = new Error('Solo se puede registrar un pago sobre un CFDI timbrado');
    err.statusCode = 409;
    throw err;
  }
  if (row.metodo_pago !== 'PPD') {
    const err = new Error('El Complemento de Pago aplica solo a CFDIs con método de pago PPD');
    err.statusCode = 409;
    throw err;
  }

  const receiver = await resolveReceiverForDoc(organization_id, row, inlineReceiver);
  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);

  const total = Number(row.total || 0);
  const normalizedPayment = {
    date: payment.date || new Date().toISOString().slice(0, 10),
    paymentForm: payment.payment_form || '03',
    amount: payment.amount ?? total,
    previousBalance: payment.previous_balance ?? total,
    partialityNumber: payment.partiality_number || 1,
    currency: 'MXN',
    taxObject: payment.tax_object || '01',
  };

  const stamped = await pac.stampPago({
    provider,
    creds,
    receiver,
    relatedUuid: row.uuid,
    payment: normalizedPayment,
    expeditionPlace:
      expeditionPlace || issuer?.zip_code || process.env.FACTURAMA_EXPEDITION_PLACE,
  });

  const doc = await insertStampedDoc(organization_id, {
    cfdi_type: 'P',
    issuer_id: issuer?.id || null,
    receiver_id: row.receiver_id,
    invoice_id: row.invoice_id,
    uuid: stamped.uuid,
    folio: stamped.folio,
    receiver_rfc: receiver.rfc,
    receiver_name: receiver.name,
    cfdi_use: 'CP01',
    metodo_pago: null,
    forma_pago: normalizedPayment.paymentForm,
    total: normalizedPayment.amount,
    pac_provider: provider,
    pac_document_id: stamped.id,
    source: 'manual',
    raw: { ...stamped.raw, related_uuid: row.uuid, payment: normalizedPayment },
  });

  // Settled in full → reconcile the original as paid.
  const remaining =
    Number(normalizedPayment.previousBalance) - Number(normalizedPayment.amount);
  let original = null;
  if (remaining <= 0.009) {
    original = await markPaid({ organization_id, id, source: 'veridis' });
  }

  return { data: doc, original_paid: Boolean(original) };
}

/**
 * Issue a CFDI de Nómina 1.2 (recibo de nómina) for an employee.
 *
 * EXPERIMENTAL: validate against the PAC sandbox before running real payroll.
 * When member_id is given, the employee name/RFC default from the members
 * module; inline employee fields always win.
 */
async function issuePayroll({ organization_id, member_id, employee = {}, payroll, perceptions, deductions }) {
  let resolvedEmployee = { ...employee };
  if (member_id) {
    const { rows } = await pool.query(
      `SELECT full_name, rfc FROM finance.members WHERE organization_id = $1 AND id = $2`,
      [organization_id, member_id]
    );
    const member = rows[0];
    if (!member) {
      const err = new Error('Member not found');
      err.statusCode = 404;
      throw err;
    }
    resolvedEmployee = {
      name: member.full_name,
      rfc: member.rfc,
      ...resolvedEmployee,
    };
  }
  if (!resolvedEmployee.rfc || !resolvedEmployee.name || !resolvedEmployee.zip) {
    const err = new Error('employee requiere rfc, name y zip (código postal del empleado)');
    err.statusCode = 400;
    throw err;
  }

  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);

  const stamped = await pac.stampNomina({
    provider,
    creds,
    employee: resolvedEmployee,
    payroll,
    perceptions,
    deductions,
    expeditionPlace: issuer?.zip_code,
  });

  const doc = await insertStampedDoc(organization_id, {
    cfdi_type: 'N',
    issuer_id: issuer?.id || null,
    uuid: stamped.uuid,
    folio: stamped.folio,
    receiver_rfc: resolvedEmployee.rfc,
    receiver_name: resolvedEmployee.name,
    cfdi_use: 'CN01',
    metodo_pago: null,
    forma_pago: '99',
    total: stamped.total,
    pac_provider: provider,
    pac_document_id: stamped.id,
    source: 'manual',
    raw: { ...stamped.raw, member_id: member_id || null },
  });
  return { data: doc };
}

/**
 * Cancel a stamped CFDI at the PAC and persist the outcome.
 * motive: '01' (con sustitución, requires substitution UUID) | '02' (default) |
 * '03' | '04'. The PAC acuse (acknowledgement) is stored on the raw column.
 */
async function cancel({ organization_id, id, motive = '02', substitution = null }) {
  const doc = await getById({ organization_id, id });
  if (!doc) {
    const err = new Error('CFDI not found');
    err.statusCode = 404;
    throw err;
  }
  if (doc.status === 'canceled') {
    return { data: doc, idempotent: true };
  }
  if (!doc.pac_document_id) {
    const err = new Error('CFDI has no PAC document id; cannot cancel');
    err.statusCode = 409;
    throw err;
  }
  if (motive === '01' && !substitution) {
    const err = new Error('Motivo 01 requiere el UUID de sustitución');
    err.statusCode = 400;
    throw err;
  }

  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);
  let acuse;
  try {
    acuse = await pac.cancel(doc.pac_document_id, {
      provider,
      creds,
      motive,
      substitution,
    });
  } catch (err) {
    // Surface the PAC's reason instead of a masked 500 — cancellation failures
    // (plazo vencido, requiere aceptación, sandbox no disponible) are
    // actionable business errors, not internals.
    const reason = String(err.message || 'Error del PAC').slice(0, 300);
    const wrapped = new Error(`No se pudo cancelar en el PAC: ${reason}`);
    wrapped.statusCode = 400;
    throw wrapped;
  }

  const { rows } = await pool.query(
    `UPDATE finance.cfdi_documents
        SET status = 'canceled', canceled_at = now(),
            raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('cancel_acuse', $3::jsonb)
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [organization_id, id, JSON.stringify(acuse || {})]
  );
  return { data: rows[0] ? mapRow(rows[0]) : doc, acuse };
}

/**
 * Backfill: mirror every stamped CFDI de Ingreso (manual, CRM webhook, CRM
 * history import) into finance.invoices as a receivable. Idempotent.
 */
async function syncIssuedToInvoices(organizationId) {
  const issuer = await getIssuer(organizationId);
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents
      WHERE organization_id = $1 AND cfdi_type = 'I' AND status = 'stamped' AND uuid IS NOT NULL`,
    [organizationId]
  );
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const result = await mirrorIssuedInvoice(organizationId, mapRow(row), issuer);
    if (result?.inserted) created += 1;
    else if (result) updated += 1;
  }
  return { found: rows.length, created, updated };
}

/**
 * Pull the tenant's RECEIVED CFDIs from the PAC and persist them into
 * finance.invoices as payables (direction=received), so supplier payments are
 * reconcilable and feed DIOT. Deduped by UUID. Best-effort per document.
 */
async function syncReceivedToInvoices(organizationId) {
  const issuer = await getIssuer(organizationId);
  const { provider, creds } = resolveCreds(issuer);
  let list = [];
  try {
    list = await pac.list('received', { provider, creds });
  } catch (err) {
    const e = new Error(`No se pudieron obtener facturas recibidas del PAC: ${String(err.message).slice(0, 200)}`);
    e.statusCode = err.statusCode || 502;
    throw e;
  }

  const summary = { found: Array.isArray(list) ? list.length : 0, created: 0, updated: 0, skipped: 0 };
  for (const c of list || []) {
    const uuid = c?.Complement?.TaxStamp?.Uuid || c?.Uuid || null;
    if (!uuid) {
      summary.skipped += 1;
      continue;
    }
    const emitterRfc = c?.Issuer?.Rfc || c?.IssuerRfc || null;
    const emitterName = c?.Issuer?.Name || c?.IssuerName || '';
    const result = await invoicesService.upsertFromCfdi({
      organization_id: organizationId,
      uuid_sat: uuid,
      emitter: `${emitterRfc || ''} - ${emitterName}`.trim(),
      receiver: `${issuer?.rfc || ''} - ${issuer?.legal_name || 'Mi empresa'}`.trim(),
      emitter_rfc: emitterRfc,
      receiver_rfc: issuer?.rfc || null,
      total: Number(c?.Total ?? 0),
      subtotal: c?.Subtotal != null ? Number(c.Subtotal) : null,
      invoice_date: c?.Date || new Date(),
      status: 'pending',
      currency: c?.Currency || 'MXN',
      direction: 'received',
      source: 'pac_received',
    });
    if (result?.inserted) summary.created += 1;
    else summary.updated += 1;
  }
  return summary;
}

/** Run both syncs: mirror issued receivables + pull received payables. */
async function syncInvoices(organizationId) {
  const issued = await syncIssuedToInvoices(organizationId);
  let received = { found: 0, created: 0, updated: 0, skipped: 0, error: null };
  try {
    received = await syncReceivedToInvoices(organizationId);
  } catch (err) {
    // Received sync needs a working PAC; report the error but keep issued sync.
    received.error = String(err.message).slice(0, 200);
  }
  return { issued, received };
}

/** List issued CFDIs from our DB. */
async function listIssued({ organization_id, limit = 50, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents
      WHERE organization_id = $1 AND cfdi_type = 'I'
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [organization_id, limit, offset]
  );
  return rows.map(mapRow);
}

async function getById({ organization_id, id }) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents WHERE organization_id = $1 AND id = $2`,
    [organization_id, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

async function getPacDocumentId({ organization_id, id }) {
  const { rows } = await pool.query(
    `SELECT pac_document_id FROM finance.cfdi_documents WHERE organization_id = $1 AND id = $2`,
    [organization_id, id]
  );
  return rows[0]?.pac_document_id || null;
}

/** Download the stamped PDF/XML for one of our CFDIs. kind: 'pdf' | 'xml'. */
async function download({ organization_id, id, kind }) {
  const pacId = await getPacDocumentId({ organization_id, id });
  if (!pacId) return null;
  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);
  return kind === 'xml'
    ? pac.getXml(pacId, { provider, creds })
    : pac.getPdf(pacId, { provider, creds });
}

/**
 * List CFDIs received from suppliers (facturas de proveedores) straight from
 * the PAC — this is the "recibir facturas" side.
 */
async function listReceived({ organization_id }) {
  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);
  const rows = await pac.list('received', { provider, creds });
  return rows.map((c) => ({
    uuid: c?.Complement?.TaxStamp?.Uuid || c?.Uuid || null,
    issuer_rfc: c?.Issuer?.Rfc || c?.IssuerRfc,
    issuer_name: c?.Issuer?.Name || c?.IssuerName,
    total: c?.Total,
    date: c?.Date,
    pac_document_id: c?.Id,
  }));
}

module.exports = {
  issueIngreso,
  issueCreditNote,
  registerPayment,
  issuePayroll,
  cancel,
  syncInvoices,
  syncIssuedToInvoices,
  syncReceivedToInvoices,
  listIssued,
  getById,
  download,
  listReceived,
  getIssuer,
  linkGhlInvoice,
  markPaid,
  findByGhlInvoice,
};
