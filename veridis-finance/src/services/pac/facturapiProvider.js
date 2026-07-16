/**
 * Facturapi PAC provider (kept as an alternative behind the same interface).
 * Config: FACTURAPI_KEY (use sk_test_... for sandbox).
 */

const FacturapiModule = require('facturapi');
const Facturapi = FacturapiModule.default || FacturapiModule;
const { round } = require('../../lib/money');

function getClient(creds) {
  const key = creds?.apiKey || process.env.FACTURAPI_KEY;
  if (!key) {
    const err = new Error('Missing Facturapi API key (FACTURAPI_KEY)');
    err.statusCode = 500;
    throw err;
  }
  return new Facturapi(key);
}

async function stampIngreso(input) {
  const client = getClient(input.creds);
  const isPPD = input.paymentMethod === 'PPD';

  const inv = await client.invoices.create({
    type: 'I',
    customer: {
      legal_name: input.receiver.name,
      tax_id: input.receiver.rfc,
      tax_system: input.receiver.fiscalRegime,
      address: { zip: input.receiver.zip },
    },
    use: input.receiver.use || 'G03',
    payment_form: isPPD ? '99' : (input.paymentForm || '01'),
    payment_method: input.paymentMethod || 'PUE',
    items: input.items.map((it) => ({
      quantity: Number(it.quantity ?? 1),
      product: {
        description: it.description,
        product_key: it.productKey || '01010101',
        unit_key: it.unitKey || 'E48',
        price: Number(round(it.unitPrice)),
        tax_included: it.taxIncluded ?? false,
        taxes: it.ivaRate === 0 ? [] : [{ type: 'IVA', rate: it.ivaRate ?? 0.16, factor: 'Tasa' }],
      },
    })),
    ...(input.folio ? { folio_number: Number(input.folio) } : {}),
  });

  return {
    id: inv.id,
    uuid: inv.uuid,
    folio: inv.folio_number,
    total: inv.total,
    status: inv.status === 'valid' ? 'stamped' : inv.status,
    xmlUrl: `https://www.facturapi.io/v2/invoices/${inv.id}/xml`,
    pdfUrl: `https://www.facturapi.io/v2/invoices/${inv.id}/pdf`,
    raw: inv,
  };
}

async function getDocument(id, creds) {
  return getClient(creds).invoices.retrieve(id);
}

async function cancel(id, opts = {}, creds) {
  return getClient(creds).invoices.cancel(id, {
    motive: opts.motive || '02',
    ...(opts.substitution ? { substitution: opts.substitution } : {}),
  });
}

module.exports = { stampIngreso, getDocument, cancel };
