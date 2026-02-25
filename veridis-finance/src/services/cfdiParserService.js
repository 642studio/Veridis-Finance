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

  return {
    uuid_sat: uuidSat,
    total,
    emitter,
    receiver,
    invoice_date: invoiceDate,
  };
}

module.exports = {
  parseCfdi40,
};
