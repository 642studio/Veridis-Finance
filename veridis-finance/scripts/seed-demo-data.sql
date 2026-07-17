DO $$
DECLARE
  org uuid := 'b2a1bef4-f67b-42b0-93be-156923fc3c51';
  acc_bbva uuid;
  acc_sant uuid;
  acc_amex uuid;
  acc_cash uuid;
  m int;
  txn_date timestamp;
  cli record;
  pwd text := 'scrypt:5df267e83c7e02f4530ba055e6dbf852:94202fa90e5b79ada48c1fe6dc920b3da1b0f8c54b5f502e6a84c32ca64747a1699d5a624f74d7839767696a27e7a4a4da5c21c74749713308388067f12e93f3';
BEGIN
  -- ---- Reset demo credentials (password: Demo1234!) ----
  UPDATE finance.users SET password_hash = pwd, is_active = true, full_name = 'Adrián — 642 Studio', role = 'owner'
   WHERE organization_id = org AND lower(email) = 'demo@642studio.com';
  UPDATE finance.organizations SET name = '642 Studio', plan = 'pro', subscription_status = 'active' WHERE organization_id = org;

  -- ---- Clean prior demo rows (idempotent reseed) ----
  DELETE FROM finance.transactions WHERE organization_id = org;
  DELETE FROM finance.invoices WHERE organization_id = org;
  DELETE FROM finance.subcategories WHERE organization_id = org;
  DELETE FROM finance.categories WHERE organization_id = org;
  DELETE FROM finance.vendors WHERE organization_id = org;
  DELETE FROM finance.clients WHERE organization_id = org;
  DELETE FROM finance.accounts WHERE organization_id = org;

  -- ---- Accounts ----
  INSERT INTO finance.accounts (organization_id, name, type, bank_name, account_number_last4, balance, currency)
    VALUES (org, 'BBVA Empresarial', 'bank', 'BBVA', '4821', 482300.00, 'MXN') RETURNING id INTO acc_bbva;
  INSERT INTO finance.accounts (organization_id, name, type, bank_name, account_number_last4, balance, currency)
    VALUES (org, 'Santander PyME', 'bank', 'Santander', '7134', 128900.00, 'MXN') RETURNING id INTO acc_sant;
  INSERT INTO finance.accounts (organization_id, name, type, bank_name, account_number_last4, credit_limit, cut_day, due_day, balance, currency)
    VALUES (org, 'Amex Platinum', 'credit_card', 'American Express', '1005', 250000.00, 5, 25, -68450.00, 'MXN') RETURNING id INTO acc_amex;
  INSERT INTO finance.accounts (organization_id, name, type, balance, currency)
    VALUES (org, 'Caja / Efectivo', 'cash', 15200.00, 'MXN') RETURNING id INTO acc_cash;

  -- ---- Categories ----
  INSERT INTO finance.categories (organization_id, name, icon, color) VALUES
    (org, 'Retainers', 'repeat', '#15803D'),
    (org, 'Proyectos', 'folder', '#2563EB'),
    (org, 'Setup Fees', 'plus-circle', '#0891B2'),
    (org, 'Publicidad', 'megaphone', '#E0342A'),
    (org, 'Software / SaaS', 'cloud', '#7C3AED'),
    (org, 'Nómina', 'users', '#B45309'),
    (org, 'Renta', 'building', '#6B7280'),
    (org, 'Servicios', 'zap', '#0D9488'),
    (org, 'Impuestos', 'landmark', '#9333EA'),
    (org, 'Comisiones', 'percent', '#DB2777');

  -- Subcategories under Publicidad and Software
  INSERT INTO finance.subcategories (organization_id, category_id, name, color)
    SELECT org, id, x.name, x.color FROM finance.categories c
    CROSS JOIN (VALUES ('Meta Ads','#1877F2'),('Google Ads','#EA4335'),('TikTok Ads','#000000')) AS x(name,color)
    WHERE c.organization_id = org AND c.name = 'Publicidad';
  INSERT INTO finance.subcategories (organization_id, category_id, name, color)
    SELECT org, id, x.name, x.color FROM finance.categories c
    CROSS JOIN (VALUES ('Hosting','#000000'),('Herramientas','#7C3AED'),('IA / LLM','#10A37F')) AS x(name,color)
    WHERE c.organization_id = org AND c.name = 'Software / SaaS';

  -- ---- Clients (agency clients: hoteles/restaurantes) ----
  INSERT INTO finance.clients (organization_id, name, business_name, email, phone) VALUES
    (org, 'Rivi Grand Hotel', 'RIVI GRAND HOTEL SA DE CV', 'admin@rivigrand.mx', '+52 998 123 4567'),
    (org, 'Hotel El Retiro', 'HOTEL EL RETIRO SA DE CV', 'gerencia@elretiro.mx', '+52 55 4821 0099'),
    (org, 'Holiday Inn Rooftop', 'ROOFTOP HOLIDAY INN SA DE CV', 'mkt@rooftophi.mx', '+52 81 2200 1188'),
    (org, 'La Michoacana', 'LA MICHOACANA PALETERIA SA DE CV', 'contacto@lamich.mx', '+52 443 555 7788'),
    (org, 'Booye Hotel', 'BOOYE HOTEL SA DE CV', 'admin@booye.mx', '+52 998 700 4545'),
    (org, 'Grupo Sherman Morgan', 'SHERMAN MORGAN SC', 'finanzas@shermanmorgan.mx', '+52 55 9010 3322');

  -- ---- Vendors ----
  INSERT INTO finance.vendors (organization_id, name, type) VALUES
    (org, 'Meta Platforms', 'ads'),
    (org, 'Google Ads', 'ads'),
    (org, 'TikTok Ads', 'ads'),
    (org, 'Vercel', 'software'),
    (org, 'Supabase', 'software'),
    (org, 'ClickUp', 'software'),
    (org, 'Google Workspace', 'software'),
    (org, 'OpenAI', 'software'),
    (org, 'WeWork Reforma', 'rent'),
    (org, 'CFE', 'utilities'),
    (org, 'Nómina 642', 'payroll');

  -- ---- Transactions: 6 months (Feb–Jul 2026) ----
  FOR m IN 0..5 LOOP
    -- INCOME: monthly retainers from each client (day 3)
    txn_date := date_trunc('month', (DATE '2026-07-01') - (m || ' month')::interval) + INTERVAL '2 day' + INTERVAL '10 hour';
    FOR cli IN
      SELECT name, amt FROM (VALUES
        ('Rivi Grand Hotel', 25000),
        ('Hotel El Retiro', 15000),
        ('Holiday Inn Rooftop', 12000),
        ('La Michoacana', 8000),
        ('Grupo Sherman Morgan', 18000)
      ) AS v(name, amt)
    LOOP
      INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, client_id, account_id, transaction_date, status, source, currency)
        SELECT org, 'income', cli.amt, 'Retainers', 'Retainer mensual — '||cli.name, cli.name, c.id, acc_bbva, txn_date, 'reconciled', 'seed', 'MXN'
        FROM finance.clients c WHERE c.organization_id = org AND c.name = cli.name;
    END LOOP;

    -- EXPENSES
    txn_date := date_trunc('month', (DATE '2026-07-01') - (m || ' month')::interval);
    -- Renta (day 1)
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 18500, 'Renta', 'Renta oficina WeWork Reforma', 'WeWork Reforma', v.id, acc_bbva, txn_date + INTERVAL '9 hour', 'reconciled', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'WeWork Reforma';
    -- Publicidad Meta (day 2, varies by month)
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 42000 + (m*1800), 'Publicidad', 'Meta Ads — campañas clientes', 'Meta Platforms', v.id, acc_amex, txn_date + INTERVAL '1 day 12 hour', 'posted', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'Meta Platforms';
    -- Publicidad Google
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 21500 + (m*900), 'Publicidad', 'Google Ads — search & PMax', 'Google Ads', v.id, acc_amex, txn_date + INTERVAL '1 day 13 hour', 'posted', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'Google Ads';
    -- Nómina (day 15)
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 95000, 'Nómina', 'Nómina quincenal equipo 642', 'Nómina 642', v.id, acc_bbva, txn_date + INTERVAL '14 day', 'reconciled', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'Nómina 642';
    -- SaaS bundle
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 480, 'Software / SaaS', 'Vercel Pro', 'Vercel', v.id, acc_amex, txn_date + INTERVAL '4 day', 'posted', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'Vercel';
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 620, 'Software / SaaS', 'Supabase Team', 'Supabase', v.id, acc_amex, txn_date + INTERVAL '4 day', 'posted', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'Supabase';
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 1350, 'Software / SaaS', 'ClickUp Business', 'ClickUp', v.id, acc_amex, txn_date + INTERVAL '4 day', 'posted', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'ClickUp';
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 2400, 'Software / SaaS', 'OpenAI API', 'OpenAI', v.id, acc_amex, txn_date + INTERVAL '6 day', 'posted', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'OpenAI';
    -- CFE
    INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, vendor_id, account_id, transaction_date, status, source, currency)
      SELECT org, 'expense', 2200, 'Servicios', 'CFE — luz oficina', 'CFE', v.id, acc_bbva, txn_date + INTERVAL '9 day', 'reconciled', 'seed', 'MXN'
      FROM finance.vendors v WHERE v.organization_id = org AND v.name = 'CFE';
  END LOOP;

  -- A couple of one-off project incomes + setup fees
  INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, client_id, account_id, transaction_date, status, source, currency)
    SELECT org, 'income', 45000, 'Proyectos', 'Rediseño web + branding', 'Booye Hotel', c.id, acc_bbva, DATE '2026-05-20' + INTERVAL '11 hour', 'reconciled', 'seed', 'MXN'
    FROM finance.clients c WHERE c.organization_id = org AND c.name = 'Booye Hotel';
  INSERT INTO finance.transactions (organization_id, type, amount, category, description, entity, client_id, account_id, transaction_date, status, source, currency)
    SELECT org, 'income', 12000, 'Setup Fees', 'Onboarding + setup CRM', 'La Michoacana', c.id, acc_bbva, DATE '2026-06-08' + INTERVAL '11 hour', 'reconciled', 'seed', 'MXN'
    FROM finance.clients c WHERE c.organization_id = org AND c.name = 'La Michoacana';

  -- ---- Invoices (CFDI recibidas/emitidas mix) ----
  INSERT INTO finance.invoices (organization_id, uuid_sat, emitter, receiver, total, status, invoice_date, paid_at, payment_method) VALUES
    (org, 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d61', '642 STUDIO', 'RIVI GRAND HOTEL SA DE CV', 29000.00, 'paid', DATE '2026-07-03', DATE '2026-07-08', 'PUE'),
    (org, 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d62', '642 STUDIO', 'HOTEL EL RETIRO SA DE CV', 17400.00, 'paid', DATE '2026-07-03', DATE '2026-07-10', 'PUE'),
    (org, 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d63', '642 STUDIO', 'ROOFTOP HOLIDAY INN SA DE CV', 13920.00, 'pending', DATE '2026-07-03', NULL, 'PPD'),
    (org, 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d64', 'META PLATFORMS IRELAND LTD', '642 STUDIO', 48720.00, 'paid', DATE '2026-07-02', DATE '2026-07-02', 'PUE'),
    (org, 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d65', 'GOOGLE MEXICO SA DE CV', '642 STUDIO', 24940.00, 'pending', DATE '2026-07-02', NULL, 'PUE');

END $$;
