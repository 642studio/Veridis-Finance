/**
 * Facturama PAC provider (REST, HTTP Basic auth).
 *
 * Uses the "API Web" endpoints (the account's own emisor is configured in the
 * Facturama portal). Multiemisor (/api-lite, Issuer + CSD per request) can be
 * added later behind the same functions for true multi-tenant issuing.
 *
 * Config (env, or per-tenant issuer record):
 *   FACTURAMA_USER      account username (Basic auth)
 *   FACTURAMA_PASSWORD  account password (Basic auth)
 *   FACTURAMA_ENV       'sandbox' (default) | 'production'
 *
 * Sandbox and production accounts are separate — sandbox never issues real
 * CFDIs or consumes folios.
 */

const { money, round, sum } = require('../../lib/money');

function baseUrl(env) {
  return (env || process.env.FACTURAMA_ENV || 'sandbox') === 'production'
    ? 'https://api.facturama.mx'
    : 'https://apisandbox.facturama.mx';
}

function authHeader(creds) {
  const user = creds?.user || process.env.FACTURAMA_USER;
  const pass = creds?.password || process.env.FACTURAMA_PASSWORD;
  if (!user || !pass) {
    const err = new Error('Missing Facturama credentials (FACTURAMA_USER / FACTURAMA_PASSWORD)');
    err.statusCode = 500;
    throw err;
  }
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function request(method, path, body, creds) {
  const res = await fetch(`${baseUrl(creds?.env)}${path}`, {
    method,
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      `Facturama ${res.status}: ${data?.Message || data?.ModelState ? JSON.stringify(data) : text}`
    );
    err.statusCode = res.status >= 500 ? 502 : 400;
    err.response = { data };
    throw err;
  }
  return data;
}

/**
 * Build a CFDI 4.0 Ingreso line item with computed subtotal/tax/total.
 */
function buildItem(it) {
  const quantity = money(it.quantity ?? 1);
  const unitPrice = money(it.unitPrice);
  const subtotal = quantity.times(unitPrice);
  const ivaRate = it.ivaRate ?? 0.16;
  const hasTax = ivaRate > 0;
  const taxTotal = hasTax ? subtotal.times(ivaRate) : money(0);

  return {
    ProductCode: it.productKey || '01010101',
    Description: it.description,
    Unit: it.unit || 'Unidad de servicio',
    UnitCode: it.unitKey || 'E48',
    Quantity: Number(quantity.toString()),
    UnitPrice: Number(round(unitPrice)),
    Subtotal: Number(round(subtotal)),
    TaxObject: hasTax ? '02' : '01', // 02 = sí objeto de impuesto
    Taxes: hasTax
      ? [{
          Name: 'IVA',
          Rate: ivaRate,
          Base: Number(round(subtotal)),
          Total: Number(round(taxTotal)),
          IsRetention: false,
          IsFederalTax: true,
        }]
      : [],
    Total: Number(round(subtotal.plus(taxTotal))),
  };
}

/**
 * Stamp a CFDI de Ingreso (API Web).
 * @returns normalized result { id, uuid, folio, total, status, xmlUrl, pdfUrl, raw }
 */
async function stampIngreso(input) {
  const creds = input.creds; // { user, password, env }
  const isPPD = input.paymentMethod === 'PPD';
  const items = input.items.map(buildItem);
  const total = sum(items.map((i) => i.Total));

  const payload = {
    CfdiType: 'I',
    NameId: '1', // 1 = Factura
    ExpeditionPlace: input.expeditionPlace || input.receiver.zip, // CP del emisor
    PaymentForm: isPPD ? '99' : (input.paymentForm || '01'),
    PaymentMethod: input.paymentMethod || 'PUE',
    Exportation: '01', // No aplica
    Receiver: {
      Rfc: input.receiver.rfc,
      Name: input.receiver.name,
      CfdiUse: input.receiver.use || 'G03',
      FiscalRegime: input.receiver.fiscalRegime || '601',
      TaxZipCode: input.receiver.zip,
    },
    Items: items,
  };
  if (input.folio) payload.Folio = String(input.folio);

  const cfdi = await request('POST', '/3/cfdis', payload, creds);
  const uuid = cfdi?.Complement?.TaxStamp?.Uuid || null;

  return {
    id: cfdi.Id,
    uuid,
    folio: cfdi.Folio,
    total: cfdi.Total ?? Number(round(total)),
    status: uuid ? 'stamped' : 'error',
    xmlUrl: `${baseUrl(creds?.env)}/cfdi/xml/issued/${cfdi.Id}`,
    pdfUrl: `${baseUrl(creds?.env)}/cfdi/pdf/issued/${cfdi.Id}`,
    raw: cfdi,
  };
}

async function getDocument(id, creds) {
  return request('GET', `/cfdi/${id}`, null, creds);
}

/** Cancel a stamped CFDI. motive: 01|02|03|04 */
async function cancel(id, opts = {}, creds) {
  const motive = opts.motive || '02';
  let path = `/cfdi/${id}?type=issued&motive=${motive}`;
  if (opts.substitution) path += `&uuidReplacement=${opts.substitution}`;
  return request('DELETE', path, null, creds);
}

module.exports = { stampIngreso, getDocument, cancel };
