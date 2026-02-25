const {
  calculateCashflowProjection,
} = require('../modules/finance/intelligence/projection.service');
const { resolveOrganizationId } = require('../middleware/auth');

async function getCashflowProjection(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const userId = request.user?.user_id;

  request.log.info(
    {
      organization_id: organizationId,
      user_id: userId,
      endpoint: 'GET /api/finance/intelligence/projection',
    },
    'Starting cashflow projection calculation'
  );

  try {
    const projection = await calculateCashflowProjection(organizationId);

    request.log.info(
      {
        organization_id: organizationId,
        user_id: userId,
        trend: projection.trend,
      },
      'Cashflow projection calculated'
    );

    return reply.send({ data: projection });
  } catch (error) {
    request.log.error(
      {
        err: error,
        organization_id: organizationId,
        user_id: userId,
      },
      'Cashflow projection calculation failed'
    );
    throw error;
  }
}

module.exports = {
  getCashflowProjection,
};
