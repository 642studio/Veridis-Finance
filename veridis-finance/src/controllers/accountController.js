const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const accountService = require('../services/accountService');

const updateProfileSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const changePasswordSchema = z.object({
  current_password: z.string().min(8).max(120),
  new_password: z.string().min(8).max(120),
});

const deleteAccountSchema = z.object({
  password: z.string().min(8).max(120),
});

const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    currency: z.string().trim().min(1).max(10).optional(),
    timezone: z.string().trim().min(2).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function getAccount(request, reply) {
  const organizationId = resolveOrganizationId(request);

  const account = await accountService.getAccountContext({
    organization_id: organizationId,
    user_id: request.user.user_id,
  });

  reply.send({ data: account });
}

async function updateAccount(request, reply) {
  const payload = updateProfileSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const account = await accountService.updateAccountProfile({
    organization_id: organizationId,
    user_id: request.user.user_id,
    ...payload,
  });

  reply.send({ data: account });
}

async function updateAccountPassword(request, reply) {
  const payload = changePasswordSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const result = await accountService.changeAccountPassword({
    organization_id: organizationId,
    user_id: request.user.user_id,
    current_password: payload.current_password,
    new_password: payload.new_password,
  });

  reply.send({ data: result });
}

async function deleteAccount(request, reply) {
  const payload = deleteAccountSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const result = await accountService.deactivateAccount({
    organization_id: organizationId,
    user_id: request.user.user_id,
    password: payload.password,
  });

  reply.send({ data: result });
}

async function getOrganization(request, reply) {
  const organizationId = resolveOrganizationId(request);

  const organization = await accountService.getOrganizationSettings({
    organization_id: organizationId,
  });

  reply.send({ data: organization });
}

async function updateOrganization(request, reply) {
  const payload = updateOrganizationSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const organization = await accountService.updateOrganizationSettings({
    organization_id: organizationId,
    ...payload,
  });

  reply.send({ data: organization });
}

async function uploadOrganizationLogo(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }

  const organizationId = resolveOrganizationId(request);

  let logoPart = null;

  for await (const part of request.parts()) {
    if (part.type !== 'file') {
      continue;
    }

    if (part.fieldname !== 'logo') {
      continue;
    }

    logoPart = part;
    break;
  }

  if (!logoPart) {
    throw badRequest('Logo file is required');
  }

  const allowedMimeTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml',
  ]);

  if (!allowedMimeTypes.has(String(logoPart.mimetype || '').toLowerCase())) {
    throw badRequest('Unsupported logo mime type');
  }

  const buffer = await logoPart.toBuffer();
  if (!buffer?.length) {
    throw badRequest('Logo file is empty');
  }

  const maxLogoBytes = Number.parseInt(
    process.env.ORG_LOGO_MAX_FILE_SIZE_BYTES || '1572864',
    10
  );

  if (buffer.length > maxLogoBytes) {
    throw badRequest(`Logo exceeds max size (${maxLogoBytes} bytes)`);
  }

  const dataUrl = `data:${logoPart.mimetype};base64,${buffer.toString('base64')}`;

  const organization = await accountService.updateOrganizationLogo({
    organization_id: organizationId,
    logo_data_url: dataUrl,
  });

  reply.send({ data: organization });
}

module.exports = {
  getAccount,
  updateAccount,
  updateAccountPassword,
  deleteAccount,
  getOrganization,
  updateOrganization,
  uploadOrganizationLogo,
};
