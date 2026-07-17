const { z } = require('zod');

const invoicesService = require('../services/invoicesService');
const { parseCfdi40 } = require('../services/cfdiParserService');
const { resolveOrganizationId } = require('../middleware/auth');

const createInvoiceSchema = z.object({
  organization_id: z.string().uuid().optional(),
  uuid_sat: z.string().min(1).max(120),
  emitter: z.string().min(1).max(255),
  receiver: z.string().min(1).max(255),
  total: z.coerce.number().positive(),
  status: z.enum(['pending', 'paid']).default('pending'),
  invoice_date: z.coerce.date(),
});

const uploadInvoiceFormSchema = z.object({
  organization_id: z.string().uuid().optional(),
});

const listInvoicesQuerySchema = z.object({
  status: z.enum(['pending', 'paid']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const invoiceParamsSchema = z.object({
  id: z.string().uuid(),
});

const updateInvoiceStatusSchema = z.object({
  status: z.enum(['pending', 'paid']),
  payment_method: z.string().trim().max(120).optional().nullable(),
  payment_reference: z.string().trim().max(255).optional().nullable(),
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function createInvoice(request, reply) {
  const payload = createInvoiceSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request, payload.organization_id);
  const created = await invoicesService.createInvoice({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: created });
}

async function listInvoices(request, reply) {
  const query = listInvoicesQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await invoicesService.listInvoices({
    organization_id: organizationId,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  });

  reply.send({ data: rows });
}

/**
 * Bulk XML upload: accepts up to 50 CFDI XML files in one request, parses and
 * persists each one independently, and reports a per-file summary — duplicates
 * (same UUID) and malformed files never abort the batch. Ideal for importing a
 * SAT download of historical received invoices.
 */
async function uploadInvoicesBulk(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }

  const organizationId = resolveOrganizationId(request);
  const summary = { received: 0, created: 0, duplicates: 0, errors: 0 };
  const details = [];

  for await (const part of request.parts()) {
    if (part.type !== 'file') continue;
    const fileName = part.filename || `archivo-${summary.received + 1}`;
    const buffer = await part.toBuffer();
    summary.received += 1;

    try {
      const isXml =
        fileName.toLowerCase().endsWith('.xml') ||
        ['application/xml', 'text/xml'].includes(part.mimetype || '');
      if (!isXml) {
        throw badRequest('No es un archivo XML');
      }

      const parsed = parseCfdi40(buffer.toString('utf8'));
      const created = await invoicesService.createInvoice({
        organization_id: organizationId,
        uuid_sat: parsed.uuid_sat,
        emitter: parsed.emitter,
        receiver: parsed.receiver,
        total: parsed.total,
        status: 'pending',
        invoice_date: parsed.invoice_date,
        emitter_rfc: parsed.emitter_rfc,
        receiver_rfc: parsed.receiver_rfc,
        subtotal: parsed.subtotal,
        currency: parsed.currency,
        comprobante_type: parsed.comprobante_type,
        forma_pago: parsed.forma_pago,
        metodo_pago: parsed.metodo_pago,
        taxes: parsed.taxes,
        concepts: parsed.concepts,
      });
      summary.created += 1;
      details.push({ file: fileName, status: 'created', uuid: created.uuid_sat });
    } catch (error) {
      if (error?.statusCode === 409) {
        summary.duplicates += 1;
        details.push({ file: fileName, status: 'duplicate' });
      } else {
        summary.errors += 1;
        details.push({
          file: fileName,
          status: 'error',
          message: String(error?.message || 'Error').slice(0, 200),
        });
      }
    }
  }

  if (summary.received === 0) {
    throw badRequest('No se recibieron archivos XML');
  }

  request.log.info(
    { source: 'invoice_bulk_upload', organization_id: organizationId, ...summary },
    'Bulk invoice XML upload processed'
  );

  reply.status(201).send({ data: { ...summary, details } });
}

async function uploadInvoice(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }

  let organizationIdRaw;
  let xmlBuffer;
  let xmlFileName = '';
  let xmlMimeType = '';

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (xmlBuffer) {
        throw badRequest('Only one XML file is allowed');
      }
      xmlFileName = part.filename || '';
      xmlMimeType = part.mimetype || '';
      xmlBuffer = await part.toBuffer();
      continue;
    }

    if (part.fieldname === 'organization_id') {
      organizationIdRaw = part.value;
    }
  }

  if (!xmlBuffer) {
    throw badRequest('XML file is required');
  }

  const isXmlByName = xmlFileName.toLowerCase().endsWith('.xml');
  const isXmlMime =
    xmlMimeType === 'application/xml' || xmlMimeType === 'text/xml';

  if (!isXmlByName && !isXmlMime) {
    throw badRequest('Uploaded file must be an XML file');
  }

  const parsedInvoice = parseCfdi40(xmlBuffer.toString('utf8'));

  const formPayload = uploadInvoiceFormSchema.parse({
    organization_id: organizationIdRaw,
  });

  const organizationId = resolveOrganizationId(
    request,
    formPayload.organization_id
  );

  const created = await invoicesService.createInvoice({
    organization_id: organizationId,
    uuid_sat: parsedInvoice.uuid_sat,
    emitter: parsedInvoice.emitter,
    receiver: parsedInvoice.receiver,
    total: parsedInvoice.total,
    status: 'pending',
    invoice_date: parsedInvoice.invoice_date,
    // Structured fiscal fields (DIOT, reconciliation, supplier ledgers).
    emitter_rfc: parsedInvoice.emitter_rfc,
    receiver_rfc: parsedInvoice.receiver_rfc,
    subtotal: parsedInvoice.subtotal,
    currency: parsedInvoice.currency,
    comprobante_type: parsedInvoice.comprobante_type,
    forma_pago: parsedInvoice.forma_pago,
    metodo_pago: parsedInvoice.metodo_pago,
    taxes: parsedInvoice.taxes,
    concepts: parsedInvoice.concepts,
  });

  request.log.info(
    {
      source: 'invoice_upload',
      organization_id: organizationId,
      invoice_id: created.id,
      uuid_sat: created.uuid_sat,
    },
    'Invoice XML uploaded and parsed'
  );

  reply.status(201).send({ data: created });
}

async function updateInvoiceStatus(request, reply) {
  const params = invoiceParamsSchema.parse(request.params || {});
  const payload = updateInvoiceStatusSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const updated = await invoicesService.updateInvoiceStatus({
    organization_id: organizationId,
    invoice_id: params.id,
    status: payload.status,
    payment_method: payload.payment_method,
    payment_reference: payload.payment_reference,
  });

  request.log.info(
    {
      source: 'invoice_status_update',
      organization_id: organizationId,
      invoice_id: updated.id,
      status: updated.status,
    },
    'Invoice status updated'
  );

  reply.send({ data: updated });
}

module.exports = {
  listInvoices,
  createInvoice,
  uploadInvoice,
  uploadInvoicesBulk,
  updateInvoiceStatus,
};
