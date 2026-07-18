#!/usr/bin/env node
/**
 * E2E de inicio a fin contra un ambiente real (local o producción):
 *
 *   registro → cuenta bancaria → movimiento → factura al libro →
 *   candidatos de conciliación → conciliación automática → confirmación →
 *   reportes (mensual, DIOT, DIOT batch) → planeación (plantilla → import →
 *   resultados) → sync CFDI → limpieza (borra la organización de prueba).
 *
 * Uso:  API_BASE_URL=https://tu-api.vercel.app node scripts/e2e-full.js
 * Sale con código 0 si todo pasa; imprime cada paso PASS/FAIL.
 */

const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TIMEOUT_MS = Number.parseInt(process.env.E2E_TIMEOUT_MS || '30000', 10);

const results = [];
let token = null;

function slug(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function api(path, { method = 'GET', body, raw = false, form } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers, signal: controller.signal };
    if (form) {
      init.body = form; // FormData sets its own content-type
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${API_BASE_URL}${path}`, init);
    if (raw) {
      return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '' });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

(async () => {
  console.log(`E2E contra: ${API_BASE_URL}\n`);
  const email = `${slug('e2e')}@example.com`;
  let accountId = null;
  let transactionId = null;
  let invoiceId = null;
  let planId = null;

  await step('1. Registro de organización', async () => {
    const r = await api('/auth/register', {
      method: 'POST',
      body: {
        organization_name: slug('E2E Org'),
        owner_name: 'E2E Runner',
        owner_email: email,
        password: 'E2e!Passw0rd#2026',
      },
    });
    expect(r.status === 201 || r.status === 200, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    token = r.json?.data?.token;
    expect(token, 'sin token');
    return email;
  });

  await step('2. Salud del API', async () => {
    const r = await api('/health');
    expect(r.status === 200 && r.json?.database === 'connected', `status ${r.status} db=${r.json?.database}`);
  });

  await step('3. Crear cuenta bancaria', async () => {
    const r = await api('/api/finance/accounts', {
      method: 'POST',
      body: { name: 'Banco E2E', type: 'bank', currency: 'MXN', initial_balance: 100000 },
    });
    expect(r.status === 201, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    accountId = r.json?.data?.id;
    expect(accountId, 'sin id de cuenta');
  });

  await step('4. Crear movimiento bancario (ingreso $5,817.40)', async () => {
    const r = await api('/api/finance/transactions', {
      method: 'POST',
      body: {
        type: 'income',
        amount: 5817.4,
        description: 'SPEI RECIBIDO CLIENTE E2E SA DE CV RFC EEE010101AAA',
        category: 'ventas',
        transaction_date: new Date().toISOString().slice(0, 10),
        account_id: accountId,
      },
    });
    expect(r.status === 201, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    transactionId = r.json?.data?.id;
    expect(transactionId, 'sin id de movimiento');
  });

  await step('5. Registrar factura en el libro (misma contraparte y monto)', async () => {
    const r = await api('/api/finance/invoices', {
      method: 'POST',
      body: {
        uuid_sat: `e2e:${Date.now()}`,
        emitter: 'MI EMPRESA E2E',
        receiver: 'CLIENTE E2E SA DE CV',
        total: 5817.4,
        status: 'pending',
        invoice_date: new Date().toISOString().slice(0, 10),
      },
    });
    expect(r.status === 201, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    invoiceId = r.json?.data?.id;
    expect(invoiceId, 'sin id de factura');
  });

  await step('6. Listar facturas con filtros y total', async () => {
    const r = await api('/api/finance/invoices?limit=10&offset=0&q=CLIENTE E2E');
    expect(r.status === 200, `status ${r.status}`);
    expect(Array.isArray(r.json?.data) && r.json.data.length >= 1, 'no encontró la factura por búsqueda');
    expect(typeof r.json?.total === 'number', 'sin total de paginación');
  });

  await step('7. Candidatos de conciliación para el movimiento', async () => {
    const r = await api(`/api/finance/transactions/${transactionId}/reconciliation-candidates`);
    expect(r.status === 200, `status ${r.status}`);
    const c = r.json?.data?.candidates || [];
    expect(c.length >= 1, 'sin candidatos');
    expect(c[0].invoice_id === invoiceId, 'el mejor candidato no es la factura esperada');
    return `score ${c[0].match?.score}`;
  });

  await step('8. Conciliación automática masiva', async () => {
    const r = await api('/api/finance/reconciliation/auto', {
      method: 'POST',
      body: { max_transactions: 50 },
    });
    expect(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
    const d = r.json?.data;
    expect(d.scanned >= 1, 'no escaneó movimientos');
    return `conciliadas ${d.matched} · ambiguas ${d.ambiguous} · sin factura ${d.no_match}`;
  });

  await step('9. La factura quedó pagada/conciliada', async () => {
    const r = await api('/api/finance/invoices?limit=10&q=CLIENTE E2E');
    const inv = (r.json?.data || []).find((x) => x.id === invoiceId);
    expect(inv, 'factura no encontrada');
    expect(inv.status === 'paid', `estatus=${inv?.status} (esperado paid tras auto-conciliación)`);
  });

  await step('10. Reporte mensual', async () => {
    const now = new Date();
    const r = await api(
      `/api/finance/report/month?month=${String(now.getMonth() + 1).padStart(2, '0')}&year=${now.getFullYear()}`
    );
    expect(r.status === 200, `status ${r.status}`);
  });

  await step('11. Reporte DIOT + archivo batch', async () => {
    const now = new Date();
    const q = `month=${String(now.getMonth() + 1).padStart(2, '0')}&year=${now.getFullYear()}`;
    const r1 = await api(`/api/finance/report/diot?${q}`);
    expect(r1.status === 200, `diot status ${r1.status}`);
    const r2 = await api(`/api/finance/report/diot/batch?${q}`, { raw: true });
    expect(r2.status === 200, `batch status ${r2.status}`);
  });

  await step('12. Planeación: plantilla → import → resultados', async () => {
    const tpl = await api('/api/planning/template', { raw: true });
    expect(tpl.status === 200 && tpl.buffer.length > 1000, `plantilla status ${tpl.status}`);

    const form = new FormData();
    form.append(
      'file',
      new Blob([tpl.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'plantilla-planeacion.xlsx'
    );
    const imp = await api('/api/planning/import', { method: 'POST', form });
    expect(
      imp.status === 200 || imp.status === 201,
      `import status ${imp.status}: ${JSON.stringify(imp.json).slice(0, 300)}`
    );
    planId = imp.json?.data?.plan?.id || imp.json?.data?.plan_id || imp.json?.data?.id;
    expect(planId, `sin plan id: ${JSON.stringify(imp.json).slice(0, 200)}`);

    const res = await api(`/api/planning/plans/${planId}/results`);
    expect(res.status === 200, `results status ${res.status}`);
    return `plan ${String(planId).slice(0, 8)}…`;
  });

  await step('13. Sync CFDI (sin PAC configurado responde limpio)', async () => {
    const r = await api('/api/finance/cfdi/sync-invoices', { method: 'POST' });
    expect(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`);
  });

  await step('14. Nómina valida entrada (rechaza payload incompleto)', async () => {
    const r = await api('/api/finance/cfdi/payroll', { method: 'POST', body: { employee: {} } });
    expect(r.status === 400, `status ${r.status} (esperado 400 de validación)`);
  });

  await step('15. Limpieza: borrar organización de prueba', async () => {
    const r = await api('/auth/account', { method: 'DELETE' });
    expect(r.status === 200 || r.status === 204, `status ${r.status}`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== E2E: ${results.length - failed.length}/${results.length} pasos OK =====`);
  if (failed.length) {
    console.log('Fallos:');
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error('E2E abortado:', err.message);
  process.exit(1);
});
