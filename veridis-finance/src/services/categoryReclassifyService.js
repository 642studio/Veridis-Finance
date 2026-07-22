/**
 * Re-categorización de movimientos (S31). Toma los gastos en "Por revisar" (el
 * hoyo negro que dejó la taxonomía vieja) y les asigna una categoría canónica
 * con dos pasadas:
 *   1) REGLAS deterministas (confianza 1.0): patrones inequívocos del texto del
 *      banco — disposiciones de cajero, pagos de crédito, comisiones, retiros al
 *      dueño. No dependen de un modelo.
 *   2) IA (Anthropic): para lo que las reglas no atrapan (pagos recurrentes a
 *      personas = freelancers, proveedores por nombre). Solo se aplica con
 *      confianza ≥ 0.8; lo demás se queda en "Por revisar".
 *
 * Nunca cambia el tipo (income/expense) ni el monto: solo la categoría. Los
 * retiros a la cuenta personal del dueño se marcan "Retiros de socio" (no son
 * gasto operativo, criterio contable estándar).
 */

const pool = require('../db/pool');
const { createMessage } = require('./copilot/anthropicClient');
const { EXPENSE_CATEGORIES, REVIEW_CATEGORY, isCanonical } = require('./categoryTaxonomy');

const CONFIDENCE_APPLY = 0.8;
const AI_BATCH_SIZE = 30;

/**
 * Reglas deterministas sobre (descripción cruda + concepto). Devuelve la
 * categoría canónica o null. `ownerNames` = nombres del dueño/organización para
 * detectar retiros de socio.
 */
function applyRules(text, ownerNames = []) {
  const hay = String(text || '').toLowerCase();

  // Disposición de efectivo en cajero: dinero que sale a mano del dueño.
  if (/disp\s+atm|disposicion.*efectivo|retiro (?:de )?efectivo/.test(hay)) {
    return 'Retiros de socio';
  }
  // Pago de crédito / préstamo / tarjeta de crédito.
  if (/pago (?:de )?credito|amortizacion|prestamo|tarjeta de credito|credito personal/.test(hay)) {
    return 'Pago de créditos';
  }
  // Comisiones e IVA de comisión del banco.
  if (/i\s?v\s?a\s?por comision|comision(?:es)?\b|manejo de cuenta|membresia/.test(hay)) {
    return 'Comisiones bancarias';
  }
  // Retiro al dueño: transferencia a una cuenta a nombre del dueño/organización.
  for (const name of ownerNames) {
    const n = String(name || '').toLowerCase().trim();
    if (n.length >= 4 && hay.includes(n)) return 'Retiros de socio';
  }
  // Software / publicidad / nómina por palabra clave (respaldo del parser).
  if (/highlevel|clickup|vercel|supabase|openai|adobe|microsoft|notion|figma|canva|software/.test(hay)) {
    return 'Software y suscripciones';
  }
  if (/facebook|meta platforms|google ads|tiktok|\bads\b|publicidad/.test(hay)) {
    return 'Publicidad';
  }
  if (/nomina|sueldo|salario/.test(hay)) return 'Nómina y freelancers';
  return null;
}

function buildAIPrompt(orgName, ownerNames) {
  return [
    `Eres un contador mexicano clasificando gastos bancarios de "${orgName || 'la empresa'}".`,
    'Asigna a CADA movimiento UNA categoría de esta lista EXACTA (cópiala literal):',
    EXPENSE_CATEGORIES.map((c) => `- ${c}`).join('\n'),
    '',
    'Criterios:',
    '- "Nómina y freelancers": pagos recurrentes a personas físicas (nombres propios) por su trabajo.',
    '- "Proveedores": compras a negocios/empresas por bienes o insumos.',
    '- "Servicios": servicios básicos o consumos (luz, internet, restaurantes, gasolina).',
    `- "Retiros de socio": dinero que sale hacia el dueño (${ownerNames.join(', ') || 'el titular'}) o efectivo sin comprobante.`,
    '- "Pago de créditos": pagos de préstamos o tarjetas de crédito.',
    '- Si NO tienes suficiente señal para decidir, usa confianza baja (<0.8).',
    '',
    'Responde SOLO con la herramienta clasificar_gastos. No inventes; usa el texto dado.',
  ].join('\n');
}

const AI_TOOL = {
  name: 'clasificar_gastos',
  description: 'Registra la categoría y confianza (0-1) de cada gasto.',
  input_schema: {
    type: 'object',
    properties: {
      resultados: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            categoria: { type: 'string' },
            confianza: { type: 'number' },
          },
          required: ['id', 'categoria', 'confianza'],
        },
      },
    },
    required: ['resultados'],
  },
};

async function classifyBatchAI(rows, orgName, ownerNames) {
  const system = buildAIPrompt(orgName, ownerNames);
  const list = rows.map((r) => ({
    id: r.id,
    texto: `${r.description || ''} | ${r.original_description || ''}`.slice(0, 240),
    monto: Number(r.amount),
  }));
  const messages = [{
    role: 'user',
    content: `Clasifica estos gastos:\n${JSON.stringify(list)}`,
  }];
  const res = await createMessage({ system, messages, tools: [AI_TOOL], maxTokens: 2000 });
  const toolUse = (res.content || []).find((b) => b.type === 'tool_use' && b.name === 'clasificar_gastos');
  const out = new Map();
  for (const r of (toolUse?.input?.resultados || [])) {
    const cat = String(r.categoria || '').trim();
    if (isCanonical(cat) && cat !== REVIEW_CATEGORY) {
      out.set(String(r.id), { category: cat, confidence: Number(r.confianza) || 0 });
    }
  }
  return { results: out, usage: res.usage || {} };
}

async function orgNameFor(organizationId) {
  const { rows } = await pool.query(
    `SELECT name FROM finance.organizations WHERE organization_id = $1 LIMIT 1`, [organizationId]
  ).catch(() => ({ rows: [] }));
  return rows[0]?.name || null;
}

async function ownerNamesFor(organizationId) {
  const names = new Set();
  const { rows } = await pool.query(
    `SELECT DISTINCT full_name FROM finance.users
      WHERE organization_id = $1 AND role IN ('owner','admin') AND full_name IS NOT NULL`,
    [organizationId]
  ).catch(() => ({ rows: [] }));
  for (const r of rows) if (r.full_name) names.add(r.full_name);
  return [...names];
}

/**
 * Re-categoriza los gastos en "Por revisar". Si `apply` es true, persiste;
 * si no, devuelve el preview sin tocar la BD. Devuelve conteos por categoría.
 */
async function reclassifyReviewExpenses({ organizationId, limit = 200, apply = true, useAI = true }) {
  if (!organizationId) {
    const err = new Error('organizationId is required');
    err.statusCode = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `SELECT id, description, original_description, amount, type
       FROM finance.transactions
      WHERE organization_id = $1 AND deleted_at IS NULL
        AND type = 'expense' AND category = $2
      ORDER BY amount DESC
      LIMIT $3`,
    [organizationId, REVIEW_CATEGORY, Math.min(Number(limit) || 200, 1000)]
  );
  if (!rows.length) return { scanned: 0, byRule: 0, byAI: 0, applied: 0, remaining: 0, changes: [] };

  const ownerNames = await ownerNamesFor(organizationId);
  const changes = [];
  const pendingAI = [];

  // Pasada de reglas.
  for (const r of rows) {
    const cat = applyRules(`${r.description || ''} ${r.original_description || ''}`, ownerNames);
    if (cat) changes.push({ id: r.id, category: cat, confidence: 1, source: 'rule' });
    else pendingAI.push(r);
  }

  // Pasada de IA por lotes.
  let aiUsage = { input_tokens: 0, output_tokens: 0 };
  if (useAI && pendingAI.length) {
    const org = await orgNameFor(organizationId);
    for (let i = 0; i < pendingAI.length; i += AI_BATCH_SIZE) {
      const batch = pendingAI.slice(i, i + AI_BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const { results, usage } = await classifyBatchAI(batch, org, ownerNames);
      aiUsage = {
        input_tokens: aiUsage.input_tokens + (usage.input_tokens || 0),
        output_tokens: aiUsage.output_tokens + (usage.output_tokens || 0),
      };
      for (const r of batch) {
        const hit = results.get(String(r.id));
        if (hit && hit.confidence >= CONFIDENCE_APPLY) {
          changes.push({ id: r.id, category: hit.category, confidence: hit.confidence, source: 'ai' });
        }
      }
    }
  }

  // Aplica.
  let applied = 0;
  if (apply && changes.length) {
    for (const c of changes) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `UPDATE finance.transactions
            SET category = $1, match_method = $2, match_confidence = $3, updated_at = now()
          WHERE id = $4 AND organization_id = $5`,
        [c.category, c.source === 'rule' ? 'rule' : 'fuzzy', c.confidence, c.id, organizationId]
      );
      applied += 1;
    }
  }

  const byRule = changes.filter((c) => c.source === 'rule').length;
  const byAI = changes.filter((c) => c.source === 'ai').length;
  return {
    scanned: rows.length,
    byRule,
    byAI,
    applied,
    remaining: rows.length - changes.length,
    ai_usage: aiUsage,
    changes: changes.slice(0, 100),
  };
}

module.exports = { reclassifyReviewExpenses, applyRules, classifyBatchAI };
