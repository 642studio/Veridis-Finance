/**
 * Taxonomía canónica de categorías (una sola fuente de verdad).
 *
 * El sistema arrastraba DOS taxonomías revueltas: la vieja en inglés del
 * clasificador (`transfer`, `suppliers`, `payroll`…) y la nueva en español
 * (`Nómina`, `Renta`…). El mismo gasto caía en dos buckets y casi la mitad del
 * dinero quedaba escondido en `transfer`. Este módulo define el catálogo cerrado
 * en español y el mapeo determinista desde cualquier valor heredado.
 *
 * Reglas de oro:
 * - Cambiar la ETIQUETA de un movimiento NUNCA cambia los totales de flujo.
 * - SOLO "Traspaso interno" se excluye de ingresos/gastos (dinero entre cuentas
 *   propias). Nada se mapea a "Traspaso interno" de forma automática: un SPEI
 *   recibido casi siempre es un cliente pagando, no un traspaso.
 * - Lo ambiguo (el hoyo negro `transfer`-gasto, `other`, sin categoría) cae en
 *   "Por revisar" para que la re-categorización con IA (S31) lo resuelva.
 */

// Categorías de INGRESO.
const INCOME_CATEGORIES = [
  'Ventas y servicios',
  'Reembolsos',
  'Otros ingresos',
];

// Categorías de EGRESO.
const EXPENSE_CATEGORIES = [
  'Nómina y freelancers',
  'Renta',
  'Proveedores',
  'Software y suscripciones',
  'Publicidad',
  'Comisiones bancarias',
  'Comisiones sobre ventas',
  'Servicios',
  'Impuestos',
  'Pago de créditos',
  'Retiros de socio',
];

// Neutral: ni ingreso ni gasto. Se excluye de todos los totales de flujo.
const NEUTRAL_CATEGORIES = ['Traspaso interno'];

// Cajón para lo que aún no se clasifica con confianza.
const REVIEW_CATEGORY = 'Por revisar';

const ALL_CATEGORIES = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  ...NEUTRAL_CATEGORIES,
  REVIEW_CATEGORY,
];

const CANONICAL_SET = new Set(ALL_CATEGORIES);

/**
 * Mapeo determinista de categorías heredadas → canónicas. La clave es el valor
 * heredado en minúsculas; el valor es {income, expense} porque algunas cambian
 * según el signo (p. ej. un abono etiquetado "marketing" es un CLIENTE pagándote
 * marketing = Ventas y servicios; un cargo "marketing" es Publicidad).
 */
const LEGACY_MAP = {
  // Inglés (clasificador viejo)
  sales: { income: 'Ventas y servicios', expense: 'Proveedores' },
  services: { income: 'Ventas y servicios', expense: 'Servicios' },
  operations: { income: 'Otros ingresos', expense: 'Servicios' },
  payroll: { income: 'Ventas y servicios', expense: 'Nómina y freelancers' },
  marketing: { income: 'Ventas y servicios', expense: 'Publicidad' },
  suppliers: { income: 'Ventas y servicios', expense: 'Proveedores' },
  rent: { income: 'Ventas y servicios', expense: 'Renta' },
  taxes: { income: 'Otros ingresos', expense: 'Impuestos' },
  bank_fees: { income: 'Reembolsos', expense: 'Comisiones bancarias' },
  transfer: { income: 'Ventas y servicios', expense: REVIEW_CATEGORY },
  other: { income: 'Otros ingresos', expense: REVIEW_CATEGORY },

  // Español (parser / catálogo nuevo) — se normalizan a la forma canónica.
  'nómina': { income: 'Ventas y servicios', expense: 'Nómina y freelancers' },
  'nomina': { income: 'Ventas y servicios', expense: 'Nómina y freelancers' },
  'renta': { income: 'Ventas y servicios', expense: 'Renta' },
  'proveedores': { income: 'Ventas y servicios', expense: 'Proveedores' },
  'software y suscripciones': { income: 'Otros ingresos', expense: 'Software y suscripciones' },
  'publicidad': { income: 'Ventas y servicios', expense: 'Publicidad' },
  'comisiones bancarias': { income: 'Reembolsos', expense: 'Comisiones bancarias' },
  'comisiones sobre ventas': { income: 'Ventas y servicios', expense: 'Comisiones sobre ventas' },
  'servicios': { income: 'Ventas y servicios', expense: 'Servicios' },
  'ingresos por servicios': { income: 'Ventas y servicios', expense: 'Servicios' },
  'impuestos': { income: 'Otros ingresos', expense: 'Impuestos' },
  'pago de créditos': { income: 'Otros ingresos', expense: 'Pago de créditos' },
  'retiros de socio': { income: 'Otros ingresos', expense: 'Retiros de socio' },
  'traspaso interno': { income: 'Traspaso interno', expense: 'Traspaso interno' },
  'por revisar': { income: REVIEW_CATEGORY, expense: REVIEW_CATEGORY },
};

/**
 * Traduce cualquier categoría (heredada o ya canónica) a la forma canónica.
 * `type` es 'income' | 'expense'; si no se da, asume 'expense' (el caso frecuente).
 */
function mapLegacyCategory(category, type) {
  const t = type === 'income' ? 'income' : 'expense';
  const raw = String(category || '').trim();
  if (!raw) return REVIEW_CATEGORY;
  if (CANONICAL_SET.has(raw)) return raw; // ya es canónica
  const entry = LEGACY_MAP[raw.toLowerCase()];
  if (entry) return entry[t];
  return REVIEW_CATEGORY;
}

function isCanonical(category) {
  return CANONICAL_SET.has(String(category || '').trim());
}

/** Categorías válidas para un tipo dado (para poblar selects en la UI). */
function categoriesForType(type) {
  const base = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return [...base, ...NEUTRAL_CATEGORIES, REVIEW_CATEGORY];
}

module.exports = {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  NEUTRAL_CATEGORIES,
  REVIEW_CATEGORY,
  ALL_CATEGORIES,
  LEGACY_MAP,
  mapLegacyCategory,
  isCanonical,
  categoriesForType,
};
