const Fastify = require('fastify');
const multipart = require('@fastify/multipart');
const { ZodError } = require('zod');

const transactionsRoutes = require('./routes/transactions');
const reportsRoutes = require('./routes/reports');
const invoicesRoutes = require('./routes/invoices');
const bankStatementsRoutes = require('./routes/bankStatements');
const authRoutes = require('./routes/auth');
const intelligenceRoutes = require('./routes/intelligence');
const membersRoutes = require('./routes/members');
const aiProvidersRoutes = require('./routes/aiProviders');
const clientsRoutes = require('./routes/clients');
const vendorsRoutes = require('./routes/vendors');
const planningRoutes = require('./routes/planning');
const logger = require('./logger');

function buildApp() {
  const maxXmlFileSizeBytes = Number.parseInt(
    process.env.INVOICE_XML_MAX_FILE_SIZE_BYTES || '1048576',
    10
  );
  const maxBankStatementPdfBytes = Number.parseInt(
    process.env.BANK_STATEMENT_PDF_MAX_FILE_SIZE_BYTES || '8388608',
    10
  );
  const multipartFileSizeLimit = Math.max(
    Number.isFinite(maxXmlFileSizeBytes) && maxXmlFileSizeBytes > 0
      ? maxXmlFileSizeBytes
      : 1048576,
    Number.isFinite(maxBankStatementPdfBytes) && maxBankStatementPdfBytes > 0
      ? maxBankStatementPdfBytes
      : 8388608
  );

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  app.register(multipart, {
    limits: {
      files: 1,
      fields: 10,
      fileSize: multipartFileSizeLimit,
    },
    throwFileSizeLimit: true,
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'veridis-finance',
    timestamp: new Date().toISOString(),
  }));

  app.register(authRoutes, { prefix: '/auth' });

  // Backward-compatible finance-prefixed API.
  app.register(transactionsRoutes, { prefix: '/api/finance' });
  app.register(reportsRoutes, { prefix: '/api/finance' });
  app.register(invoicesRoutes, { prefix: '/api/finance' });
  app.register(bankStatementsRoutes, { prefix: '/api/finance' });
  app.register(intelligenceRoutes, { prefix: '/api/finance' });
  app.register(aiProvidersRoutes, { prefix: '/api/finance' });
  app.register(membersRoutes, { prefix: '/api/finance' });
  app.register(clientsRoutes, { prefix: '/api/finance' });
  app.register(vendorsRoutes, { prefix: '/api/finance' });
  app.register(planningRoutes, { prefix: '/api' });

  // Canonical SaaS endpoints requested for entity modules and transactions.
  app.register(transactionsRoutes, { prefix: '/api' });
  app.register(clientsRoutes, { prefix: '/api' });
  app.register(vendorsRoutes, { prefix: '/api' });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Request failed');

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.flatten(),
      });
    }

    const statusCode = Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;

    const message =
      statusCode >= 500 ? 'Internal server error' : error.message;

    return reply.status(statusCode).send({ error: message });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: `Route not found: ${request.method} ${request.url}`,
    });
  });

  return app;
}

module.exports = buildApp;
