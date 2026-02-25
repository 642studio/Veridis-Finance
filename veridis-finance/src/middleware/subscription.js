const {
  getOrganizationById,
  hasActiveSubscription,
  hasApiAccess,
  transactionLimitForPlan,
} = require('../services/organizationService');
const { countTransactionsInRange } = require('../services/transactionsService');
const { forbidden, unauthorized } = require('./auth');

function paymentRequired(message) {
  const error = new Error(message);
  error.statusCode = 402;
  return error;
}

function resolveScopedOrganizationId(request) {
  return (
    request.user?.organization_id ||
    request.apiKey?.organization_id ||
    request.automation?.organization_id ||
    null
  );
}

async function loadOrganizationContext(request) {
  if (request.organization) {
    return request.organization;
  }

  const organizationId = resolveScopedOrganizationId(request);
  if (!organizationId) {
    throw unauthorized('Organization scope is missing from request credentials');
  }

  const organization = await getOrganizationById(organizationId);
  if (!organization) {
    throw forbidden('Organization scope is invalid');
  }

  request.organization = organization;
  return organization;
}

function assertActiveSubscription(organization) {
  if (!hasActiveSubscription(organization.subscription_status)) {
    throw paymentRequired('Organization subscription is not active');
  }
}

function monthRangeFromDate(inputDate = new Date()) {
  const monthStart = new Date(
    Date.UTC(
      inputDate.getUTCFullYear(),
      inputDate.getUTCMonth(),
      1,
      0,
      0,
      0,
      0
    )
  );
  const nextMonthStart = new Date(
    Date.UTC(
      inputDate.getUTCFullYear(),
      inputDate.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0
    )
  );

  return { monthStart, nextMonthStart };
}

async function enforceTransactionPlanLimit(request) {
  const organization = await loadOrganizationContext(request);
  assertActiveSubscription(organization);

  const monthlyLimit = transactionLimitForPlan(organization.plan);
  if (!monthlyLimit) {
    return;
  }

  const { monthStart, nextMonthStart } = monthRangeFromDate(new Date());
  const currentMonthCount = await countTransactionsInRange({
    organization_id: organization.organization_id,
    from: monthStart,
    to: nextMonthStart,
  });

  request.plan_usage = {
    plan: organization.plan,
    monthly_limit: monthlyLimit,
    current_month_transactions: currentMonthCount,
  };

  if (currentMonthCount >= monthlyLimit) {
    throw paymentRequired(
      `Free plan monthly limit reached (${monthlyLimit} transactions)`
    );
  }
}

async function requireApiAccessPlan(request) {
  const organization = await loadOrganizationContext(request);
  assertActiveSubscription(organization);

  if (!hasApiAccess(organization.plan)) {
    throw forbidden('Current subscription plan does not include API access');
  }
}

module.exports = {
  loadOrganizationContext,
  enforceTransactionPlanLimit,
  requireApiAccessPlan,
};
