/**
 * Downloadable planning workbook template. The sheets and headers here match
 * EXACTLY what planningXlsxParserService expects, with example rows the user
 * can overwrite and re-upload as-is — download → fill → import round-trip.
 */

const XLSX = require('xlsx');

function buildPlanningTemplate() {
  const wb = XLSX.utils.book_new();

  const planConfig = XLSX.utils.aoa_to_sheet([
    ['Plan Name', 'Start Year', 'End Year', 'Tax Rate (%)', 'Inflation (%)'],
    ['Mi Plan Financiero', new Date().getFullYear(), new Date().getFullYear() + 2, 30, 4],
  ]);

  const products = XLSX.utils.aoa_to_sheet([
    ['Product Name', 'Category', 'Base Monthly Units', 'Price', 'Growth (% annual)', 'COGS (%)', 'Active'],
    ['Servicio CRM Pro', 'Suscripciones', 20, 1500, 20, 25, 'TRUE'],
    ['Implementación', 'Servicios', 4, 12000, 10, 40, 'TRUE'],
    ['Soporte premium', 'Servicios', 10, 800, 15, 20, 'TRUE'],
  ]);

  const fixedCosts = XLSX.utils.aoa_to_sheet([
    ['Cost Name', 'Category', 'Monthly Amount', 'Growth (% annual)', 'Active'],
    ['Renta oficina', 'Instalaciones', 18000, 5, 'TRUE'],
    ['Nómina administrativa', 'Personal', 85000, 8, 'TRUE'],
    ['Software y licencias', 'Tecnología', 6500, 3, 'TRUE'],
  ]);

  const variables = XLSX.utils.aoa_to_sheet([
    ['Variable Name', 'Type', 'Value', 'Applies To'],
    ['ACCOUNTS_RECEIVABLE', 'fixed', 30, 'Días de cobro a clientes'],
    ['ACCOUNTS_PAYABLE', 'fixed', 15, 'Días de pago a proveedores'],
    ['DISCOUNT_RATE', 'percentage', 12, 'Tasa de descuento anual'],
    ['INVENTORY', 'fixed', 0, 'Inventario promedio'],
  ]);

  XLSX.utils.book_append_sheet(wb, planConfig, 'PLAN_CONFIG');
  XLSX.utils.book_append_sheet(wb, products, 'PRODUCTS_INPUT');
  XLSX.utils.book_append_sheet(wb, fixedCosts, 'FIXED_COSTS_INPUT');
  XLSX.utils.book_append_sheet(wb, variables, 'VARIABLES_INPUT');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildPlanningTemplate };
