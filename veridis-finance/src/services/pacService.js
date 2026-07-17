/**
 * PAC (timbrado) service — provider-agnostic fiscal stamping.
 *
 * Dispatches to a concrete PAC provider so the rest of the app never talks to a
 * specific PAC directly. Default is Facturama; Facturapi is available behind the
 * same interface. Select per call (input.provider), per tenant (issuer record),
 * or globally via PAC_PROVIDER.
 *
 * Interface every provider implements:
 *   stampIngreso(input) -> { id, uuid, folio, total, status, xmlUrl, pdfUrl, raw }
 *   getDocument(id, creds)
 *   cancel(id, opts, creds)
 */

const providers = {
  facturama: require('./pac/facturamaProvider'),
  facturapi: require('./pac/facturapiProvider'),
};

function resolve(name) {
  const key = name || process.env.PAC_PROVIDER || 'facturama';
  const provider = providers[key];
  if (!provider) {
    const err = new Error(`Unknown PAC provider: ${key}`);
    err.statusCode = 500;
    throw err;
  }
  return provider;
}

function stampIngreso(input = {}) {
  return resolve(input.provider).stampIngreso(input);
}

function notSupported(what) {
  const err = new Error(`Provider does not support ${what}`);
  err.statusCode = 501;
  return err;
}

/** Stamp a CFDI de Egreso (nota de crédito). */
function stampEgreso(input = {}) {
  const p = resolve(input.provider);
  if (typeof p.stampEgreso !== 'function') throw notSupported('CFDI de Egreso');
  return p.stampEgreso(input);
}

/** Stamp a CFDI de Pago (Complemento de Pago 2.0 / REP). */
function stampPago(input = {}) {
  const p = resolve(input.provider);
  if (typeof p.stampPago !== 'function') throw notSupported('Complemento de Pago');
  return p.stampPago(input);
}

function getDocument(id, { provider, creds } = {}) {
  return resolve(provider).getDocument(id, creds);
}

function cancel(id, { provider, creds, ...opts } = {}) {
  return resolve(provider).cancel(id, opts, creds);
}

/** List issued or received CFDIs. type: 'issued' | 'received'. */
function list(type, { provider, creds } = {}) {
  const p = resolve(provider);
  if (typeof p.list !== 'function') {
    const err = new Error(`Provider does not support listing CFDIs`);
    err.statusCode = 501;
    throw err;
  }
  return p.list(type, creds);
}

function getPdf(id, { provider, creds } = {}) {
  return resolve(provider).getPdf(id, creds);
}

function getXml(id, { provider, creds } = {}) {
  return resolve(provider).getXml(id, creds);
}

module.exports = {
  stampIngreso,
  stampEgreso,
  stampPago,
  getDocument,
  cancel,
  list,
  getPdf,
  getXml,
  resolve,
};
