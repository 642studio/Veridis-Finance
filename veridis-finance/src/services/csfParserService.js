/**
 * Constancia de Situación Fiscal (CSF) parser.
 *
 * Extracts the fiscal data needed to issue a CFDI to a customer straight from
 * their SAT CSF PDF: RFC, razón social / nombre, régimen fiscal (mapped to its
 * c_RegimenFiscal code) and código postal. Values are best-effort; the caller
 * should let the user confirm before persisting.
 */

const pdf = require('pdf-parse');

// c_RegimenFiscal: fragment of the régimen name (lowercased) -> SAT code.
const REGIME_MAP = [
  ['simplificado de confianza', '626'],
  ['general de ley personas morales', '601'],
  ['personas morales con fines no lucrativos', '603'],
  ['sueldos y salarios', '605'],
  ['arrendamiento', '606'],
  ['enajenaci', '607'],
  ['demás ingresos', '608'],
  ['dividendos', '611'],
  ['actividades empresariales y profesionales', '612'],
  ['intereses', '614'],
  ['premios', '615'],
  ['sin obligaciones fiscales', '616'],
  ['incorporaci', '621'],
  ['agrícolas', '622'],
  ['coordinados', '624'],
  ['plataformas tecnológicas', '625'],
];

function mapRegime(text) {
  const t = (text || '').toLowerCase();
  for (const [needle, code] of REGIME_MAP) {
    if (t.includes(needle)) return code;
  }
  return null;
}

function grab(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/**
 * @param {Buffer} buffer  the CSF PDF
 * @returns {Promise<{rfc, name, fiscal_regime, zip_code, regime_label, is_moral, raw}>}
 */
async function parseCsf(buffer) {
  const parsed = await pdf(buffer);
  const text = parsed.text || '';
  const flat = text.replace(/\s+/g, ' ');

  const rfc = grab(flat, /RFC:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i);

  // Persona moral: "Denominación/Razón Social"; persona física: Nombre + apellidos.
  let name =
    grab(flat, /Denominaci[oó]n\/?\s*Raz[oó]n\s*Social:?\s*([^:]+?)\s*(?:R[eé]gimen|Nombre Comercial|Fecha)/i) ||
    grab(flat, /Raz[oó]n\s*Social:?\s*([^:]+?)\s*(?:R[eé]gimen|Fecha)/i);
  const is_moral = Boolean(name);
  if (!name) {
    const nombre = grab(flat, /Nombre\s*\(s\):?\s*([A-ZÑÁÉÍÓÚ ]+?)\s*(?:Primer|Apellido)/i);
    const ap1 = grab(flat, /Primer\s*Apellido:?\s*([A-ZÑÁÉÍÓÚ ]+?)\s*(?:Segundo|Apellido|Fecha|CURP)/i);
    const ap2 = grab(flat, /Segundo\s*Apellido:?\s*([A-ZÑÁÉÍÓÚ ]+?)\s*(?:Fecha|CURP|Nombre)/i);
    name = [ap1, ap2, nombre].filter(Boolean).join(' ').trim() || null;
  }
  if (name) {
    // CFDI 4.0: UPPERCASE, without régimen de capital.
    name = name.toUpperCase().replace(/\s+S\.?A\.?S?\.?\s+DE\s+C\.?V\.?$/i, '').trim();
  }

  const zip_code = grab(flat, /C[oó]digo\s*Postal:?\s*(\d{5})/i);

  // Régimen fiscal (avoid "Régimen Capital", which is the sociedad type).
  const regime_label =
    grab(flat, /R[eé]gimen(?!\s*Capital)[^:]*:?\s*(R[eé]gimen[^0-9]+?)(?:Fecha|\d{2}\/\d{2}\/\d{4})/i) ||
    grab(flat, /(R[eé]gimen\s+Simplificado\s+de\s+Confianza)/i) ||
    grab(flat, /(R[eé]gimen\s+General\s+de\s+Ley\s+Personas\s+Morales)/i);

  return {
    rfc: rfc ? rfc.toUpperCase() : null,
    name,
    fiscal_regime: mapRegime(regime_label || flat),
    zip_code,
    regime_label: regime_label || null,
    is_moral,
    raw: { textPreview: flat.slice(0, 1200) },
  };
}

module.exports = { parseCsf, mapRegime };
