/**
 * PAC (timbrado) service — the fiscal stamping abstraction.
 *
 * Thin, provider-agnostic interface so the rest of the app never talks to a
 * specific PAC directly. The default implementation is Facturapi (best Node SDK
 * + native per-tenant "Organizations"); a Facturama implementation can be added
 * behind the same interface later without touching callers.
 *
 * Configuration (env or per-tenant issuer record):
 *   PAC_PROVIDER       'facturapi' (default)
 *   FACTURAPI_KEY      API key. Use a TEST/sandbox key while developing.
 *
 * A per-tenant key (issuer.pac_api_key) overrides the env key, which is how
 * multi-tenant issuing works: one Facturapi Organization (RFC) per tenant.
 */

const FacturapiModule = require('facturapi');
const Facturapi = FacturapiModule.default || FacturapiModule;
const { round } = require('../lib/money');

function getClient(apiKey) {
  const key = apiKey || process.env.FACTURAPI_KEY;
  if (!key) {
    const err = new Error('Missing PAC API key (FACTURAPI_KEY or issuer.pac_api_key)');
    err.statusCode = 500;
    throw err;
  }
  return new Facturapi(key);
}

/**
 * Map a normalized invoice into Facturapi's payload and stamp a CFDI de Ingreso.
 *
 * @param {object} input
 * @param {string} [input.apiKey]            per-tenant PAC key (else env)
 * @param {object} input.receiver            { rfc, name, fiscalRegime, use, zip }
 * @param {Array}  input.items              [{ description, productKey, unitKey?, quantity, unitPrice, taxIncluded?, ivaRate? }]
 * @param {string} [input.paymentForm='01']  c_FormaPago
 * @param {'PUE'|'PPD'} [input.paymentMethod='PUE']
 * @param {string} [input.folio]
 * @returns {Promise<{ id:string, uuid:string, folio:string|number, total:number, xmlUrl:string, pdfUrl:string, raw:object }>}
 */
async function stampIngreso(input) {
  const client = getClient(input.apiKey);

  const isPPD = input.paymentMethod === 'PPD';

  const payload = {
    type: 'I',
    customer: {
      legal_name: input.receiver.name,
      tax_id: input.receiver.rfc,
      tax_system: input.receiver.fiscalRegime,
      address: { zip: input.receiver.zip },
    },
    use: input.receiver.use || 'G03',
    // PPD invoices must carry forma_pago "99" (Por definir); PUE carries the real one.
    payment_form: isPPD ? '99' : (input.paymentForm || '01'),
    payment_method: input.paymentMethod || 'PUE',
    items: input.items.map((it) => ({
      quantity: Number(it.quantity ?? 1),
      product: {
        description: it.description,
        product_key: it.productKey || '01010101', // "no existe en el catálogo" fallback
        unit_key: it.unitKey || 'E48', // Unidad de servicio
        price: Number(round(it.unitPrice)),
        tax_included: it.taxIncluded ?? false,
        taxes: it.ivaRate === 0
          ? []
          : [{ type: 'IVA', rate: it.ivaRate ?? 0.16, factor: 'Tasa' }],
      },
    })),
  };

  if (input.folio) payload.folio_number = Number(input.folio);

  const inv = await client.invoices.create(payload);

  return {
    id: inv.id,
    uuid: inv.uuid,
    folio: inv.folio_number,
    total: inv.total,
    status: inv.status,
    xmlUrl: `https://www.facturapi.io/v2/invoices/${inv.id}/xml`,
    pdfUrl: `https://www.facturapi.io/v2/invoices/${inv.id}/pdf`,
    raw: inv,
  };
}

/** Fetch a stamped document by PAC id. */
async function getDocument(id, apiKey) {
  const client = getClient(apiKey);
  return client.invoices.retrieve(id);
}

/**
 * Cancel a CFDI.
 * @param {string} id
 * @param {object} [opts] { motive: '01'|'02'|'03'|'04', substitution: uuid }
 */
async function cancel(id, opts = {}, apiKey) {
  const client = getClient(apiKey);
  return client.invoices.cancel(id, {
    motive: opts.motive || '02',
    ...(opts.substitution ? { substitution: opts.substitution } : {}),
  });
}

module.exports = { stampIngreso, getDocument, cancel, getClient };
