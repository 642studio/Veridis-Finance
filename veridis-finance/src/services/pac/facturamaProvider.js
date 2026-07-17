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
const { computeItemTax, IMPUESTO_NAME } = require('./cfdiTax');

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
 * Build a CFDI 4.0 line item, mapping the provider-agnostic tax computation
 * (traslados IVA/IEPS + retenciones ISR/IVA, exento vs tasa 0%) to Facturama's
 * "Taxes" array shape.
 */
function buildItem(it) {
  const quantity = money(it.quantity ?? 1);
  const unitPrice = money(it.unitPrice);
  const subtotal = quantity.times(unitPrice);
  const tax = computeItemTax(it);

  const Taxes = [];
  // Traslados. An exempt IVA line carries no Total (TipoFactor Exento) and, in
  // Facturama's API Web model, is expressed by simply not listing the IVA
  // traslado while keeping TaxObject '02'.
  for (const t of tax.traslados) {
    if (t.tipoFactor === 'Exento') continue;
    Taxes.push({
      Name: IMPUESTO_NAME[t.impuesto],
      Rate: Number(t.tasa),
      Base: Number(t.base),
      Total: Number(t.importe),
      IsRetention: false,
      IsFederalTax: true,
    });
  }
  // Retenciones.
  for (const r of tax.retenciones) {
    Taxes.push({
      Name: IMPUESTO_NAME[r.impuesto],
      Rate: Number(r.tasa),
      Base: Number(r.base),
      Total: Number(r.importe),
      IsRetention: true,
      IsFederalTax: true,
    });
  }

  return {
    ProductCode: it.productKey || '01010101',
    Description: it.description,
    Unit: it.unit || 'Unidad de servicio',
    UnitCode: it.unitKey || 'E48',
    Quantity: Number(quantity.toString()),
    UnitPrice: Number(round(unitPrice)),
    Subtotal: Number(round(subtotal)),
    TaxObject: tax.objetoImp,
    Taxes,
    Total: Number(tax.total),
  };
}

/** Normalize a Facturama CFDI response to our provider-agnostic shape. */
function normalizeStampResult(cfdi, creds, fallbackTotal) {
  const uuid = cfdi?.Complement?.TaxStamp?.Uuid || null;
  return {
    id: cfdi.Id,
    uuid,
    folio: cfdi.Folio,
    total: cfdi.Total ?? fallbackTotal ?? null,
    status: uuid ? 'stamped' : 'error',
    xmlUrl: `${baseUrl(creds?.env)}/cfdi/xml/issued/${cfdi.Id}`,
    pdfUrl: `${baseUrl(creds?.env)}/cfdi/pdf/issued/${cfdi.Id}`,
    raw: cfdi,
  };
}

/**
 * Build the payload for a CFDI de Egreso (nota de crédito) related to a
 * previously stamped CFDI. relationType: '01' (nota de crédito) | '03'
 * (devolución). Pure — unit-tested without network.
 *
 * EXPERIMENTAL: shape follows Facturama's API Web docs; validate against the
 * PAC sandbox before invoicing real clients.
 */
function buildEgresoPayload(input) {
  const items = input.items.map(buildItem);
  const payload = {
    CfdiType: 'E',
    NameId: '2', // 2 = Nota de crédito
    ExpeditionPlace: input.expeditionPlace || input.receiver.zip,
    PaymentForm: input.paymentForm || '03',
    PaymentMethod: 'PUE',
    Exportation: '01',
    Receiver: {
      Rfc: input.receiver.rfc,
      Name: input.receiver.name,
      CfdiUse: input.receiver.use || 'G02', // G02 = devoluciones/descuentos
      FiscalRegime: input.receiver.fiscalRegime || '601',
      TaxZipCode: input.receiver.zip,
    },
    Relations: {
      Type: input.relationType || '01',
      Cfdis: [{ Uuid: input.relatedUuid }],
    },
    Items: items,
  };
  if (input.folio) payload.Folio = String(input.folio);
  return payload;
}

/** Stamp a CFDI de Egreso (nota de crédito). */
async function stampEgreso(input) {
  const payload = buildEgresoPayload(input);
  const total = sum(payload.Items.map((i) => i.Total));
  const cfdi = await request('POST', '/3/cfdis', payload, input.creds);
  return normalizeStampResult(cfdi, input.creds, Number(round(total)));
}

/**
 * Build the payload for a CFDI de Pago (Complemento de Pago 2.0 / REP) for a
 * PPD invoice. Pure — unit-tested without network.
 *
 * EXPERIMENTAL: RelatedDocuments math (parcialidad, saldos) is computed with
 * decimal.js; validate the exact field names against the PAC sandbox before
 * production use.
 */
function buildPagoPayload(input) {
  const paid = money(input.payment.amount);
  const previous = money(input.payment.previousBalance ?? input.payment.amount);
  const remaining = previous.minus(paid);

  return {
    CfdiType: 'P',
    NameId: '14', // Complemento de pago
    ExpeditionPlace: input.expeditionPlace || input.receiver.zip,
    Receiver: {
      Rfc: input.receiver.rfc,
      Name: input.receiver.name,
      CfdiUse: 'CP01', // fixed by SAT for REP
      FiscalRegime: input.receiver.fiscalRegime || '601',
      TaxZipCode: input.receiver.zip,
    },
    Complemento: {
      Payments: [
        {
          Date: input.payment.date,
          PaymentForm: input.payment.paymentForm || '03',
          Currency: input.payment.currency || 'MXN',
          Amount: Number(round(paid)),
          RelatedDocuments: [
            {
              Uuid: input.relatedUuid,
              Currency: input.payment.currency || 'MXN',
              PaymentMethod: 'PPD',
              PartialityNumber: input.payment.partialityNumber || 1,
              PreviousBalanceAmount: Number(round(previous)),
              AmountPaid: Number(round(paid)),
              RemainingBalance: Number(round(remaining)),
              TaxObject: input.payment.taxObject || '01',
            },
          ],
        },
      ],
    },
  };
}

/** Stamp a CFDI de Pago (REP) for a PPD invoice. */
async function stampPago(input) {
  const payload = buildPagoPayload(input);
  const cfdi = await request('POST', '/3/cfdis', payload, input.creds);
  return normalizeStampResult(
    cfdi,
    input.creds,
    payload.Complemento.Payments[0].Amount
  );
}

/**
 * Build the payload for a CFDI de Nómina 1.2 (recibo de nómina).
 * Pure — unit-tested without network.
 *
 * EXPERIMENTAL: shape follows Facturama's API Web payroll docs; validate
 * against the PAC sandbox before running a real payroll.
 *
 * @param {object} input
 * @param {object} input.employee  { rfc, name, curp?, socialSecurityNumber?,
 *   employeeNumber?, position?, dailySalary?, baseSalary?, fiscalRegime?, zip }
 * @param {object} input.payroll   { paymentDate, initialPaymentDate,
 *   finalPaymentDate, daysPaid }
 * @param {Array}  input.perceptions [{ code, description, taxedAmount, exemptedAmount }]
 * @param {Array}  input.deductions  [{ code, description, amount }]
 */
function buildNominaPayload(input) {
  const perceptions = (input.perceptions || []).map((p) => ({
    PerceptionType: p.perceptionType || p.code || '001',
    Code: p.code || '001',
    Description: p.description || 'Sueldo',
    TaxedAmount: Number(round(money(p.taxedAmount ?? 0), 2)),
    ExemptedAmount: Number(round(money(p.exemptedAmount ?? 0), 2)),
  }));
  const deductions = (input.deductions || []).map((d) => ({
    DeduccionType: d.deductionType || d.code || '002',
    Code: d.code || '002',
    Description: d.description || 'ISR',
    Amount: Number(round(money(d.amount ?? 0), 2)),
  }));

  const totalPerceptions = sum(
    perceptions.map((p) => money(p.TaxedAmount).plus(p.ExemptedAmount))
  );
  const totalDeductions = sum(deductions.map((d) => d.Amount));
  const net = totalPerceptions.minus(totalDeductions);

  return {
    CfdiType: 'N',
    NameId: '15', // Nómina
    ExpeditionPlace: input.expeditionPlace || input.employee.zip,
    PaymentForm: '99',
    PaymentMethod: 'PUE',
    Receiver: {
      Rfc: input.employee.rfc,
      Name: input.employee.name,
      CfdiUse: 'CN01', // fixed by SAT for nómina 4.0
      FiscalRegime: input.employee.fiscalRegime || '605', // sueldos y salarios
      TaxZipCode: input.employee.zip,
    },
    Complemento: {
      Payroll: {
        Type: input.payroll.type || 'O', // O = ordinaria, E = extraordinaria
        PaymentDate: input.payroll.paymentDate,
        InitialPaymentDate: input.payroll.initialPaymentDate,
        FinalPaymentDate: input.payroll.finalPaymentDate,
        DaysPaid: Number(input.payroll.daysPaid),
        Employee: {
          Curp: input.employee.curp || null,
          SocialSecurityNumber: input.employee.socialSecurityNumber || null,
          EmployeeNumber: input.employee.employeeNumber || null,
          Position: input.employee.position || null,
          ContractType: input.employee.contractType || '01',
          RegimeType: input.employee.regimeType || '02',
          TypeOfJourney: input.employee.typeOfJourney || '01',
          FrequencyPayment: input.employee.frequencyPayment || '04',
          DailySalary: Number(round(money(input.employee.dailySalary ?? 0), 2)),
          BaseSalary: Number(round(money(input.employee.baseSalary ?? 0), 2)),
        },
        Perceptions: { Details: perceptions },
        Deductions: { Details: deductions },
      },
    },
    // Informative — Facturama recomputes totals from the complement.
    _computed: {
      total_perceptions: Number(round(totalPerceptions, 2)),
      total_deductions: Number(round(totalDeductions, 2)),
      net_pay: Number(round(net, 2)),
    },
  };
}

/** Stamp a CFDI de Nómina. */
async function stampNomina(input) {
  const payload = buildNominaPayload(input);
  const { _computed, ...body } = payload;
  const cfdi = await request('POST', '/3/cfdis', body, input.creds);
  return normalizeStampResult(cfdi, input.creds, _computed.net_pay);
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
    // Issuer (emisor). In API Web this must match the account's fiscal profile.
    ...(input.issuer
      ? {
          Issuer: {
            Rfc: input.issuer.rfc,
            Name: input.issuer.name,
            FiscalRegime: input.issuer.fiscalRegime,
          },
        }
      : {}),
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

/** List CFDIs the account has issued or received. type: 'issued' | 'received'. */
async function list(type = 'received', creds) {
  const rows = await request('GET', `/cfdi?type=${type}`, null, creds);
  return Array.isArray(rows) ? rows : [];
}

/** Retrieve the stamped PDF as base64. */
async function getPdf(id, creds) {
  const r = await request('GET', `/cfdi/pdf/issued/${id}`, null, creds);
  return { contentBase64: r.Content, contentType: r.ContentType || 'application/pdf' };
}

/** Retrieve the stamped XML as base64. */
async function getXml(id, creds) {
  const r = await request('GET', `/cfdi/xml/issued/${id}`, null, creds);
  return { contentBase64: r.Content, contentType: r.ContentType || 'application/xml' };
}

/** Cancel a stamped CFDI. motive: 01|02|03|04 */
async function cancel(id, opts = {}, creds) {
  const motive = opts.motive || '02';
  let path = `/cfdi/${id}?type=issued&motive=${motive}`;
  if (opts.substitution) path += `&uuidReplacement=${opts.substitution}`;
  return request('DELETE', path, null, creds);
}

module.exports = {
  stampIngreso,
  stampEgreso,
  stampPago,
  stampNomina,
  buildEgresoPayload,
  buildPagoPayload,
  buildNominaPayload,
  getDocument,
  list,
  getPdf,
  getXml,
  cancel,
};
