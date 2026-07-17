const { XMLParser } = require('fast-xml-parser');

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function pickFirst(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function personAsText(personNode, label) {
  if (!personNode || typeof personNode !== 'object') {
    throw badRequest(`CFDI ${label} data is missing`);
  }

  const rfc = pickFirst(personNode, ['Rfc', 'RFC', 'rfc']);
  const name = pickFirst(personNode, ['Nombre', 'nombre', 'Name', 'name']);

  if (!rfc && !name) {
    throw badRequest(`CFDI ${label} data is incomplete`);
  }

  if (rfc && name) {
    return `${rfc} - ${name}`;
  }

  return rfc || name;
}

function num(value) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

/** Structured emisor/receptor fields (RFC, name, régimen, uso, CP). */
function personFields(node) {
  if (!node || typeof node !== 'object') return {};
  return {
    rfc: pickFirst(node, ['Rfc', 'RFC', 'rfc']) || null,
    name: pickFirst(node, ['Nombre', 'nombre', 'Name', 'name']) || null,
    fiscal_regime: pickFirst(node, ['RegimenFiscal', 'RegimenFiscalReceptor']) || null,
    cfdi_use: pickFirst(node, ['UsoCFDI', 'usoCFDI']) || null,
    zip_code: pickFirst(node, ['DomicilioFiscalReceptor']) || null,
  };
}

/** Flatten a CFDI Impuestos node (Traslados/Retenciones) into simple rows. */
function extractTaxes(impuestosNode) {
  const out = { total_trasladados: null, total_retenidos: null, traslados: [], retenciones: [] };
  if (!impuestosNode || typeof impuestosNode !== 'object') return out;

  out.total_trasladados = num(pickFirst(impuestosNode, ['TotalImpuestosTrasladados']));
  out.total_retenidos = num(pickFirst(impuestosNode, ['TotalImpuestosRetenidos']));

  const trasladosParent = pickFirst(impuestosNode, ['Traslados']);
  for (const t of asArray(pickFirst(trasladosParent || {}, ['Traslado']))) {
    out.traslados.push({
      impuesto: pickFirst(t, ['Impuesto']) || null,
      tipo_factor: pickFirst(t, ['TipoFactor']) || null,
      tasa: num(pickFirst(t, ['TasaOCuota'])),
      base: num(pickFirst(t, ['Base'])),
      importe: num(pickFirst(t, ['Importe'])),
    });
  }
  const retParent = pickFirst(impuestosNode, ['Retenciones']);
  for (const r of asArray(pickFirst(retParent || {}, ['Retencion']))) {
    out.retenciones.push({
      impuesto: pickFirst(r, ['Impuesto']) || null,
      importe: num(pickFirst(r, ['Importe'])),
    });
  }
  return out;
}

/** Line items (Conceptos) with amounts. */
function extractConcepts(conceptosNode) {
  const concepts = [];
  for (const c of asArray(pickFirst(conceptosNode || {}, ['Concepto']))) {
    concepts.push({
      product_key: pickFirst(c, ['ClaveProdServ']) || null,
      description: pickFirst(c, ['Descripcion']) || null,
      quantity: num(pickFirst(c, ['Cantidad'])),
      unit_price: num(pickFirst(c, ['ValorUnitario'])),
      amount: num(pickFirst(c, ['Importe'])),
    });
  }
  return concepts;
}

function extractTimbreUuid(comprobanteNode) {
  const complemento = pickFirst(comprobanteNode, ['Complemento', 'cfdi:Complemento']);
  if (!complemento) {
    throw badRequest('CFDI complemento was not found');
  }

  const timbres = asArray(
    pickFirst(complemento, ['TimbreFiscalDigital', 'tfd:TimbreFiscalDigital'])
  );

  for (const timbre of timbres) {
    const uuidValue = pickFirst(timbre, ['UUID', 'Uuid', 'uuid']);
    if (typeof uuidValue === 'string' && uuidValue.trim()) {
      const normalized = uuidValue.trim().toUpperCase();
      if (!UUID_REGEX.test(normalized)) {
        throw badRequest('CFDI UUID is invalid');
      }
      return normalized;
    }
  }

  throw badRequest('CFDI UUID (TimbreFiscalDigital) was not found');
}

function parseCfdi40(xmlContent) {
  if (!xmlContent || !xmlContent.trim()) {
    throw badRequest('Uploaded XML is empty');
  }

  let parsedXml;
  try {
    parsedXml = parser.parse(xmlContent);
  } catch (error) {
    throw badRequest('XML could not be parsed');
  }

  const comprobante = pickFirst(parsedXml, ['Comprobante', 'cfdi:Comprobante']);
  if (!comprobante || typeof comprobante !== 'object') {
    throw badRequest('CFDI Comprobante node was not found');
  }

  const version = String(pickFirst(comprobante, ['Version', 'version']) || '');
  if (version !== '4.0') {
    throw badRequest(
      `Unsupported CFDI version: ${version || 'unknown'}. Only CFDI 4.0 is allowed`
    );
  }

  const totalRaw = pickFirst(comprobante, ['Total', 'total']);
  const total = Number.parseFloat(String(totalRaw || ''));
  if (!Number.isFinite(total) || total <= 0) {
    throw badRequest('CFDI total is invalid');
  }

  const dateRaw = pickFirst(comprobante, ['Fecha', 'fecha']);
  const invoiceDate = new Date(dateRaw || '');
  if (Number.isNaN(invoiceDate.getTime())) {
    throw badRequest('CFDI date is invalid');
  }

  const emitterNode = pickFirst(comprobante, ['Emisor', 'cfdi:Emisor']);
  const receiverNode = pickFirst(comprobante, ['Receptor', 'cfdi:Receptor']);

  const uuidSat = extractTimbreUuid(comprobante);
  const emitter = personAsText(emitterNode, 'emitter');
  const receiver = personAsText(receiverNode, 'receiver');

  const emitterFields = personFields(emitterNode);
  const receiverFields = personFields(receiverNode);
  const taxes = extractTaxes(pickFirst(comprobante, ['Impuestos', 'cfdi:Impuestos']));
  const concepts = extractConcepts(pickFirst(comprobante, ['Conceptos', 'cfdi:Conceptos']));

  return {
    // Backward-compatible fields.
    uuid_sat: uuidSat,
    total,
    emitter,
    receiver,
    invoice_date: invoiceDate,
    // Structured fields for reconciliation, DIOT and supplier ledgers.
    subtotal: num(pickFirst(comprobante, ['SubTotal', 'subTotal'])),
    currency: pickFirst(comprobante, ['Moneda', 'moneda']) || null,
    comprobante_type: pickFirst(comprobante, ['TipoDeComprobante']) || null,
    forma_pago: pickFirst(comprobante, ['FormaPago']) || null,
    metodo_pago: pickFirst(comprobante, ['MetodoPago']) || null,
    emitter_rfc: emitterFields.rfc,
    emitter_name: emitterFields.name,
    emitter_fiscal_regime: emitterFields.fiscal_regime,
    receiver_rfc: receiverFields.rfc,
    receiver_name: receiverFields.name,
    receiver_fiscal_regime: receiverFields.fiscal_regime,
    receiver_cfdi_use: receiverFields.cfdi_use,
    receiver_zip_code: receiverFields.zip_code,
    taxes,
    concepts,
  };
}

module.exports = {
  parseCfdi40,
};
