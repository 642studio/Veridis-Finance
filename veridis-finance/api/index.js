/**
 * Vercel serverless entrypoint.
 *
 * Reuses the existing Fastify application factory (src/app.js) and forwards the
 * incoming Node request/response to it. The Fastify instance is built once per
 * warm serverless container and cached across invocations.
 *
 * Local/long-running deployments keep using src/server.js (app.listen); this
 * file is only the adapter for Vercel's Node runtime.
 */

const buildApp = require('../src/app');

let readyApp;

async function getApp() {
  if (!readyApp) {
    const app = buildApp();
    await app.ready();
    readyApp = app;
  }
  return readyApp;
}

module.exports = async (req, res) => {
  const app = await getApp();
  app.server.emit('request', req, res);
};
