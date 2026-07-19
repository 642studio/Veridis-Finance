/**
 * Materialidad (CFF art. 49 Bis): evidence files attached to a CFDI so the
 * tenant can prove the operation actually happened (contracts, deliverables,
 * photos, emails). Stored inline in Postgres, capped at 5MB per file.
 */

const pool = require('../db/pool');

const MAX_BYTES = 5 * 1024 * 1024;

async function assertCfdi(organizationId, cfdiId) {
  const { rows } = await pool.query(
    `SELECT id FROM finance.cfdi_documents WHERE organization_id = $1 AND id = $2`,
    [organizationId, cfdiId]
  );
  if (!rows[0]) {
    const err = new Error('CFDI no encontrado');
    err.statusCode = 404;
    throw err;
  }
}

async function upload(organizationId, cfdiId, { filename, mimeType, content, note, tags, uploadedBy }) {
  if (!content || !content.length) {
    const err = new Error('Archivo vacío');
    err.statusCode = 400;
    throw err;
  }
  if (content.length > MAX_BYTES) {
    const err = new Error('El archivo excede 5MB');
    err.statusCode = 413;
    throw err;
  }
  await assertCfdi(organizationId, cfdiId);
  const { rows } = await pool.query(
    `INSERT INTO finance.cfdi_evidence
       (organization_id, cfdi_id, filename, mime_type, size_bytes, content, note, tags, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, filename, mime_type, size_bytes, note, tags, created_at`,
    [
      organizationId, cfdiId, filename.slice(0, 255),
      mimeType || 'application/octet-stream', content.length, content,
      note || null, tags || [], uploadedBy || null,
    ]
  );
  return rows[0];
}

async function list(organizationId, cfdiId) {
  const { rows } = await pool.query(
    `SELECT id, filename, mime_type, size_bytes, note, tags, created_at
       FROM finance.cfdi_evidence
      WHERE organization_id = $1 AND cfdi_id = $2
      ORDER BY created_at DESC`,
    [organizationId, cfdiId]
  );
  return rows;
}

async function download(organizationId, cfdiId, evidenceId) {
  const { rows } = await pool.query(
    `SELECT filename, mime_type, content FROM finance.cfdi_evidence
      WHERE organization_id = $1 AND cfdi_id = $2 AND id = $3`,
    [organizationId, cfdiId, evidenceId]
  );
  return rows[0] || null;
}

async function remove(organizationId, cfdiId, evidenceId) {
  const { rowCount } = await pool.query(
    `DELETE FROM finance.cfdi_evidence WHERE organization_id = $1 AND cfdi_id = $2 AND id = $3`,
    [organizationId, cfdiId, evidenceId]
  );
  return rowCount > 0;
}

module.exports = { upload, list, download, remove, MAX_BYTES };
