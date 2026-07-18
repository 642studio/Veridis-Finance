const { z } = require('zod');

const reportsService = require('../services/reportsService');
const { resolveOrganizationId } = require('../middleware/auth');

const monthReportQuerySchema = z.object({
  month: z
    .string()
    .regex(/^(0?[1-9]|1[0-2])$/, 'month must be between 01 and 12')
    .transform((value) => Number(value)),
  year: z
    .string()
    .regex(/^\d{4}$/, 'year must be in YYYY format')
    .transform((value) => Number(value)),
});

async function getMonthlyReport(request, reply) {
  const query = monthReportQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);
  const report = await reportsService.getMonthlyReport({
    organization_id: organizationId,
    month: query.month,
    year: query.year,
  });

  reply.send({ data: report });
}

/** Monthly IVA by supplier RFC (DIOT groundwork) from uploaded CFDIs. */
async function getDiotReport(request, reply) {
  const query = monthReportQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);
  const report = await reportsService.getDiotReport({
    organization_id: organizationId,
    month: query.month,
    year: query.year,
  });

  reply.send({ data: report });
}

/** Official DIOT batch .txt (23-field pipe layout) as a file download. */
async function getDiotBatch(request, reply) {
  const query = monthReportQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);
  const file = await reportsService.getDiotBatchFile({
    organization_id: organizationId,
    month: query.month,
    year: query.year,
  });

  reply
    .header('content-type', 'text/plain; charset=utf-8')
    .header('content-disposition', `attachment; filename="${file.filename}"`)
    .header('x-supplier-count', String(file.supplier_count))
    .send(file.content);
}

/** Antigüedad de saldos (CxC / CxP) desde el libro de facturas pendientes. */
async function getAgingReport(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const report = await reportsService.getAgingReport({ organization_id: organizationId });
  reply.send({ data: report });
}

module.exports = {
  getMonthlyReport,
  getDiotReport,
  getDiotBatch,
  getAgingReport,
};
