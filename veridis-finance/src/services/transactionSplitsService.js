const pool = require('../db/pool');
const {
  assertCategoryExists,
  assertSubcategoryExists,
  assertSubcategoryBelongsToCategory,
} = require('./categoriesService');

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function mapSplit(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    transaction_id: row.transaction_id,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    amount: Number(row.amount),
    created_at: row.created_at,
    updated_at: row.updated_at,
    category_name: row.category_name || null,
    subcategory_name: row.subcategory_name || null,
  };
}

async function getScopedTransaction({ organization_id, transaction_id, client }) {
  const db = client || pool;

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        amount,
        deleted_at
      FROM finance.transactions
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, transaction_id],
  };

  const { rows } = await db.query(query);
  const transaction = rows[0];
  if (!transaction || transaction.deleted_at) {
    throw notFound(`Transaction not found: ${transaction_id}`);
  }

  return {
    id: transaction.id,
    amount: Number(transaction.amount),
  };
}

async function getSplitById({ organization_id, split_id, client }) {
  const db = client || pool;

  const query = {
    text: `
      SELECT
        ts.id,
        ts.organization_id,
        ts.transaction_id,
        ts.category_id,
        ts.subcategory_id,
        ts.amount,
        ts.created_at,
        ts.updated_at,
        c.name AS category_name,
        s.name AS subcategory_name
      FROM finance.transaction_splits ts
      JOIN finance.categories c
        ON c.id = ts.category_id
       AND c.organization_id = ts.organization_id
      LEFT JOIN finance.subcategories s
        ON s.id = ts.subcategory_id
       AND s.organization_id = ts.organization_id
      WHERE ts.organization_id = $1
        AND ts.id = $2
      LIMIT 1
    `,
    values: [organization_id, split_id],
  };

  const { rows } = await db.query(query);
  if (!rows[0]) {
    throw notFound(`Transaction split not found: ${split_id}`);
  }

  return mapSplit(rows[0]);
}

async function listSplitsByTransaction({ organization_id, transaction_id }) {
  await getScopedTransaction({ organization_id, transaction_id });

  const query = {
    text: `
      SELECT
        ts.id,
        ts.organization_id,
        ts.transaction_id,
        ts.category_id,
        ts.subcategory_id,
        ts.amount,
        ts.created_at,
        ts.updated_at,
        c.name AS category_name,
        s.name AS subcategory_name
      FROM finance.transaction_splits ts
      JOIN finance.categories c
        ON c.id = ts.category_id
       AND c.organization_id = ts.organization_id
      LEFT JOIN finance.subcategories s
        ON s.id = ts.subcategory_id
       AND s.organization_id = ts.organization_id
      WHERE ts.organization_id = $1
        AND ts.transaction_id = $2
      ORDER BY ts.created_at ASC, ts.id ASC
    `,
    values: [organization_id, transaction_id],
  };

  const { rows } = await pool.query(query);
  return rows.map(mapSplit);
}

async function totalSplitAmount({
  organization_id,
  transaction_id,
  exclude_split_id,
  client,
}) {
  const db = client || pool;
  const values = [organization_id, transaction_id];
  let exclusion = '';

  if (exclude_split_id) {
    values.push(exclude_split_id);
    exclusion = `AND id <> $${values.length}`;
  }

  const query = {
    text: `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM finance.transaction_splits
      WHERE organization_id = $1
        AND transaction_id = $2
        ${exclusion}
    `,
    values,
  };

  const { rows } = await db.query(query);
  return Number(rows[0]?.total || 0);
}

async function ensureSplitCapacity({
  organization_id,
  transaction_id,
  next_amount,
  exclude_split_id,
  client,
}) {
  const db = client || pool;
  const transaction = await getScopedTransaction({
    organization_id,
    transaction_id,
    client: db,
  });
  const assigned = await totalSplitAmount({
    organization_id,
    transaction_id,
    exclude_split_id,
    client: db,
  });

  const capacity = Number(transaction.amount) - Number(assigned);
  if (next_amount - capacity > 0.009) {
    throw conflict(
      `Split amount exceeds transaction amount. Remaining capacity: ${capacity.toFixed(2)}`
    );
  }
}

async function createSplit(payload) {
  const amount = toAmount(payload.amount);
  if (!amount) {
    throw conflict('Split amount must be greater than 0');
  }

  await assertCategoryExists({
    organization_id: payload.organization_id,
    category_id: payload.category_id,
  });

  if (payload.subcategory_id) {
    await assertSubcategoryExists({
      organization_id: payload.organization_id,
      subcategory_id: payload.subcategory_id,
    });
    await assertSubcategoryBelongsToCategory({
      organization_id: payload.organization_id,
      subcategory_id: payload.subcategory_id,
      category_id: payload.category_id,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureSplitCapacity({
      organization_id: payload.organization_id,
      transaction_id: payload.transaction_id,
      next_amount: amount,
      client,
    });

    const query = {
      text: `
        INSERT INTO finance.transaction_splits (
          organization_id,
          transaction_id,
          category_id,
          subcategory_id,
          amount
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          organization_id,
          transaction_id,
          category_id,
          subcategory_id,
          amount,
          created_at,
          updated_at
      `,
      values: [
        payload.organization_id,
        payload.transaction_id,
        payload.category_id,
        payload.subcategory_id || null,
        amount,
      ],
    };

    const { rows } = await client.query(query);
    await client.query('COMMIT');

    return getSplitById({
      organization_id: payload.organization_id,
      split_id: rows[0].id,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateSplit({ organization_id, split_id, patch }) {
  const current = await getSplitById({ organization_id, split_id });
  const nextCategoryId = patch.category_id || current.category_id;
  const nextSubcategoryId =
    patch.subcategory_id === undefined ? current.subcategory_id : patch.subcategory_id;
  const nextAmount = patch.amount === undefined ? current.amount : toAmount(patch.amount);

  if (!nextAmount) {
    throw conflict('Split amount must be greater than 0');
  }

  await assertCategoryExists({
    organization_id,
    category_id: nextCategoryId,
  });

  if (nextSubcategoryId) {
    await assertSubcategoryExists({
      organization_id,
      subcategory_id: nextSubcategoryId,
    });
    await assertSubcategoryBelongsToCategory({
      organization_id,
      subcategory_id: nextSubcategoryId,
      category_id: nextCategoryId,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await ensureSplitCapacity({
      organization_id,
      transaction_id: current.transaction_id,
      next_amount: nextAmount,
      exclude_split_id: split_id,
      client,
    });

    const query = {
      text: `
        UPDATE finance.transaction_splits
        SET
          category_id = $3,
          subcategory_id = $4,
          amount = $5,
          updated_at = now()
        WHERE organization_id = $1
          AND id = $2
        RETURNING id
      `,
      values: [
        organization_id,
        split_id,
        nextCategoryId,
        nextSubcategoryId || null,
        nextAmount,
      ],
    };

    const { rows } = await client.query(query);
    if (!rows[0]) {
      throw notFound(`Transaction split not found: ${split_id}`);
    }

    await client.query('COMMIT');
    return getSplitById({ organization_id, split_id });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteSplit({ organization_id, split_id }) {
  const query = {
    text: `
      DELETE FROM finance.transaction_splits
      WHERE organization_id = $1
        AND id = $2
      RETURNING id
    `,
    values: [organization_id, split_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Transaction split not found: ${split_id}`);
  }

  return {
    id: rows[0].id,
    deleted: true,
  };
}

module.exports = {
  listSplitsByTransaction,
  createSplit,
  updateSplit,
  deleteSplit,
  getSplitById,
};
