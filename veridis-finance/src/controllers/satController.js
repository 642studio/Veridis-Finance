const { z } = require('zod');

const satService = require('../services/satDownloadService');
const { resolveOrganizationId } = require('../middleware/auth');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const SAT_ENV = process.env.SAT_DM_ENV === 'sandbox' ? 'sandbox' : 'production';

async function getCredentials(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const creds = await satService.getCredentialsPublic(organizationId);
  reply.send({ data: creds });
}

/**
 * Upload the e.firma (multipart): fields `cer` (file), `key` (file), `password`.
 * Validated and encrypted server-side; secrets are never echoed back.
 */
async function uploadCredentials(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }
  const organizationId = resolveOrganizationId(request);

  let cerBuffer;
  let keyBuffer;
  let password;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buf = await part.toBuffer();
      const field = (part.fieldname || '').toLowerCase();
      const fname = (part.filename || '').toLowerCase();
      if (field === 'cer' || fname.endsWith('.cer')) cerBuffer = buf;
      else if (field === 'key' || fname.endsWith('.key')) keyBuffer = buf;
    } else if (part.fieldname === 'password') {
      password = part.value;
    }
  }

  if (!cerBuffer) throw badRequest('Falta el archivo .cer de la e.firma');
  if (!keyBuffer) throw badRequest('Falta el archivo .key de la e.firma');
  if (!password) throw badRequest('Falta la contraseña de la e.firma');

  const creds = await satService.saveCredentials(organizationId, cerBuffer, keyBuffer, password);

  request.log.info(
    { source: 'sat_efirma_upload', organization_id: organizationId, rfc: creds.rfc },
    'e.firma stored (encrypted) for SAT Descarga Masiva'
  );

  reply.status(201).send({ data: creds });
}

async function deleteCredentials(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const result = await satService.deleteCredentials(organizationId);
  reply.send({ data: result });
}

const createRequestSchema = z.object({
  request_type: z.enum(['issued', 'received']).default('issued'),
  download_type: z.enum(['CFDI', 'Metadata']).default('Metadata'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_from debe ser YYYY-MM-DD'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_to debe ser YYYY-MM-DD'),
});

async function createRequest(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const body = createRequestSchema.parse(request.body || {});
  const req = await satService.createRequest(
    organizationId,
    {
      requestType: body.request_type,
      downloadType: body.download_type,
      dateFrom: body.date_from,
      dateTo: body.date_to,
    },
    SAT_ENV
  );
  reply.status(201).send({ data: req });
}

const requestParamsSchema = z.object({ id: z.string().uuid() });

async function checkRequest(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const { id } = requestParamsSchema.parse(request.params || {});
  const req = await satService.checkRequest(organizationId, id, SAT_ENV);
  reply.send({ data: req });
}

async function listRequests(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const rows = await satService.listRequests(organizationId);
  reply.send({ data: rows });
}

module.exports = {
  getCredentials,
  uploadCredentials,
  deleteCredentials,
  createRequest,
  checkRequest,
  listRequests,
};
