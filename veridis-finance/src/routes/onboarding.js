const pool = require('../db/pool');
const { authenticate, authorize, resolveOrganizationId, ROLES } = require('../middleware/auth');
const aiProviderService = require('../modules/finance/intelligence/ai-provider.service');

/**
 * Guided onboarding status: one cheap endpoint that tells the dashboard which
 * setup steps this organization has completed, so a brand-new user gets a
 * step-by-step path (fiscal issuer → CRM → bank data → invoices → team).
 */
async function onboardingRoutes(app) {
  app.get(
    '/onboarding/status',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);

      const [issuer, crm, accounts, transactions, statements, invoices, team, ai] =
        await Promise.all([
          pool.query(
            `SELECT 1 FROM finance.cfdi_issuers
              WHERE organization_id = $1 AND is_active = true AND pac_api_key_enc IS NOT NULL
              LIMIT 1`,
            [organizationId]
          ),
          pool.query(
            `SELECT 1 FROM finance.ghl_installs
              WHERE organization_id = $1 AND is_active = true LIMIT 1`,
            [organizationId]
          ),
          pool.query(
            `SELECT count(*)::int AS n FROM finance.accounts WHERE organization_id = $1`,
            [organizationId]
          ),
          pool.query(
            `SELECT 1 FROM finance.transactions
              WHERE organization_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [organizationId]
          ),
          pool.query(
            `SELECT 1 FROM finance.bank_statement_imports
              WHERE organization_id = $1 LIMIT 1`,
            [organizationId]
          ),
          pool.query(
            `SELECT 1 FROM finance.invoices WHERE organization_id = $1 LIMIT 1`,
            [organizationId]
          ),
          pool.query(
            `SELECT count(*)::int AS n FROM finance.users WHERE organization_id = $1`,
            [organizationId]
          ),
          aiProviderService
            .getProvider({ organizationId })
            .catch(() => null),
        ]);

      const steps = {
        // Fiscal: PAC credentials stored for this org.
        fiscal_issuer: issuer.rows.length > 0,
        // CRM: an active GoHighLevel install.
        crm_connected: crm.rows.length > 0,
        // Bank: at least one account beyond the seeded General, or any transaction.
        accounts_ready: (accounts.rows[0]?.n || 0) > 1,
        first_transactions: transactions.rows.length > 0,
        bank_statement_uploaded: statements.rows.length > 0,
        invoices_uploaded: invoices.rows.length > 0,
        team_invited: (team.rows[0]?.n || 0) > 1,
        // Platform AI is on for everyone once the platform key is configured.
        ai_active: Boolean(ai?.key_configured),
      };

      const totalSteps = Object.keys(steps).length;
      const completedSteps = Object.values(steps).filter(Boolean).length;

      reply.send({
        data: {
          steps,
          completed: completedSteps,
          total: totalSteps,
          done: completedSteps === totalSteps,
        },
      });
    }
  );
}

module.exports = onboardingRoutes;
