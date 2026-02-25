require('dotenv').config();

const buildApp = require('./app');
const pool = require('./db/pool');

const requiredEnv = ['JWT_SECRET'];

for (const envName of requiredEnv) {
  if (!process.env[envName]) {
    throw new Error(`Missing required environment variable: ${envName}`);
  }
}

const app = buildApp();

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 4000);

async function start() {
  try {
    await app.listen({ host, port });
    app.log.info(`veridis-finance listening on ${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  app.log.info(`${signal} received. Closing resources...`);

  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
