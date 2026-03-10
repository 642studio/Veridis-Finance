const pool = require('../db/pool');

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function trimOrNull(value, maxLength) {
  const trimmed = String(value || '').trim().slice(0, maxLength);
  return trimmed.length ? trimmed : null;
}

function mapCategory(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapSubcategory(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    category_id: row.category_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
    category_name: row.category_name || null,
  };
}

function normalizeCategoryPayload(payload) {
  return {
    name: String(payload.name || '').trim().slice(0, 120),
    icon: trimOrNull(payload.icon, 80),
    color: trimOrNull(payload.color, 40),
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
}

function normalizeSubcategoryPayload(payload) {
  return {
    name: String(payload.name || '').trim().slice(0, 120),
    icon: trimOrNull(payload.icon, 80),
    color: trimOrNull(payload.color, 40),
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
}

async function createCategory(payload) {
  const normalized = normalizeCategoryPayload(payload);

  const query = {
    text: `
      INSERT INTO finance.categories (
        organization_id,
        name,
        icon,
        color,
        active
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        organization_id,
        name,
        icon,
        color,
        active,
        created_at,
        updated_at
    `,
    values: [
      payload.organization_id,
      normalized.name,
      normalized.icon,
      normalized.color,
      normalized.active,
    ],
  };

  const { rows } = await pool.query(query);
  return mapCategory(rows[0]);
}

async function listCategories({ organization_id, active }) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];

  if (typeof active === 'boolean') {
    values.push(active);
    conditions.push(`active = $${values.length}`);
  }

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        icon,
        color,
        active,
        created_at,
        updated_at
      FROM finance.categories
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(name) ASC, created_at DESC
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapCategory);
}

async function getCategoryById({ organization_id, category_id }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        icon,
        color,
        active,
        created_at,
        updated_at
      FROM finance.categories
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, category_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Category not found: ${category_id}`);
  }

  return mapCategory(rows[0]);
}

async function updateCategory({ organization_id, category_id, patch }) {
  const values = [organization_id, category_id];
  const assignments = [];

  const normalized = {
    name:
      patch.name === undefined
        ? undefined
        : String(patch.name || '').trim().slice(0, 120),
    icon: patch.icon === undefined ? undefined : trimOrNull(patch.icon, 80),
    color: patch.color === undefined ? undefined : trimOrNull(patch.color, 40),
    active: patch.active === undefined ? undefined : Boolean(patch.active),
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      continue;
    }

    values.push(value);
    assignments.push(`${key} = $${values.length}`);
  }

  if (!assignments.length) {
    return getCategoryById({ organization_id, category_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.categories
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        name,
        icon,
        color,
        active,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Category not found: ${category_id}`);
  }

  return mapCategory(rows[0]);
}

async function softDeleteCategory({ organization_id, category_id }) {
  return updateCategory({
    organization_id,
    category_id,
    patch: {
      active: false,
    },
  });
}

async function createSubcategory(payload) {
  const normalized = normalizeSubcategoryPayload(payload);

  await assertCategoryExists({
    organization_id: payload.organization_id,
    category_id: payload.category_id,
    activeOnly: false,
  });

  const query = {
    text: `
      INSERT INTO finance.subcategories (
        organization_id,
        category_id,
        name,
        icon,
        color,
        active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        organization_id,
        category_id,
        name,
        icon,
        color,
        active,
        created_at,
        updated_at
    `,
    values: [
      payload.organization_id,
      payload.category_id,
      normalized.name,
      normalized.icon,
      normalized.color,
      normalized.active,
    ],
  };

  const { rows } = await pool.query(query);
  return mapSubcategory(rows[0]);
}

async function listSubcategories({ organization_id, category_id, active }) {
  const values = [organization_id];
  const conditions = ['s.organization_id = $1'];

  if (category_id) {
    values.push(category_id);
    conditions.push(`s.category_id = $${values.length}`);
  }

  if (typeof active === 'boolean') {
    values.push(active);
    conditions.push(`s.active = $${values.length}`);
  }

  const query = {
    text: `
      SELECT
        s.id,
        s.organization_id,
        s.category_id,
        s.name,
        s.icon,
        s.color,
        s.active,
        s.created_at,
        s.updated_at,
        c.name AS category_name
      FROM finance.subcategories s
      JOIN finance.categories c
        ON c.id = s.category_id
       AND c.organization_id = s.organization_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(c.name) ASC, lower(s.name) ASC, s.created_at DESC
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapSubcategory);
}

async function getSubcategoryById({ organization_id, subcategory_id }) {
  const query = {
    text: `
      SELECT
        s.id,
        s.organization_id,
        s.category_id,
        s.name,
        s.icon,
        s.color,
        s.active,
        s.created_at,
        s.updated_at,
        c.name AS category_name
      FROM finance.subcategories s
      JOIN finance.categories c
        ON c.id = s.category_id
       AND c.organization_id = s.organization_id
      WHERE s.organization_id = $1
        AND s.id = $2
      LIMIT 1
    `,
    values: [organization_id, subcategory_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Subcategory not found: ${subcategory_id}`);
  }

  return mapSubcategory(rows[0]);
}

async function updateSubcategory({ organization_id, subcategory_id, patch }) {
  const values = [organization_id, subcategory_id];
  const assignments = [];

  if (patch.category_id !== undefined) {
    await assertCategoryExists({
      organization_id,
      category_id: patch.category_id,
      activeOnly: false,
    });
  }

  const normalized = {
    category_id: patch.category_id,
    name:
      patch.name === undefined
        ? undefined
        : String(patch.name || '').trim().slice(0, 120),
    icon: patch.icon === undefined ? undefined : trimOrNull(patch.icon, 80),
    color: patch.color === undefined ? undefined : trimOrNull(patch.color, 40),
    active: patch.active === undefined ? undefined : Boolean(patch.active),
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      continue;
    }

    values.push(value);
    assignments.push(`${key} = $${values.length}`);
  }

  if (!assignments.length) {
    return getSubcategoryById({ organization_id, subcategory_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.subcategories
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        category_id,
        name,
        icon,
        color,
        active,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Subcategory not found: ${subcategory_id}`);
  }

  return mapSubcategory(rows[0]);
}

async function softDeleteSubcategory({ organization_id, subcategory_id }) {
  return updateSubcategory({
    organization_id,
    subcategory_id,
    patch: {
      active: false,
    },
  });
}

async function assertCategoryExists({ organization_id, category_id, activeOnly = true }) {
  if (!category_id) {
    return null;
  }

  const values = [organization_id, category_id];
  let activeFilter = '';
  if (activeOnly) {
    values.push(true);
    activeFilter = `AND active = $${values.length}`;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.categories
      WHERE organization_id = $1
        AND id = $2
        ${activeFilter}
      LIMIT 1
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Category not found${activeOnly ? ' or inactive' : ''}: ${category_id}`);
  }

  return rows[0];
}

async function assertSubcategoryExists({
  organization_id,
  subcategory_id,
  activeOnly = true,
}) {
  if (!subcategory_id) {
    return null;
  }

  const values = [organization_id, subcategory_id];
  let activeFilter = '';
  if (activeOnly) {
    values.push(true);
    activeFilter = `AND s.active = $${values.length}`;
  }

  const query = {
    text: `
      SELECT
        s.id,
        s.category_id
      FROM finance.subcategories s
      WHERE s.organization_id = $1
        AND s.id = $2
        ${activeFilter}
      LIMIT 1
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(
      `Subcategory not found${activeOnly ? ' or inactive' : ''}: ${subcategory_id}`
    );
  }

  return rows[0];
}

async function assertSubcategoryBelongsToCategory({
  organization_id,
  subcategory_id,
  category_id,
}) {
  if (!subcategory_id || !category_id) {
    return null;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.subcategories
      WHERE organization_id = $1
        AND id = $2
        AND category_id = $3
      LIMIT 1
    `,
    values: [organization_id, subcategory_id, category_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(
      `Subcategory ${subcategory_id} does not belong to category ${category_id}`
    );
  }

  return rows[0];
}

module.exports = {
  createCategory,
  listCategories,
  getCategoryById,
  updateCategory,
  softDeleteCategory,
  createSubcategory,
  listSubcategories,
  getSubcategoryById,
  updateSubcategory,
  softDeleteSubcategory,
  assertCategoryExists,
  assertSubcategoryExists,
  assertSubcategoryBelongsToCategory,
};
