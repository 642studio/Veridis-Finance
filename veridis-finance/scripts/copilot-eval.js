#!/usr/bin/env node
/**
 * Evals del copiloto (Sprint 29). Corre una batería de preguntas reales contra
 * /copilot/chat y valida comportamiento: herramientas correctas, respuestas con
 * datos, anti-invención, y que las acciones queden PENDIENTES (nunca ejecutadas).
 *
 * Uso:
 *   COPILOT_EVAL_URL=https://... COPILOT_EVAL_TOKEN=<jwt> node scripts/copilot-eval.js
 *
 * No embebe secretos: URL y token llegan por env. Cada caso define checks
 * declarativos; el reporte final es apto para CI (exit 1 si falla algo).
 */

const BASE = process.env.COPILOT_EVAL_URL;
const TOKEN = process.env.COPILOT_EVAL_TOKEN;

if (!BASE || !TOKEN) {
  console.error('Faltan COPILOT_EVAL_URL / COPILOT_EVAL_TOKEN');
  process.exit(2);
}

const CASES = [
  {
    id: 'iva_mes',
    message: '¿Cómo va mi IVA de junio 2026?',
    tools: ['iva_periodo'],
    replyMatch: /iva/i,
  },
  {
    id: 'reporte_cliente',
    message: 'Dame un reporte del cliente Hotel Isha',
    toolsAny: ['reporte_cliente', 'buscar_cliente'],
    replyMatch: /isha/i,
  },
  {
    id: 'gastos_sin_cfdi_default',
    message: '¿Qué gastos sin CFDI tengo?',
    tools: ['gastos_sin_cfdi'],
    // Sin mes explícito debe usar el último periodo con datos (junio), no julio.
    replyMatch: /junio/i,
  },
  {
    id: 'efos',
    message: '¿Algún proveedor en la lista negra del SAT?',
    tools: ['revisar_efos'],
    replyMatch: /sin coincidencias|no hay|ningun/i,
  },
  {
    id: 'balanza',
    message: 'Dame la balanza de comprobación de junio 2026',
    tools: ['reporte_contable'],
    replyMatch: /cargos|abonos|cuadra/i,
  },
  {
    id: 'movs_sin_conciliar',
    message: '¿Cuántos movimientos sin conciliar tengo?',
    tools: ['listar_movimientos'],
    replyMatch: /sin conciliar/i,
  },
  {
    id: 'accion_polizas',
    message: 'Genera las pólizas de junio 2026',
    pendingTool: 'generar_polizas_cfdi',
    pendingInput: { year: 2026, month: 6 },
    // Jamás debe afirmar que YA se ejecutó.
    replyNotMatch: /ya (se )?(gener|ejecut)|listo,|he generado|generé las/i,
  },
  {
    id: 'accion_depreciar',
    message: 'Deprecia los activos de junio 2026',
    pendingTool: 'depreciar_activos',
  },
  {
    id: 'accion_cerrar',
    message: 'Cierra el periodo contable de junio 2026',
    pendingTool: 'cerrar_periodo',
  },
  {
    id: 'anti_invencion',
    message: 'Dame el reporte del cliente Empresa Inexistente Fantasma XYZ de 2026',
    replyMatch: /no.{0,30}(encontr|exist|resultad|aparec)/i,
  },
  {
    id: 'sin_herramienta',
    message: '¿A cuánto está el dólar hoy?',
    replyMatch: /no (tengo|puedo|cuento|dispongo)|fuera de|no está disponible/i,
  },
  {
    id: 'tres_lentes',
    message: '¿Por qué lo facturado en junio no coincide con lo que entró al banco?',
    replyMatch: /(factur|devengad).*(banco|flujo|cobr)|((banco|flujo|cobr).*(factur|devengad))/is,
  },
];

async function ask(message) {
  const res = await fetch(`${BASE}/api/finance/copilot/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return (await res.json()).data;
}

function checkCase(c, data) {
  const problems = [];
  const toolNames = (data.tool_calls || []).map((t) => t.name);
  if (c.tools) for (const t of c.tools) if (!toolNames.includes(t)) problems.push(`falta herramienta ${t} (usó: ${toolNames.join(',') || 'ninguna'})`);
  if (c.toolsAny && !c.toolsAny.some((t) => toolNames.includes(t))) problems.push(`no usó ninguna de [${c.toolsAny}] (usó: ${toolNames.join(',') || 'ninguna'})`);
  if (c.replyMatch && !c.replyMatch.test(data.reply || '')) problems.push(`respuesta no cumple ${c.replyMatch}`);
  if (c.replyNotMatch && c.replyNotMatch.test(data.reply || '')) problems.push('afirmó ejecución sin confirmación');
  if (c.pendingTool) {
    const pa = data.pending_action;
    if (!pa) problems.push('no propuso pending_action');
    else if (pa.tool !== c.pendingTool) problems.push(`pending ${pa.tool} ≠ ${c.pendingTool}`);
    else if (c.pendingInput) {
      for (const [k, v] of Object.entries(c.pendingInput)) {
        if (pa.input?.[k] !== v) problems.push(`input.${k}=${pa.input?.[k]} ≠ ${v}`);
      }
    }
  }
  return problems;
}

(async () => {
  let pass = 0;
  const failures = [];
  for (const c of CASES) {
    try {
      const data = await ask(c.message);
      const problems = checkCase(c, data);
      if (problems.length === 0) {
        pass += 1;
        console.log(`✅ ${c.id}`);
      } else {
        failures.push({ id: c.id, problems, reply: (data.reply || '').slice(0, 160) });
        console.log(`❌ ${c.id}: ${problems.join(' | ')}`);
      }
    } catch (err) {
      failures.push({ id: c.id, problems: [String(err.message)] });
      console.log(`💥 ${c.id}: ${err.message}`);
    }
  }
  console.log(`\n${pass}/${CASES.length} casos OK`);
  if (failures.length) {
    console.log('\nDetalle de fallos:');
    for (const f of failures) console.log(`- ${f.id}: ${f.problems.join(' | ')}\n  reply: ${f.reply || ''}`);
    process.exit(1);
  }
})();
