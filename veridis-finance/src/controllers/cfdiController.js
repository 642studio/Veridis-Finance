const { z } = require('zod');

const cfdiService = require('../services/cfdiService');
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
  receiver: z.object({
    rfc: z.string().min(12).max(13),
    name: z.string().min(1).max(255),
    fiscalRegime: z.string().min(3).max(4),
    use: z.string().min(3).max(4).optional(),
    zip: z.string().length(5),
  }),
  items: z.array(itemSchema).min(1),
  expeditionPlace: z.string().length(5).optional(),
  paymentForm: z.string().min(2).max(2).optional(),
  paymentMethod: z.enum(['PUE', 'PPD']).optional(),
  folio: z.union([z.string(), z.number()]).optional(),
  source: z.enum(['manual', 'ghl', 'api']).optional(),
  source_ref: z.string().max(255).optional(),
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

module.exports = {
  issueCfdi,
  listCfdi,
  getCfdi,
  getCfdiPdf: makeDownloadHandler('pdf'),
  getCfdiXml: makeDownloadHandler('xml'),
  listReceivedCfdi,
};
