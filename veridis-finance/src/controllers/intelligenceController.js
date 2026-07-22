const {
  calculateCashflowProjection,
} = require('../modules/finance/intelligence/projection.service');
const {
  reclassifyUncategorizedTransactions,
} = require('../services/intelligenceReclassifyService');
const {
  reclassifyReviewExpenses,
} = require('../services/categoryReclassifyService');
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

async function reclassifyTransactions(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const userId = request.user?.user_id;

  const limit = request.body?.limit ?? request.query?.limit;
  const minConfidence =
    request.body?.min_confidence ?? request.query?.min_confidence;

  request.log.info(
    {
      organization_id: organizationId,
      user_id: userId,
      endpoint: 'POST /api/finance/intelligence/reclassify',
    },
    'Starting bulk reclassification of uncategorized transactions'
  );

  try {
    const summary = await reclassifyUncategorizedTransactions({
      organizationId,
      limit,
      minConfidence,
    });

    request.log.info(
      {
        organization_id: organizationId,
        user_id: userId,
        scanned: summary.scanned,
        updated: summary.updated,
      },
      'Bulk reclassification completed'
    );

    return reply.send({ data: summary });
  } catch (error) {
    request.log.error(
      { err: error, organization_id: organizationId, user_id: userId },
      'Bulk reclassification failed'
    );
    throw error;
  }
}

async function recategorizeReview(request, reply) {
  const organizationId = resolveOrganizationId(request);
  const userId = request.user?.user_id;
  const limit = request.body?.limit ?? request.query?.limit;
  const apply = request.body?.apply !== false; // por defecto aplica
  const useAI = request.body?.use_ai !== false; // por defecto usa IA

  try {
    const summary = await reclassifyReviewExpenses({
      organizationId, limit, apply, useAI,
    });
    request.log.info(
      { organization_id: organizationId, user_id: userId, ...summary, changes: undefined },
      'Recategorización de "Por revisar" completada'
    );
    return reply.send({ data: summary });
  } catch (error) {
    request.log.error(
      { err: error, organization_id: organizationId, user_id: userId },
      'Recategorización de "Por revisar" falló'
    );
    throw error;
  }
}

module.exports = {
  getCashflowProjection,
  reclassifyTransactions,
  recategorizeReview,
};
