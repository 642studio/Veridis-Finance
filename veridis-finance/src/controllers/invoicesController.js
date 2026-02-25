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

module.exports = {
  createInvoice,
  uploadInvoice,
};
