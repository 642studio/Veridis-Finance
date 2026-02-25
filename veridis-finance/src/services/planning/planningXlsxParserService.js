const XLSX = require('xlsx');

const REQUIRED_SHEETS = Object.freeze([
  'PLAN_CONFIG',
  'PRODUCTS_INPUT',
  'FIXED_COSTS_INPUT',
  'VARIABLES_INPUT',
]);

const LEGACY_REQUIRED_SHEETS = Object.freeze([
  'MODEL_INFO',
  'PRODUCT_MIX_INPUT',
  'FIXED_COSTS_INPUT',
]);

const MAX_VALIDATION_ERRORS = 200;
const TRUE_VALUES = new Set(['TRUE', '1', 'YES', 'Y', 'SI']);
const FALSE_VALUES = new Set(['FALSE', '0', 'NO', 'N']);
const ALLOWED_VARIABLE_KEYS = Object.freeze([
  'accounts_receivable',
  'accounts_payable',
  'discount_rate',
  'inventory',
]);

const VARIABLE_KEY_ALIASES = Object.freeze({
  ACCOUNTS_RECEIVABLE: 'accounts_receivable',
  AR: 'accounts_receivable',
  ACCOUNTS_PAYABLE: 'accounts_payable',
  AP: 'accounts_payable',
  DISCOUNT_RATE: 'discount_rate',
  INVENTORY: 'inventory',
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validationError(errors) {
  const error = badRequest('Planning workbook validation failed');
  error.code = 'PLANNING_IMPORT_VALIDATION';
  error.validation_errors = errors.slice(0, MAX_VALIDATION_ERRORS);
  return error;
}

function missingSheetError(sheetName) {
  const error = badRequest(`Missing required sheet: ${sheetName}`);
  error.code = 'PLANNING_MISSING_SHEET';
  error.missing_sheet = sheetName;
  return error;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSheetName(name) {
  return normalizeHeader(name);
}

function slugVariableName(value) {
  return normalizeHeader(value)
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseVariableKey(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(VARIABLE_KEY_ALIASES, normalized)) {
    return VARIABLE_KEY_ALIASES[normalized];
  }

  const slug = slugVariableName(value);
  return ALLOWED_VARIABLE_KEYS.includes(slug) ? slug : null;
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  let text = String(value).trim();
  if (!text) {
    return null;
  }

  const negative = /^\(.+\)$/.test(text);
  text = text.replace(/[()]/g, '');
  text = text.replace(/\$/g, '');
  text = text.replace(/,/g, '');
  text = text.replace(/%/g, '');
  text = text.replace(/\s+/g, '');

  if (!text || text === '-' || text === '--') {
    return null;
  }

  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return negative ? -parsed : parsed;
}

function parsePercentage(value, { allowFraction = true } = {}) {
  const parsed = parseNumber(value);

  if (parsed === null) {
    return null;
  }

  const rawText = typeof value === 'string' ? String(value) : '';
  const hasPercentSymbol = rawText.includes('%');

  if (allowFraction && !hasPercentSymbol && Math.abs(parsed) > 0 && Math.abs(parsed) < 1) {
    return parsed * 100;
  }

  return parsed;
}

function parseInteger(value) {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }

  const intValue = Number.parseInt(String(parsed), 10);
  return Number.isInteger(intValue) ? intValue : null;
}

function parseBoolean(value, defaultValue = true) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = normalizeText(value).toUpperCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return defaultValue;
}

function isRowEmpty(row) {
  return !row || row.every((cell) => String(cell || '').trim() === '');
}

function pushError(errors, entry) {
  if (errors.length < MAX_VALIDATION_ERRORS) {
    errors.push(entry);
  }
}

function toSheetMatrix(workbook, sheetName) {
  if (!sheetName || !workbook.Sheets[sheetName]) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });
}

function findColumnByAliases(headersNormalized, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));

  for (let index = 0; index < headersNormalized.length; index += 1) {
    const header = headersNormalized[index];
    if (!header) {
      continue;
    }

    for (const alias of normalizedAliases) {
      if (header === alias || header.includes(alias) || alias.includes(header)) {
        return index;
      }
    }
  }

  return -1;
}

function detectHeaderRow(matrix, aliasMap, requiredFields, maxRows = 120) {
  let best = null;

  for (let rowIndex = 0; rowIndex < Math.min(maxRows, matrix.length); rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const headersNormalized = row.map((cell) => normalizeHeader(cell));

    const columns = {};
    let score = 0;

    for (const field of Object.keys(aliasMap)) {
      const columnIndex = findColumnByAliases(headersNormalized, aliasMap[field]);
      columns[field] = columnIndex;
      if (columnIndex >= 0 && requiredFields.includes(field)) {
        score += 1;
      }
    }

    if (!best || score > best.score) {
      best = { rowIndex, score, columns };
    }

    if (score === requiredFields.length) {
      return best;
    }
  }

  return best;
}

function validatePlanConfig(planConfig, errors, sheetName) {
  const { start_year: startYear, end_year: endYear, tax_rate: taxRate, inflation } = planConfig;

  if (!Number.isInteger(startYear)) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_START_YEAR',
      sheet: sheetName,
      field: 'start_year',
      message: 'Start Year must be an integer.',
    });
  }

  if (!Number.isInteger(endYear)) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_END_YEAR',
      sheet: sheetName,
      field: 'end_year',
      message: 'End Year must be an integer.',
    });
  }

  if (Number.isInteger(startYear) && Number.isInteger(endYear) && endYear < startYear) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_YEAR_RANGE',
      sheet: sheetName,
      message: 'Start Year must be less than or equal to End Year.',
    });
  }

  if (
    Number.isInteger(startYear) &&
    Number.isInteger(endYear) &&
    endYear - startYear + 1 > 20
  ) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_MAX_RANGE',
      sheet: sheetName,
      message: 'Year range cannot exceed 20 years.',
    });
  }

  if (taxRate === null) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_TAX_RATE',
      sheet: sheetName,
      field: 'tax_rate',
      message: 'Tax Rate (%) must be numeric.',
    });
  }

  if (inflation === null) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_INFLATION',
      sheet: sheetName,
      field: 'inflation',
      message: 'Inflation (%) must be numeric.',
    });
  }
}

function buildPlanConfigResult({
  planName,
  startYear,
  endYear,
  taxRate,
  inflation,
}) {
  const years = [];
  if (Number.isInteger(startYear) && Number.isInteger(endYear) && endYear >= startYear) {
    for (let year = startYear; year <= endYear; year += 1) {
      years.push(year);
    }
  }

  return {
    plan_name: String(planName || 'Financial Plan').slice(0, 180),
    start_year: Number.isInteger(startYear) ? startYear : 0,
    end_year: Number.isInteger(endYear) ? endYear : 0,
    tax_rate: taxRate === null ? 0 : taxRate,
    inflation: inflation === null ? 0 : inflation,
    years,
  };
}

function parsePlanConfigSheet(matrix, errors, options) {
  const aliasMap = {
    plan_name: ['PLAN_NAME'],
    start_year: ['START_YEAR'],
    end_year: ['END_YEAR'],
    tax_rate: ['TAX_RATE', 'TAX_RATE_PERCENT'],
    inflation: ['INFLATION', 'INFLATION_PERCENT'],
  };

  const requiredFields = ['plan_name', 'start_year', 'end_year', 'tax_rate', 'inflation'];
  const header = detectHeaderRow(matrix, aliasMap, requiredFields, 40);

  if (!header || header.score < requiredFields.length) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_HEADERS',
      sheet: 'PLAN_CONFIG',
      message:
        'PLAN_CONFIG must include headers: Plan Name, Start Year, End Year, Tax Rate (%), Inflation (%).',
    });

    return buildPlanConfigResult({
      planName: 'Financial Plan',
      startYear: 0,
      endYear: 0,
      taxRate: 0,
      inflation: 0,
    });
  }

  let firstDataRow = null;
  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    if (!isRowEmpty(row)) {
      firstDataRow = row;
      break;
    }
  }

  if (!firstDataRow) {
    pushError(errors, {
      code: 'INVALID_PLAN_CONFIG_EMPTY',
      sheet: 'PLAN_CONFIG',
      message: 'PLAN_CONFIG requires at least one data row.',
    });

    return buildPlanConfigResult({
      planName: 'Financial Plan',
      startYear: 0,
      endYear: 0,
      taxRate: 0,
      inflation: 0,
    });
  }

  const planNameRaw = firstDataRow[header.columns.plan_name];
  const startYearRaw = firstDataRow[header.columns.start_year];
  const endYearRaw = firstDataRow[header.columns.end_year];
  const taxRateRaw = firstDataRow[header.columns.tax_rate];
  const inflationRaw = firstDataRow[header.columns.inflation];

  const planNameOverride =
    options.plan_name_override === undefined
      ? undefined
      : String(options.plan_name_override).trim();
  const startYearOverride =
    options.start_year_override === undefined
      ? undefined
      : parseInteger(options.start_year_override);
  const endYearOverride =
    options.end_year_override === undefined
      ? undefined
      : parseInteger(options.end_year_override);
  const taxRateOverride =
    options.tax_rate_override === undefined
      ? undefined
      : parsePercentage(options.tax_rate_override);
  const inflationOverride =
    options.inflation_override === undefined
      ? undefined
      : parsePercentage(options.inflation_override);

  const result = buildPlanConfigResult({
    planName:
      (planNameOverride && planNameOverride.length > 0
        ? planNameOverride
        : String(planNameRaw || '').trim()) || 'Financial Plan',
    startYear:
      startYearOverride !== undefined ? startYearOverride : parseInteger(startYearRaw),
    endYear: endYearOverride !== undefined ? endYearOverride : parseInteger(endYearRaw),
    taxRate: taxRateOverride !== undefined ? taxRateOverride : parsePercentage(taxRateRaw),
    inflation:
      inflationOverride !== undefined ? inflationOverride : parsePercentage(inflationRaw),
  });

  validatePlanConfig(result, errors, 'PLAN_CONFIG');
  return result;
}

function parseModelInfoSheet(matrix, errors, options) {
  const rows = matrix || [];
  const kv = new Map();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (isRowEmpty(row)) {
      continue;
    }

    const key = normalizeHeader(row[0]);
    const value = row[1];

    if (!key || key === 'FIELD' || key === 'KEY') {
      continue;
    }

    kv.set(key, value);
  }

  const planNameOverride =
    options.plan_name_override === undefined
      ? undefined
      : String(options.plan_name_override).trim();
  const startYearOverride =
    options.start_year_override === undefined
      ? undefined
      : parseInteger(options.start_year_override);
  const endYearOverride =
    options.end_year_override === undefined
      ? undefined
      : parseInteger(options.end_year_override);
  const taxRateOverride =
    options.tax_rate_override === undefined
      ? undefined
      : parsePercentage(options.tax_rate_override);
  const inflationOverride =
    options.inflation_override === undefined
      ? undefined
      : parsePercentage(options.inflation_override);

  const startYearFromSheet = parseInteger(
    kv.get('START_YEAR') || kv.get('INITIAL_YEAR') || kv.get('YEAR_START')
  );
  const endYearFromSheet = parseInteger(kv.get('END_YEAR') || kv.get('YEAR_END'));
  const horizonYears = parseInteger(
    kv.get('HORIZON_YEARS') || kv.get('YEARS') || kv.get('PROJECTION_YEARS')
  );

  let computedEndYear = endYearFromSheet;
  if (!Number.isInteger(computedEndYear) && Number.isInteger(startYearFromSheet) && Number.isInteger(horizonYears)) {
    computedEndYear = startYearFromSheet + horizonYears - 1;
  }

  const result = buildPlanConfigResult({
    planName:
      (planNameOverride && planNameOverride.length > 0
        ? planNameOverride
        : String(
            kv.get('PLAN_NAME') ||
              kv.get('MODEL_NAME') ||
              kv.get('COMPANY_NAME') ||
              'Financial Plan'
          ).trim()) || 'Financial Plan',
    startYear:
      startYearOverride !== undefined ? startYearOverride : startYearFromSheet,
    endYear: endYearOverride !== undefined ? endYearOverride : computedEndYear,
    taxRate:
      taxRateOverride !== undefined
        ? taxRateOverride
        : parsePercentage(kv.get('TAX_RATE') || kv.get('TAX_RATE_PERCENT')),
    inflation:
      inflationOverride !== undefined
        ? inflationOverride
        : parsePercentage(kv.get('INFLATION') || kv.get('INFLATION_PERCENT')),
  });

  validatePlanConfig(result, errors, 'MODEL_INFO');
  return result;
}

function parseProductsSheet(matrix, errors, sheetName = 'PRODUCTS_INPUT') {
  const aliasMap = {
    product_name: ['PRODUCT_NAME'],
    category: ['CATEGORY'],
    base_monthly_units: ['BASE_MONTHLY_UNITS', 'UNITS_MONTH_1', 'UNITS_MONTH1', 'UNITS'],
    price: ['PRICE', 'PRICE_MXN', 'UNIT_PRICE'],
    growth_percent_annual: [
      'GROWTH_ANNUAL',
      'GROWTH_PERCENT_ANNUAL',
      'GROWTH_ANNUAL_PERCENT',
      'MONTHLY_GROWTH_PERCENT',
      'MONTHLY_GROWTH',
    ],
    cogs_percent: ['COGS', 'COGS_PERCENT', 'VARIABLE_COST_PERCENT', 'VARIABLE_COST'],
    active: ['ACTIVE', 'RECURRING', 'RECURRING_Y_N'],
  };

  const requiredFields = ['product_name', 'price'];
  const header = detectHeaderRow(matrix, aliasMap, requiredFields, 120);

  if (!header || header.score < requiredFields.length) {
    pushError(errors, {
      code: 'INVALID_PRODUCTS_INPUT_HEADERS',
      sheet: sheetName,
      message:
        'PRODUCTS_INPUT must include headers: Product Name, Category, Base Monthly Units, Price, Growth (% annual), COGS (%), Active.',
    });
    return [];
  }

  const headerRow = matrix[header.rowIndex] || [];
  const growthHeaderNormalized =
    header.columns.growth_percent_annual >= 0
      ? normalizeHeader(headerRow[header.columns.growth_percent_annual])
      : '';
  const activeHeaderNormalized =
    header.columns.active >= 0
      ? normalizeHeader(headerRow[header.columns.active])
      : '';

  const growthLooksMonthly = growthHeaderNormalized.includes('MONTHLY');
  const activeLooksRecurring = activeHeaderNormalized.includes('RECURRING');

  const rows = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    if (isRowEmpty(row)) {
      continue;
    }

    const productName = String(row[header.columns.product_name] || '').trim();
    const priceRaw = header.columns.price >= 0 ? row[header.columns.price] : null;

    if (!productName && (priceRaw === null || String(priceRaw).trim() === '')) {
      continue;
    }

    if (!productName) {
      pushError(errors, {
        code: 'INVALID_PRODUCT_NAME',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'product_name',
        message: 'Product Name is required.',
      });
      continue;
    }

    const price = parseNumber(priceRaw);
    if (price === null || price < 0) {
      pushError(errors, {
        code: 'INVALID_PRODUCT_PRICE',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'price',
        message: 'Price is required and must be numeric >= 0.',
      });
      continue;
    }

    const baseUnitsRaw =
      header.columns.base_monthly_units >= 0 ? row[header.columns.base_monthly_units] : null;
    const growthRaw =
      header.columns.growth_percent_annual >= 0 ? row[header.columns.growth_percent_annual] : null;
    const cogsRaw =
      header.columns.cogs_percent >= 0 ? row[header.columns.cogs_percent] : null;

    const baseUnits =
      baseUnitsRaw === null || String(baseUnitsRaw).trim() === ''
        ? 0
        : parseNumber(baseUnitsRaw);
    const growthRawPercent =
      growthRaw === null || String(growthRaw).trim() === ''
        ? 0
        : parsePercentage(growthRaw);
    const cogs =
      cogsRaw === null || String(cogsRaw).trim() === ''
        ? 0
        : parsePercentage(cogsRaw);

    if (baseUnits === null || baseUnits < 0) {
      pushError(errors, {
        code: 'INVALID_PRODUCT_BASE_MONTHLY_UNITS',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'base_monthly_units',
        message: 'Base Monthly Units must be numeric >= 0.',
      });
      continue;
    }

    if (growthRawPercent === null) {
      pushError(errors, {
        code: 'INVALID_PRODUCT_GROWTH',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'growth',
        message: 'Growth (% annual) must be numeric.',
      });
      continue;
    }

    if (cogs === null || cogs < 0) {
      pushError(errors, {
        code: 'INVALID_PRODUCT_COGS',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'cogs',
        message: 'COGS (%) must be numeric >= 0.',
      });
      continue;
    }

    const annualGrowthPercent = growthLooksMonthly
      ? (Math.pow(1 + Number(growthRawPercent) / 100, 12) - 1) * 100
      : Number(growthRawPercent);

    rows.push({
      product_name: productName.slice(0, 255),
      category:
        header.columns.category >= 0
          ? String(row[header.columns.category] || '').trim().slice(0, 120) || null
          : null,
      base_monthly_units: Number(baseUnits),
      price: Number(price),
      growth_percent_annual: Number(annualGrowthPercent),
      cogs_percent: Number(cogs),
      active:
        header.columns.active >= 0
          ? activeLooksRecurring
            ? true
            : parseBoolean(row[header.columns.active], true)
          : true,
    });
  }

  return rows;
}

function parseFixedCostsSheet(matrix, errors, sheetName = 'FIXED_COSTS_INPUT') {
  const aliasMap = {
    cost_name: ['COST_NAME'],
    category: ['CATEGORY'],
    monthly_amount: ['MONTHLY_AMOUNT', 'MONTHLY_AMOUNT_MXN'],
    growth_percent_annual: ['GROWTH_ANNUAL', 'GROWTH_PERCENT_ANNUAL', 'GROWTH_ANNUAL_PERCENT'],
    active: ['ACTIVE'],
  };

  const requiredFields = ['cost_name', 'monthly_amount'];
  const header = detectHeaderRow(matrix, aliasMap, requiredFields, 120);

  if (!header || header.score < requiredFields.length) {
    pushError(errors, {
      code: 'INVALID_FIXED_COSTS_INPUT_HEADERS',
      sheet: sheetName,
      message:
        'FIXED_COSTS_INPUT must include headers: Cost Name, Category, Monthly Amount, Growth (% annual), Active.',
    });
    return [];
  }

  const rows = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    if (isRowEmpty(row)) {
      continue;
    }

    const costName = String(row[header.columns.cost_name] || '').trim();
    const monthlyAmountRaw =
      header.columns.monthly_amount >= 0 ? row[header.columns.monthly_amount] : null;

    if (!costName && (monthlyAmountRaw === null || String(monthlyAmountRaw).trim() === '')) {
      continue;
    }

    if (!costName) {
      pushError(errors, {
        code: 'INVALID_FIXED_COST_NAME',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'cost_name',
        message: 'Cost Name is required.',
      });
      continue;
    }

    const monthlyAmount = parseNumber(monthlyAmountRaw);
    if (monthlyAmount === null || monthlyAmount < 0) {
      pushError(errors, {
        code: 'INVALID_FIXED_COST_MONTHLY_AMOUNT',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'monthly_amount',
        message: 'Monthly Amount must be numeric >= 0.',
      });
      continue;
    }

    const growthRaw =
      header.columns.growth_percent_annual >= 0
        ? row[header.columns.growth_percent_annual]
        : null;

    const growth =
      growthRaw === null || String(growthRaw).trim() === ''
        ? 0
        : parsePercentage(growthRaw);

    if (growth === null) {
      pushError(errors, {
        code: 'INVALID_FIXED_COST_GROWTH',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'growth',
        message: 'Growth (% annual) must be numeric.',
      });
      continue;
    }

    rows.push({
      cost_name: costName.slice(0, 255),
      category:
        header.columns.category >= 0
          ? String(row[header.columns.category] || '').trim().slice(0, 120) || null
          : null,
      monthly_amount: Number(monthlyAmount),
      growth_percent_annual: Number(growth),
      active:
        header.columns.active >= 0
          ? parseBoolean(row[header.columns.active], true)
          : true,
    });
  }

  return rows;
}

function parseVariablesSheet(matrix, errors, sheetName = 'VARIABLES_INPUT') {
  const aliasMap = {
    variable_name: ['VARIABLE_NAME'],
    type: ['TYPE'],
    value: ['VALUE'],
    applies_to: ['APPLIES_TO'],
  };

  const requiredFields = ['variable_name', 'type', 'value'];
  const header = detectHeaderRow(matrix, aliasMap, requiredFields, 120);

  if (!header || header.score < requiredFields.length) {
    pushError(errors, {
      code: 'INVALID_VARIABLES_INPUT_HEADERS',
      sheet: sheetName,
      message:
        'VARIABLES_INPUT must include headers: Variable Name, Type, Value, Applies To.',
    });
    return [];
  }

  const rows = [];
  const seenVariableKeys = new Set();

  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    if (isRowEmpty(row)) {
      continue;
    }

    const variableName = String(row[header.columns.variable_name] || '').trim();
    const variableKey = parseVariableKey(variableName);
    const typeRaw = String(row[header.columns.type] || '').trim().toLowerCase();
    const valueRaw = row[header.columns.value];

    if (!variableName && !typeRaw && (valueRaw === null || String(valueRaw).trim() === '')) {
      continue;
    }

    if (!variableName) {
      pushError(errors, {
        code: 'INVALID_VARIABLE_NAME',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'variable_name',
        message: 'Variable Name is required.',
      });
      continue;
    }

    if (!variableKey) {
      pushError(errors, {
        code: 'INVALID_VARIABLE_KEY',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'variable_name',
        message: `Variable key must be one of: ${ALLOWED_VARIABLE_KEYS.join(', ')}.`,
      });
      continue;
    }

    if (typeRaw !== 'percentage' && typeRaw !== 'fixed') {
      pushError(errors, {
        code: 'INVALID_VARIABLE_TYPE',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'type',
        message: 'Type must be "percentage" or "fixed".',
      });
      continue;
    }

    const value =
      typeRaw === 'percentage' ? parsePercentage(valueRaw) : parseNumber(valueRaw);

    if (value === null) {
      pushError(errors, {
        code: 'INVALID_VARIABLE_VALUE',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'value',
        message: 'Value must be numeric.',
      });
      continue;
    }

    const normalizedKey = variableKey;
    if (seenVariableKeys.has(normalizedKey)) {
      pushError(errors, {
        code: 'DUPLICATE_VARIABLE_NAME',
        sheet: sheetName,
        row: rowIndex + 1,
        field: 'variable_name',
        message: `Variable Name is duplicated: ${variableName}.`,
      });
      continue;
    }

    seenVariableKeys.add(normalizedKey);

    rows.push({
      variable_name: variableKey,
      variable_key: variableKey,
      type: typeRaw,
      value: Number(value),
      applies_to:
        header.columns.applies_to >= 0
          ? String(row[header.columns.applies_to] || '').trim().slice(0, 120) || 'global'
          : 'global',
    });
  }

  return rows;
}

function parseLegacyVariables(modelInfoMatrix, workingCapitalMatrix, errors) {
  const rows = [];
  const seen = new Set();

  function pushVariable(variableName, type, value, appliesTo = 'global') {
    const variableKey = parseVariableKey(variableName);

    if (!variableKey || value === null) {
      return;
    }

    const normalized = variableKey;
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    rows.push({
      variable_name: variableKey,
      variable_key: variableKey,
      type,
      value: Number(value),
      applies_to: String(appliesTo || 'global').slice(0, 120) || 'global',
    });
  }

  const kv = new Map();
  for (const row of modelInfoMatrix || []) {
    if (isRowEmpty(row)) {
      continue;
    }

    const key = normalizeHeader(row[0]);
    if (!key || key === 'FIELD' || key === 'KEY') {
      continue;
    }

    kv.set(key, row[1]);
  }

  pushVariable('discount_rate', 'percentage', parsePercentage(kv.get('DISCOUNT_RATE') || kv.get('DISCOUNT_RATE_PERCENT')));

  if (workingCapitalMatrix && workingCapitalMatrix.length > 0) {
    const aliasMap = {
      concept: ['CONCEPT'],
      value: ['PERCENT_OF_REVENUE', 'OF_REVENUE', 'VALUE'],
    };
    const requiredFields = ['concept', 'value'];
    const header = detectHeaderRow(workingCapitalMatrix, aliasMap, requiredFields, 30);

    if (header && header.score >= requiredFields.length) {
      for (let rowIndex = header.rowIndex + 1; rowIndex < workingCapitalMatrix.length; rowIndex += 1) {
        const row = workingCapitalMatrix[rowIndex] || [];
        if (isRowEmpty(row)) {
          continue;
        }

        const concept = String(row[header.columns.concept] || '').trim();
        const valueRaw = row[header.columns.value];

        if (!concept && (valueRaw === null || String(valueRaw).trim() === '')) {
          continue;
        }

        if (!concept) {
          pushError(errors, {
            code: 'INVALID_WORKING_CAPITAL_CONCEPT',
            sheet: 'WORKING_CAPITAL_INPUT',
            row: rowIndex + 1,
            field: 'concept',
            message: 'Concept is required.',
          });
          continue;
        }

        const value = parsePercentage(valueRaw);
        if (value === null) {
          pushError(errors, {
            code: 'INVALID_WORKING_CAPITAL_VALUE',
            sheet: 'WORKING_CAPITAL_INPUT',
            row: rowIndex + 1,
            field: 'value',
            message: 'Value must be numeric.',
          });
          continue;
        }

        pushVariable(slugVariableName(concept), 'percentage', value);
      }
    }
  }

  return rows;
}

function resolveSheetConfiguration(workbook) {
  const normalizedMap = new Map();

  for (const sheetName of workbook.SheetNames || []) {
    normalizedMap.set(normalizeSheetName(sheetName), sheetName);
  }

  const hasPrimary = REQUIRED_SHEETS.every((required) =>
    normalizedMap.has(normalizeSheetName(required))
  );

  if (hasPrimary) {
    const resolved = {};
    for (const required of REQUIRED_SHEETS) {
      resolved[required] = normalizedMap.get(normalizeSheetName(required));
    }

    return {
      template_variant: 'INPUT_BASED_V1',
      resolved_sheets: resolved,
    };
  }

  const hasLegacy = LEGACY_REQUIRED_SHEETS.every((required) =>
    normalizedMap.has(normalizeSheetName(required))
  );

  if (hasLegacy) {
    return {
      template_variant: 'MODEL_INFO_INPUT_V2',
      resolved_sheets: {
        PLAN_CONFIG: normalizedMap.get(normalizeSheetName('MODEL_INFO')),
        PRODUCTS_INPUT: normalizedMap.get(normalizeSheetName('PRODUCT_MIX_INPUT')),
        FIXED_COSTS_INPUT: normalizedMap.get(normalizeSheetName('FIXED_COSTS_INPUT')),
        VARIABLES_INPUT: normalizedMap.get(normalizeSheetName('WORKING_CAPITAL_INPUT')) || null,
        MODEL_INFO: normalizedMap.get(normalizeSheetName('MODEL_INFO')),
        WORKING_CAPITAL_INPUT:
          normalizedMap.get(normalizeSheetName('WORKING_CAPITAL_INPUT')) || null,
      },
    };
  }

  for (const required of REQUIRED_SHEETS) {
    if (!normalizedMap.has(normalizeSheetName(required))) {
      throw missingSheetError(required);
    }
  }

  throw missingSheetError(REQUIRED_SHEETS[0]);
}

function parsePlanningWorkbook(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw badRequest('XLSX file is required');
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      raw: false,
      cellDates: true,
    });
  } catch {
    throw badRequest('Unable to parse XLSX workbook');
  }

  const sheetConfig = resolveSheetConfiguration(workbook);
  const resolvedSheetNames = sheetConfig.resolved_sheets;

  const matrices = {
    PLAN_CONFIG: toSheetMatrix(workbook, resolvedSheetNames.PLAN_CONFIG),
    PRODUCTS_INPUT: toSheetMatrix(workbook, resolvedSheetNames.PRODUCTS_INPUT),
    FIXED_COSTS_INPUT: toSheetMatrix(workbook, resolvedSheetNames.FIXED_COSTS_INPUT),
    VARIABLES_INPUT: toSheetMatrix(workbook, resolvedSheetNames.VARIABLES_INPUT),
    MODEL_INFO: toSheetMatrix(workbook, resolvedSheetNames.MODEL_INFO),
    WORKING_CAPITAL_INPUT: toSheetMatrix(
      workbook,
      resolvedSheetNames.WORKING_CAPITAL_INPUT
    ),
  };

  const errors = [];

  const planConfig =
    sheetConfig.template_variant === 'MODEL_INFO_INPUT_V2'
      ? parseModelInfoSheet(matrices.MODEL_INFO, errors, options)
      : parsePlanConfigSheet(matrices.PLAN_CONFIG, errors, options);

  const products = parseProductsSheet(matrices.PRODUCTS_INPUT, errors, 'PRODUCTS_INPUT');
  const fixedCosts = parseFixedCostsSheet(
    matrices.FIXED_COSTS_INPUT,
    errors,
    'FIXED_COSTS_INPUT'
  );

  const variables =
    sheetConfig.template_variant === 'MODEL_INFO_INPUT_V2'
      ? parseLegacyVariables(
          matrices.MODEL_INFO,
          matrices.WORKING_CAPITAL_INPUT,
          errors
        )
      : parseVariablesSheet(matrices.VARIABLES_INPUT, errors, 'VARIABLES_INPUT');

  if (errors.length) {
    throw validationError(errors);
  }

  return {
    plan_config: planConfig,
    products,
    fixed_costs: fixedCosts,
    variables,
    snapshot: {
      template: 'VERIDIS_Input_Based_Template_642.xlsx',
      template_variant: sheetConfig.template_variant,
      imported_at: new Date().toISOString(),
      sheet_names: workbook.SheetNames,
      resolved_sheets: resolvedSheetNames,
      plan_config: planConfig,
      products,
      fixed_costs: fixedCosts,
      variables,
    },
  };
}

module.exports = {
  REQUIRED_SHEETS,
  parsePlanningWorkbook,
  badRequest,
};
