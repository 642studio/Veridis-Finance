const { z } = require('zod');

const cfdiService = require('../services/cfdiService');
const ghlService = require('../services/ghlService');
const { resolveOrganizationId } = require('../middleware/auth');

const itemSchema = z.object({
  description: z.string().min(1).max(1000),
  productKey: z.string().min(1).max(20).optional(),
  unitKey: z.string().min(1).max(20).optional(),
  unit: z.string().max(120).optional(),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().nonnegative(),
  ivaRate: z.coerce.number().min(0).max(1).optional(),
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

module.exports = {
  issueCfdi,
  listCfdi,
  getCfdi,
  getCfdiPdf: makeDownloadHandler('pdf'),
  getCfdiXml: makeDownloadHandler('xml'),
  listReceivedCfdi,
  markPaidCfdi,
  pushCfdiToCrm,
};
