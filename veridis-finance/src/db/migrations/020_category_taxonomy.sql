-- 020_category_taxonomy.sql
-- Unifica la taxonomía de categorías a español canónico (ver
-- src/services/categoryTaxonomy.js). Idempotente: solo toca filas cuya categoría
-- aún no es canónica. NO cambia el tipo (income/expense) ni los montos, así que
-- los totales de flujo se preservan; solo se corrige la ETIQUETA.
--
-- Regla clave: nada se convierte en 'Traspaso interno' automáticamente. El hoyo
-- negro 'transfer'-gasto (mezcla de nómina, créditos, retiros y proveedores) va
-- a 'Por revisar' para que la re-categorización con IA lo resuelva después.

UPDATE finance.transactions AS t
SET category = m.canonical
FROM (
  SELECT
    x.id,
    CASE
      WHEN x.type = 'income' THEN
        CASE lower(coalesce(nullif(trim(x.category), ''), 'other'))
          WHEN 'sales' THEN 'Ventas y servicios'
          WHEN 'services' THEN 'Ventas y servicios'
          WHEN 'operations' THEN 'Otros ingresos'
          WHEN 'payroll' THEN 'Ventas y servicios'
          WHEN 'marketing' THEN 'Ventas y servicios'
          WHEN 'suppliers' THEN 'Ventas y servicios'
          WHEN 'rent' THEN 'Ventas y servicios'
          WHEN 'taxes' THEN 'Otros ingresos'
          WHEN 'bank_fees' THEN 'Reembolsos'
          WHEN 'transfer' THEN 'Ventas y servicios'
          WHEN 'other' THEN 'Otros ingresos'
          WHEN 'nómina' THEN 'Ventas y servicios'
          WHEN 'nomina' THEN 'Ventas y servicios'
          WHEN 'renta' THEN 'Ventas y servicios'
          WHEN 'proveedores' THEN 'Ventas y servicios'
          WHEN 'software y suscripciones' THEN 'Otros ingresos'
          WHEN 'publicidad' THEN 'Ventas y servicios'
          WHEN 'comisiones bancarias' THEN 'Reembolsos'
          WHEN 'comisiones sobre ventas' THEN 'Ventas y servicios'
          WHEN 'servicios' THEN 'Ventas y servicios'
          WHEN 'ingresos por servicios' THEN 'Ventas y servicios'
          WHEN 'impuestos' THEN 'Otros ingresos'
          WHEN 'pago de créditos' THEN 'Otros ingresos'
          WHEN 'retiros de socio' THEN 'Otros ingresos'
          WHEN 'traspaso interno' THEN 'Traspaso interno'
          WHEN 'por revisar' THEN 'Por revisar'
          ELSE 'Por revisar'
        END
      ELSE
        CASE lower(coalesce(nullif(trim(x.category), ''), 'other'))
          WHEN 'sales' THEN 'Proveedores'
          WHEN 'services' THEN 'Servicios'
          WHEN 'operations' THEN 'Servicios'
          WHEN 'payroll' THEN 'Nómina y freelancers'
          WHEN 'marketing' THEN 'Publicidad'
          WHEN 'suppliers' THEN 'Proveedores'
          WHEN 'rent' THEN 'Renta'
          WHEN 'taxes' THEN 'Impuestos'
          WHEN 'bank_fees' THEN 'Comisiones bancarias'
          WHEN 'transfer' THEN 'Por revisar'
          WHEN 'other' THEN 'Por revisar'
          WHEN 'nómina' THEN 'Nómina y freelancers'
          WHEN 'nomina' THEN 'Nómina y freelancers'
          WHEN 'renta' THEN 'Renta'
          WHEN 'proveedores' THEN 'Proveedores'
          WHEN 'software y suscripciones' THEN 'Software y suscripciones'
          WHEN 'publicidad' THEN 'Publicidad'
          WHEN 'comisiones bancarias' THEN 'Comisiones bancarias'
          WHEN 'comisiones sobre ventas' THEN 'Comisiones sobre ventas'
          WHEN 'servicios' THEN 'Servicios'
          WHEN 'ingresos por servicios' THEN 'Servicios'
          WHEN 'impuestos' THEN 'Impuestos'
          WHEN 'pago de créditos' THEN 'Pago de créditos'
          WHEN 'retiros de socio' THEN 'Retiros de socio'
          WHEN 'traspaso interno' THEN 'Traspaso interno'
          WHEN 'por revisar' THEN 'Por revisar'
          ELSE 'Por revisar'
        END
    END AS canonical
  FROM finance.transactions x
  WHERE x.deleted_at IS NULL
) AS m
WHERE t.id = m.id
  AND t.category IS DISTINCT FROM m.canonical;
