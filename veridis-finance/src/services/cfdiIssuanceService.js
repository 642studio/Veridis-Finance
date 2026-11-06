const { randomUUID, createHash } = require('node:crypto');

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}
async function reserveIssuance(db, input) {
  const source = input.source || 'api';
  const reference = input.source_ref || randomUUID();
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({
    receiver: input.receiver, items: input.items, paymentMethod: input.paymentMethod || 'PUE',
    paymentForm: input.paymentMethod === 'PPD' ? '99' : (input.paymentForm || '01'),
    invoice_id: input.invoice_id || null, folio: input.folio || null,
    expeditionPlace: input.expeditionPlace || null,
  }))).digest('hex');
  const metadata = JSON.stringify({ issuance_fingerprint: fingerprint, issuance_outcome: 'processing' });
  const { rows } = await db.query(
    `INSERT INTO finance.cfdi_documents
       (organization_id, cfdi_type, status, source, source_ref, receiver_rfc, receiver_name, raw, ghl_contact_id)
     VALUES ($1,'I','draft',$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (organization_id, source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.organization_id, source, reference, input.receiver.rfc, input.receiver.name, metadata, input.ghl_contact_id || null]
  );
  if (rows[0]) return { id: rows[0].id };
  const existing = (await db.query(
    `SELECT * FROM finance.cfdi_documents WHERE organization_id=$1 AND source=$2 AND source_ref=$3`,
    [input.organization_id, source, reference]
  )).rows[0];
  if (!existing) throw conflict('No se pudo recuperar la solicitud de facturación');
  const rejected = existing.status === 'error' && existing.raw?.issuance_outcome === 'rejected';
  if (!rejected && existing.raw?.issuance_fingerprint && existing.raw.issuance_fingerprint !== fingerprint) {
    throw conflict('Esta referencia ya corresponde a otra solicitud. Conserva los datos originales o inicia una factura nueva.');
  }
  if (existing.status === 'stamped' || existing.status === 'canceled') return { existing };
  if (rejected) {
    const claimed = await db.query(
      `UPDATE finance.cfdi_documents SET status='draft', error_message=NULL,
         raw=raw || $3::jsonb, receiver_rfc=$4, receiver_name=$5, ghl_contact_id=$6
       WHERE organization_id=$1 AND id=$2 AND status='error'
         AND raw->>'issuance_outcome'='rejected' RETURNING id`,
      [input.organization_id, existing.id, metadata, input.receiver.rfc, input.receiver.name, input.ghl_contact_id || null]
    );
    if (claimed.rows[0]) return { id: claimed.rows[0].id };
  }
  throw conflict('La emisión está en proceso o su resultado es incierto. Verifica el CFDI en el proveedor antes de volver a emitir.');
}
module.exports = { reserveIssuance };
