const { z } = require('zod');

const cfdiService = require('../services/cfdiService');
const ghlService = require('../services/ghlService');
const issuersService = require('../services/cfdiIssuersService');
const { resolveOrganizationId } = require('../middleware/auth');

// RFC: 3-4 letters + 6 digits (date) + 3 alphanumeric homoclave. Persona moral
// has 3 leading letters, persona física 4. Case-insensitive.
const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

const issuerSchema = z.object({
  rfc: z.string().trim().regex(RFC_REGEX, 'RFC inválido'),
  legal_name: z.string().trim().min(1).max(255),
  fiscal_regime: z.string().trim().regex(/^\d{3}$/, 'Régimen fiscal inválido (c_RegimenFiscal, 3 dígitos)'),
  zip_code: z.string().trim().regex(/^\d{5}$/, 'Código postal inválido'),
  pac_provider: z.enum(['facturama', 'facturapi']).default('facturama'),
  pac_env: z.enum(['sandbox', 'production']).default('sandbox'),
  pac_organization_id: z.string().trim().max(255).optional(),
  // Secrets — write-only, only applied when provided (rotation-friendly).
  pac_username: z.string().trim().max(255).optional(),
  pac_password: z.string().trim().max(500).optional(),
  pac_api_key: z.string().trim().max(500).optional(),
});

const itemSchema = z.object({
  description: z.string().min(1).max(1000),
  productKey: z.string().min(1).max(20).optional(),
  unitKey: z.string().min(1).max(20).optional(),
  unit: z.string().max(120).optional(),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().nonnegative(),
  // IVA: rate (0 = tasa 0%) OR ivaExempt (exento) OR noTaxObject (no objeto).
  ivaRate: z.coerce.number().min(0).max(1).optional(),
  ivaExempt: z.coerce.boolean().optional(),
  noTaxObject: z.coerce.boolean().optional(),
  // Other taxes (honorarios/arrendamiento need retenciones; IEPS for some goods).
  iepsRate: z.coerce.number().min(0).max(1).optional(),
  retIvaRate: z.coerce.number().min(0).max(1).optional(),
  retIsrRate: z.coerce.number().min(0).max(1).optional(),
});

const issueSchema = z.object({
  organization_id: z.string().uuid().optional(),
  invoice_id: z.string().uuid().optional(),
  // Either reference a stored receiver profile...
  receiver_id: z.string().uuid().optional(),
  // ...or pass the receiver's fiscal data inline.
  receiver: z.object({
    rfc: z.string().min(12).max(13),
    name: z.string().min(1).max(255),
    fiscalRegime: z.string().min(3).max(4),
    use: z.string().min(3).max(4).optional(),
    zip: z.string().length(5),
  }).optional(),
  items: z.array(itemSchema).min(1),
  expeditionPlace: z.string().length(5).optional(),
  paymentForm: z.string().min(2).max(2).optional(),
  paymentMethod: z.enum(['PUE', 'PPD']).optional(),
  folio: z.union([z.string(), z.number()]).optional(),
  source: z.enum(['manual', 'ghl', 'api']).optional(),
  source_ref: z.string().max(255).optional(),
}).refine((v) => v.receiver_id || v.receiver, {
  message: 'Either receiver_id or receiver is required',
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

async function issueCfdi(request, reply) {
  const payload = issueSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request, payload.organization_id);
  const result = await cfdiService.issueIngreso({ ...payload, organization_id: organizationId });
  reply.status(result.idempotent ? 200 : 201).send(result);
}

async function listCfdi(request, reply) {
  const { limit, offset } = listQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);
  const data = await cfdiService.listIssued({ organization_id: organizationId, limit, offset });
  reply.send({ data });
}

async function getCfdi(request, reply) {
  const { id } = idParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);
  const data = await cfdiService.getById({ organization_id: organizationId, id });
  if (!data) {
    return reply.status(404).send({ error: 'CFDI not found' });
  }
  reply.send({ data });
}

function makeDownloadHandler(kind) {
  return async function downloadCfdi(request, reply) {
    const { id } = idParamsSchema.parse(request.params);
    const organizationId = resolveOrganizationId(request);
    const file = await cfdiService.download({ organization_id: organizationId, id, kind });
    if (!file) {
      return reply.status(404).send({ error: 'CFDI not found or not stamped' });
    }
    reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename="${id}.${kind}"`)
      .send(Buffer.from(file.contentBase64, 'base64'));
  };
}

async function listReceivedCfdi(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const data = await cfdiService.listReceived({ organization_id: organizationId });
  reply.send({ data });
}

/**
 * Reconcile a CFDI as paid in Veridis, then mirror the payment to the 642 CRM
 * (best-effort) so both sides agree. A CFDI is "paid" once marked here OR paid
 * in the CRM.
 */
async function markPaidCfdi(request, reply) {
  const { id } = idParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);
  const doc = await cfdiService.markPaid({ organization_id: organizationId, id, source: 'veridis' });
  if (!doc) return reply.status(404).send({ error: 'CFDI not found' });

  let crmSynced = false;
  if (doc.ghl_invoice_id) {
    try {
      await ghlService.recordInvoicePayment(organizationId, doc.ghl_invoice_id, {
        amount: doc.total,
      });
      crmSynced = true;
    } catch {
      // best-effort: the CFDI is paid in Veridis regardless of CRM reachability
    }
  }
  reply.send({ data: doc, crmSynced });
}

/**
 * Manually mirror an already-stamped CFDI to the 642 CRM as an invoice (retry
 * when the automatic push on issue failed or the receiver was linked later).
 */
async function pushCfdiToCrm(request, reply) {
  const { id } = idParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);
  const doc = await cfdiService.getById({ organization_id: organizationId, id });
  if (!doc) return reply.status(404).send({ error: 'CFDI not found' });
  if (doc.ghl_invoice_id) {
    return reply.send({ data: doc, alreadyLinked: true });
  }
  if (!doc.ghl_contact_id) {
    return reply.status(409).send({ error: 'CFDI sin contacto del CRM; vincula un receptor con contacto del 642 CRM.' });
  }

  const ghlInvoiceId = await ghlService.createInvoiceForCfdi(organizationId, {
    contactId: doc.ghl_contact_id,
    receiver: { name: doc.receiver_name, rfc: doc.receiver_rfc },
    items: [{ description: `CFDI ${doc.uuid || ''}`.trim(), quantity: 1, unitPrice: doc.total || 0, ivaRate: 0 }],
    currency: doc.currency || 'MXN',
  });
  if (!ghlInvoiceId) {
    return reply.status(502).send({ error: 'El 642 CRM no devolvió un invoice' });
  }
  const linked = await cfdiService.linkGhlInvoice({
    organization_id: organizationId,
    id,
    ghl_invoice_id: ghlInvoiceId,
  });
  reply.send({ data: linked });
}

const cancelSchema = z.object({
  motive: z.enum(['01', '02', '03', '04']).default('02'),
  substitution: z.string().uuid().optional(),
});

const receiverInlineSchema = z.object({
  rfc: z.string().trim().regex(RFC_REGEX, 'RFC inválido'),
  name: z.string().min(1).max(255),
  fiscalRegime: z.string().min(3).max(4),
  use: z.string().min(3).max(4).optional(),
  zip: z.string().length(5),
});

const creditNoteSchema = z.object({
  items: z.array(itemSchema).min(1),
  relation_type: z.enum(['01', '03']).default('01'),
  paymentForm: z.string().min(2).max(2).optional(),
  receiver: receiverInlineSchema.optional(),
  expeditionPlace: z.string().length(5).optional(),
  folio: z.union([z.string(), z.number()]).optional(),
  source_ref: z.string().max(255).optional(),
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD').optional(),
  payment_form: z.string().min(2).max(2).default('03'),
  partiality_number: z.coerce.number().int().min(1).max(999).default(1),
  previous_balance: z.coerce.number().positive().optional(),
  tax_object: z.enum(['01', '02']).default('01'),
  receiver: receiverInlineSchema.optional(),
  expeditionPlace: z.string().length(5).optional(),
});

const payrollSchema = z.object({
  member_id: z.string().uuid().optional(),
  employee: z.object({
    rfc: z.string().trim().regex(RFC_REGEX, 'RFC inválido').optional(),
    name: z.string().min(1).max(255).optional(),
    zip: z.string().length(5),
    curp: z.string().length(18).optional(),
    socialSecurityNumber: z.string().max(20).optional(),
    employeeNumber: z.string().max(30).optional(),
    position: z.string().max(120).optional(),
    dailySalary: z.coerce.number().nonnegative().optional(),
    baseSalary: z.coerce.number().nonnegative().optional(),
    contractType: z.string().max(3).optional(),
    frequencyPayment: z.string().max(3).optional(),
  }),
  payroll: z.object({
    type: z.enum(['O', 'E']).default('O'),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    initialPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    finalPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    daysPaid: z.coerce.number().positive().max(31),
  }),
  perceptions: z.array(z.object({
    code: z.string().max(10).optional(),
    perceptionType: z.string().max(10).optional(),
    description: z.string().max(255).optional(),
    taxedAmount: z.coerce.number().nonnegative().default(0),
    exemptedAmount: z.coerce.number().nonnegative().default(0),
  })).min(1),
  deductions: z.array(z.object({
    code: z.string().max(10).optional(),
    deductionType: z.string().max(10).optional(),
    description: z.string().max(255).optional(),
    amount: z.coerce.number().nonnegative().default(0),
  })).default([]),
});

/** Issue a CFDI de Nómina 1.2 for an employee (member or inline). */
async function payrollCfdi(request, reply) {
  const payload = payrollSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);
  const result = await cfdiService.issuePayroll({
    organization_id: organizationId,
    member_id: payload.member_id,
    employee: payload.employee,
    payroll: payload.payroll,
    perceptions: payload.perceptions,
    deductions: payload.deductions,
  });
  reply.status(201).send(result);
}

/** Issue a nota de crédito (CFDI de Egreso) related to a stamped CFDI. */
async function creditNoteCfdi(request, reply) {
  const { id } = idParamsSchema.parse(request.params);
  const payload = creditNoteSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);
  const result = await cfdiService.issueCreditNote({
    organization_id: organizationId,
    id,
    items: payload.items,
    relationType: payload.relation_type,
    paymentForm: payload.paymentForm,
    receiver: payload.receiver,
    expeditionPlace: payload.expeditionPlace,
    folio: payload.folio,
    source_ref: payload.source_ref || null,
  });
  reply.status(201).send(result);
}

/** Issue a Complemento de Pago 2.0 (REP) for a stamped PPD CFDI. */
async function paymentCfdi(request, reply) {
  const { id } = idParamsSchema.parse(request.params);
  const payload = paymentSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);
  const result = await cfdiService.registerPayment({
    organization_id: organizationId,
    id,
    payment: payload,
    receiver: payload.receiver,
    expeditionPlace: payload.expeditionPlace,
  });
  reply.status(201).send(result);
}

/** Cancel a stamped CFDI at the PAC (with motivo/sustitución + acuse). */
async function cancelCfdi(request, reply) {
  const { id } = idParamsSchema.parse(request.params);
  const { motive, substitution } = cancelSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);
  const result = await cfdiService.cancel({
    organization_id: organizationId,
    id,
    motive,
    substitution: substitution || null,
  });
  reply.send(result);
}

/** Get the tenant's configured fiscal issuer (no secrets returned). */
async function getIssuer(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const data = await issuersService.getIssuerPublic(organizationId);
  reply.send({ data });
}

/** Create or update the tenant's fiscal issuer + PAC credentials. */
async function putIssuer(request, reply) {
  const payload = issuerSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);
  const data = await issuersService.upsertIssuer(organizationId, payload);
  reply.send({ data });
}

module.exports = {
  issueCfdi,
  listCfdi,
  getCfdi,
  getCfdiPdf: makeDownloadHandler('pdf'),
  getCfdiXml: makeDownloadHandler('xml'),
  listReceivedCfdi,
  markPaidCfdi,
  pushCfdiToCrm,
  cancelCfdi,
  creditNoteCfdi,
  paymentCfdi,
  payrollCfdi,
  getIssuer,
  putIssuer,
};
