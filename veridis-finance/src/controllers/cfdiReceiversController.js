const { z } = require('zod');
const jwt = require('jsonwebtoken');

const receiversService = require('../services/cfdiReceiversService');
const { resolveOrganizationId } = require('../middleware/auth');

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

const createSchema = z.object({
  organization_id: z.string().uuid().optional(),
  rfc: z.string().min(12).max(13),
  name: z.string().min(1).max(255),
  fiscal_regime: z.string().min(3).max(4),
  zip_code: z.string().length(5),
  cfdi_use: z.string().min(3).max(4).optional(),
  email: z.string().email().optional(),
  ghl_contact_id: z.string().max(120).optional(),
  source: z.enum(['csf', 'manual', 'ghl']).optional(),
  csf_uploaded: z.boolean().optional(),
});

/** Parse an uploaded CSF and return prefilled fiscal data (does NOT save). */
async function previewCsf(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }
  resolveOrganizationId(request); // authz check
  let pdfBuffer;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      pdfBuffer = await part.toBuffer();
    }
  }
  if (!pdfBuffer) throw badRequest('CSF PDF file is required');

  const data = await receiversService.previewCsf(pdfBuffer);
  reply.send({ data });
}

async function createReceiver(request, reply) {
  const payload = createSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request, payload.organization_id);
  const saved = await receiversService.upsert({ ...payload, organization_id: organizationId });
  reply.status(201).send({ data: saved });
}

async function listReceivers(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const data = await receiversService.list({ organization_id: organizationId });
  reply.send({ data });
}

async function getReceiver(request, reply) {
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const organizationId = resolveOrganizationId(request);
  const data = await receiversService.getById({ organization_id: organizationId, id });
  if (!data) return reply.status(404).send({ error: 'Receiver not found' });
  reply.send({ data });
}

/** Generate a self-service link a client can use to upload their own CSF.
 * Optional client_id/name embed the client so the upload auto-associates. */
async function csfLink(request, reply) {
  const organizationId = resolveOrganizationId(request);
  // Short-lived by default: a leaked link should not grant 6 months of write
  // access to fiscal receiver data. Configurable via CSF_LINK_EXPIRES_IN.
  const expiresIn = process.env.CSF_LINK_EXPIRES_IN || '72h';
  const clientId = request.query?.client_id || null;
  const clientName = request.query?.name ? String(request.query.name).slice(0, 160) : null;
  const payload = { org: organizationId, purpose: 'csf' };
  if (clientId) payload.client_id = String(clientId);
  if (clientName) payload.name = clientName;
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn, algorithm: 'HS256' });
  const base =
    process.env.FRONTEND_URL || 'https://veridis-finance-adrian-yepizs-projects.vercel.app';
  reply.send({ data: { url: `${base}/subir-csf/${token}`, expires_in: expiresIn } });
}

module.exports = { previewCsf, createReceiver, listReceivers, getReceiver, csfLink };
