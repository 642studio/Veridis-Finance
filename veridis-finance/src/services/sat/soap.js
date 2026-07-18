/**
 * SOAP envelope builders + transport for the SAT "Servicio de Descarga Masiva
 * de CFDI de Terceros". Four operations, each authenticated with the taxpayer's
 * FIEL via WS-Security XML Signature (RSA-SHA1, exclusive C14N):
 *
 *   1. Autentica   → short-lived bearer token (signs a WS-Security Timestamp)
 *   2. Solicita    → open a request for a date range (signs the <solicitud> node)
 *   3. Verifica    → poll the request until packages are ready
 *   4. Descarga    → download each package (base64 ZIP in the SOAP response)
 *
 * Canonicalization strategy: we GENERATE the XML already in exclusive-C14N form
 * and digest/sign those exact bytes, then embed them verbatim. When the SAT
 * re-canonicalizes the same subtree it reproduces the bytes we signed. This is
 * the standard approach used by the reference SAT libraries and avoids pulling
 * in a full XML-DSig canonicalizer.
 *
 * NOTE: The live SAT handshake can only be validated with a real e.firma against
 * the SAT servers. The builders below follow the documented wire format; treat a
 * first run against production as a validation step.
 */

const { signSha1, digestSha1 } = require('./fiel');

const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  u: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  o: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  x509Token:
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3',
  b64:
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  auth: 'http://DescargaMasivaTerceros.gob.mx',
  query: 'http://DescargaMasivaTerceros.sat.gob.mx',
};

const ENDPOINTS = {
  production: {
    auth: 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc',
    solicita: 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc',
    verifica:
      'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc',
    descarga: 'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc',
  },
};

const SOAP_ACTIONS = {
  auth: 'http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica',
  // The SAT split the single SolicitaDescarga into two operations; the legacy
  // one now returns ActionNotSupported. Pick by direction.
  solicitaEmitidos:
    'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaEmitidos',
  solicitaRecibidos:
    'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaRecibidos',
  verifica:
    'http://DescargaMasivaTerceros.sat.gob.mx/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga',
  descarga: 'http://DescargaMasivaTerceros.sat.gob.mx/IDescargaMasivaService/Descargar',
};

function pad(n) {
  return String(n).padStart(2, '0');
}

/** SAT wants UTC timestamps like 2026-07-18T12:34:56.000Z for the WS Timestamp. */
function isoUtc(date) {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.000Z`
  );
}

/** Local date-time (no zone) like 2019-01-01T00:00:00 for the query range. */
function localRange(dateStr, endOfDay) {
  const d = String(dateStr).slice(0, 10);
  return `${d}T${endOfDay ? '23:59:59' : '00:00:00'}`;
}

/** A KeyInfo block referencing the BinarySecurityToken by id. */
function keyInfoXml(tokenId) {
  return (
    `<KeyInfo>` +
    `<o:SecurityTokenReference xmlns:o="${NS.o}">` +
    `<o:Reference ValueType="${NS.x509Token}" URI="#${tokenId}"/>` +
    `</o:SecurityTokenReference>` +
    `</KeyInfo>`
  );
}

// ---------------------------------------------------------------------------
// 1. Autenticación — signs a WS-Security Timestamp (Reference #_0).
// ---------------------------------------------------------------------------
function buildAuthEnvelope(fiel, now = new Date()) {
  const created = isoUtc(now);
  const expires = isoUtc(new Date(now.getTime() + 5 * 60 * 1000));
  const tokenId = `uuid-${fiel.serial}-1`;

  // Canonical (exc-c14n) Timestamp — the exact bytes we digest.
  const canonicalTimestamp =
    `<u:Timestamp xmlns:u="${NS.u}" u:Id="_0">` +
    `<u:Created>${created}</u:Created>` +
    `<u:Expires>${expires}</u:Expires>` +
    `</u:Timestamp>`;
  const digestValue = digestSha1(canonicalTimestamp);

  // Canonical SignedInfo — the exact bytes we RSA-SHA1 sign.
  const canonicalSignedInfo =
    `<SignedInfo xmlns="${NS.ds}">` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#_0">` +
    `<Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></Transform>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;
  const signatureValue = signSha1(fiel.privateKey, canonicalSignedInfo);

  const envelope =
    `<s:Envelope xmlns:s="${NS.soap}" xmlns:u="${NS.u}">` +
    `<s:Header>` +
    `<o:Security xmlns:o="${NS.o}" s:mustUnderstand="1">` +
    `<u:Timestamp u:Id="_0"><u:Created>${created}</u:Created><u:Expires>${expires}</u:Expires></u:Timestamp>` +
    `<o:BinarySecurityToken u:Id="${tokenId}" ValueType="${NS.x509Token}" EncodingType="${NS.b64}">${fiel.certDerBase64}</o:BinarySecurityToken>` +
    `<Signature xmlns="${NS.ds}">` +
    canonicalSignedInfo +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    keyInfoXml(tokenId) +
    `</Signature>` +
    `</o:Security>` +
    `</s:Header>` +
    `<s:Body><Autentica xmlns="${NS.auth}"/></s:Body>` +
    `</s:Envelope>`;

  return envelope;
}

// ---------------------------------------------------------------------------
// Enveloped signature over a query node (solicitud / VerificaSolicitudDescarga /
// PeticionDescargaMasivaTerceros). Reference URI="" + enveloped-signature.
// ---------------------------------------------------------------------------
function buildEnvelopedSignature(fiel, canonicalNodeWithoutSignature) {
  const tokenId = `uuid-${fiel.serial}-1`;
  const digestValue = digestSha1(canonicalNodeWithoutSignature);

  const canonicalSignedInfo =
    `<SignedInfo xmlns="${NS.ds}">` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>` +
    `<Reference URI="">` +
    `<Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;
  const signatureValue = signSha1(fiel.privateKey, canonicalSignedInfo);

  return (
    `<Signature xmlns="${NS.ds}">` +
    canonicalSignedInfo +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo>` +
    `<X509Data>` +
    `<X509IssuerSerial>` +
    `<X509IssuerName>${escapeXml(fiel.issuerName || '')}</X509IssuerName>` +
    `<X509SerialNumber>${fiel.serial}</X509SerialNumber>` +
    `</X509IssuerSerial>` +
    `<X509Certificate>${fiel.certDerBase64}</X509Certificate>` +
    `</X509Data>` +
    `</KeyInfo>` +
    `</Signature>`
  );
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 2. SolicitaDescarga — request a date range for emitidas or recibidas.
//    requestType: 'issued' → RfcEmisor = self ; 'received' → RfcReceptor = self
//    downloadType: 'CFDI' | 'Metadata'
// ---------------------------------------------------------------------------
function buildSolicitaEnvelope(fiel, { requestType, downloadType, dateFrom, dateTo }, now = new Date()) {
  const rfc = fiel.rfc;
  const fechaInicial = localRange(dateFrom, false);
  const fechaFinal = localRange(dateTo, true);
  const tipo = downloadType === 'Metadata' ? 'Metadata' : 'CFDI';

  // Attributes must be in the canonical (alphabetical) order for c14n.
  // Common: FechaFinal, FechaInicial, RfcSolicitante, TipoSolicitud + the
  // directional Rfc (RfcEmisor for issued / RfcReceptor for received).
  let attrs;
  if (requestType === 'received') {
    attrs =
      `FechaFinal="${fechaFinal}" FechaInicial="${fechaInicial}" ` +
      `RfcReceptor="${rfc}" RfcSolicitante="${rfc}" TipoSolicitud="${tipo}"`;
  } else {
    attrs =
      `FechaFinal="${fechaFinal}" FechaInicial="${fechaInicial}" ` +
      `RfcEmisor="${rfc}" RfcSolicitante="${rfc}" TipoSolicitud="${tipo}"`;
  }

  // Split operation: SolicitaDescargaEmitidos (I issued) vs
  // SolicitaDescargaRecibidos (I received). The signed <solicitud> node itself
  // is identical in shape; only the wrapper element + SOAPAction differ.
  const operation =
    requestType === 'received' ? 'SolicitaDescargaRecibidos' : 'SolicitaDescargaEmitidos';

  const canonicalNode = `<solicitud xmlns="${NS.query}" ${attrs}></solicitud>`;
  const signature = buildEnvelopedSignature(fiel, canonicalNode);

  const body =
    `<${operation} xmlns="${NS.query}">` +
    `<solicitud ${attrs}>${signature}</solicitud>` +
    `</${operation}>`;

  return wrapSimpleEnvelope(body);
}

/** The SOAPAction for a Solicita request, chosen by direction. */
function solicitaAction(requestType) {
  return requestType === 'received'
    ? SOAP_ACTIONS.solicitaRecibidos
    : SOAP_ACTIONS.solicitaEmitidos;
}

// ---------------------------------------------------------------------------
// 3. VerificaSolicitudDescarga — poll a request id.
// ---------------------------------------------------------------------------
function buildVerificaEnvelope(fiel, satRequestId) {
  const rfc = fiel.rfc;
  const attrs = `IdSolicitud="${satRequestId}" RfcSolicitante="${rfc}"`;
  const canonicalNode = `<solicitud xmlns="${NS.query}" ${attrs}></solicitud>`;
  const signature = buildEnvelopedSignature(fiel, canonicalNode);

  const body =
    `<VerificaSolicitudDescarga xmlns="${NS.query}">` +
    `<solicitud ${attrs}>${signature}</solicitud>` +
    `</VerificaSolicitudDescarga>`;

  return wrapSimpleEnvelope(body);
}

// ---------------------------------------------------------------------------
// 4. Descargar — fetch one package by id.
// ---------------------------------------------------------------------------
function buildDescargaEnvelope(fiel, packageId) {
  const rfc = fiel.rfc;
  const attrs = `IdPaquete="${packageId}" RfcSolicitante="${rfc}"`;
  const canonicalNode = `<peticionDescarga xmlns="${NS.query}" ${attrs}></peticionDescarga>`;
  const signature = buildEnvelopedSignature(fiel, canonicalNode);

  const body =
    `<PeticionDescargaMasivaTercerosEntrada xmlns="${NS.query}">` +
    `<peticionDescarga ${attrs}>${signature}</peticionDescarga>` +
    `</PeticionDescargaMasivaTercerosEntrada>`;

  return wrapSimpleEnvelope(body);
}

function wrapSimpleEnvelope(bodyXml) {
  return (
    `<s:Envelope xmlns:s="${NS.soap}">` +
    `<s:Header/>` +
    `<s:Body>${bodyXml}</s:Body>` +
    `</s:Envelope>`
  );
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
function endpoints(env = 'production') {
  return ENDPOINTS[env] || ENDPOINTS.production;
}

async function postSoap(url, soapAction, xml, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${soapAction}"`,
      ...extraHeaders,
    },
    body: xml,
  });
  const text = await res.text();
  return { status: res.status, body: text, headers: res.headers };
}

module.exports = {
  NS,
  SOAP_ACTIONS,
  endpoints,
  isoUtc,
  buildAuthEnvelope,
  buildSolicitaEnvelope,
  buildVerificaEnvelope,
  buildDescargaEnvelope,
  solicitaAction,
  postSoap,
};
