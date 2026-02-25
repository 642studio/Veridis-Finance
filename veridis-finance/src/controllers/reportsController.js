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

module.exports = {
  getMonthlyReport,
};
