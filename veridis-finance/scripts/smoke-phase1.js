#!/usr/bin/env node

const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_TIMEOUT_MS || '15000',
  10
);

function randomSlug(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

async function parseJsonSafe(response) {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON response (${response.status}): ${raw.slice(0, 240)}`);
  }
}

async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    token,
    body,
    expectedStatus,
    label = `${method} ${path}`,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      accept: 'application/json',
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const init = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE_URL}${path}`, init);
    const json = await parseJsonSafe(response);

    if (expectedStatus && response.status !== expectedStatus) {
      throw new Error(
        `${label} expected ${expectedStatus}, got ${response.status}. Response: ${JSON.stringify(
          json
        )}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `${label} failed (${response.status}): ${JSON.stringify(json)}`
      );
    }

    return json;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const slug = randomSlug('smoke-org');
  const email = `${randomSlug('owner')}@example.com`;
  const password = process.env.SMOKE_TEST_PASSWORD || 'ChangeMe123!';

  console.log(`Running Phase 1 smoke test against ${API_BASE_URL}`);
  console.log(`Organization slug: ${slug}`);

  const registerPayload = {
    organization_name: `Smoke ${slug}`,
    organization_slug: slug,
    owner_name: 'Smoke Owner',
    owner_email: email,
    password,
    plan: 'free',
  };

  const registerResponse = await apiRequest('/auth/register', {
    method: 'POST',
    body: registerPayload,
    expectedStatus: 201,
    label: 'POST /auth/register',
  });

  const registerData = registerResponse?.data;
  if (!registerData?.token || !registerData?.organization?.organization_id) {
    throw new Error('Register response missing token or organization_id');
  }

  const token = registerData.token;
  const organizationId = registerData.organization.organization_id;

  const loginResponse = await apiRequest('/auth/login', {
    method: 'POST',
    body: {
      email,
      password,
      organization_slug: slug,
    },
    expectedStatus: 200,
    label: 'POST /auth/login',
  });

  if (!loginResponse?.data?.token) {
    throw new Error('Login response missing token');
  }

  const accountResponse = await apiRequest('/api/accounts', {
    method: 'POST',
    token,
    body: {
      name: 'Smoke Account',
      type: 'bank',
      currency: 'MXN',
      balance: 10000,
    },
    expectedStatus: 201,
    label: 'POST /api/accounts',
  });

  const accountId = accountResponse?.data?.id;
  if (!accountId) {
    throw new Error('Account creation did not return id');
  }

  const contactResponse = await apiRequest('/api/contacts', {
    method: 'POST',
    token,
    body: {
      type: 'customer',
      name: 'Smoke Customer',
      email: `customer-${slug}@example.com`,
      status: 'active',
    },
    expectedStatus: 201,
    label: 'POST /api/contacts',
  });

  const contactId = contactResponse?.data?.id;
  if (!contactId) {
    throw new Error('Contact creation did not return id');
  }

  const categoryResponse = await apiRequest('/api/categories', {
    method: 'POST',
    token,
    body: {
      name: 'Smoke Income',
      icon: 'badge-dollar-sign',
      color: '#10b981',
      active: true,
    },
    expectedStatus: 201,
    label: 'POST /api/categories',
  });

  const categoryId = categoryResponse?.data?.id;
  if (!categoryId) {
    throw new Error('Category creation did not return id');
  }

  const subcategoryResponse = await apiRequest(
    `/api/categories/${categoryId}/subcategories`,
    {
      method: 'POST',
      token,
      body: {
        name: 'Smoke Subcategory',
        active: true,
      },
      expectedStatus: 201,
      label: 'POST /api/categories/:categoryId/subcategories',
    }
  );

  const subcategoryId = subcategoryResponse?.data?.id;
  if (!subcategoryId) {
    throw new Error('Subcategory creation did not return id');
  }

  const transactionResponse = await apiRequest('/api/transactions', {
    method: 'POST',
    token,
    body: {
      account_id: accountId,
      contact_id: contactId,
      type: 'income',
      amount: 1500,
      category: 'Smoke Income',
      description: 'Smoke test transaction',
      status: 'posted',
      source: 'smoke_test',
      transaction_date: new Date().toISOString(),
    },
    expectedStatus: 201,
    label: 'POST /api/transactions',
  });

  const transactionId = transactionResponse?.data?.id;
  if (!transactionId) {
    throw new Error('Transaction creation did not return id');
  }

  const splitResponse = await apiRequest(
    `/api/transactions/${transactionId}/splits`,
    {
      method: 'POST',
      token,
      body: {
        category_id: categoryId,
        subcategory_id: subcategoryId,
        amount: 1500,
      },
      expectedStatus: 201,
      label: 'POST /api/transactions/:transactionId/splits',
    }
  );

  const splitId = splitResponse?.data?.id;
  if (!splitId) {
    throw new Error('Split creation did not return id');
  }

  const listResponse = await apiRequest(
    `/api/transactions?account_id=${accountId}&contact_id=${contactId}&status=posted&limit=20&offset=0`,
    {
      token,
      expectedStatus: 200,
      label: 'GET /api/transactions (filtered)',
    }
  );

  const listed = Array.isArray(listResponse?.data) ? listResponse.data : [];
  if (!listed.some((tx) => tx.id === transactionId)) {
    throw new Error('Filtered transaction list did not include created transaction');
  }

  await apiRequest(`/api/transactions/${transactionId}`, {
    method: 'PUT',
    token,
    body: {
      notes: 'updated by smoke test',
      source: 'smoke_test_update',
    },
    expectedStatus: 200,
    label: 'PUT /api/transactions/:id',
  });

  const splitsListResponse = await apiRequest(
    `/api/transactions/${transactionId}/splits`,
    {
      token,
      expectedStatus: 200,
      label: 'GET /api/transactions/:transactionId/splits',
    }
  );

  const splitRows = Array.isArray(splitsListResponse?.data)
    ? splitsListResponse.data
    : [];

  if (!splitRows.some((row) => row.id === splitId)) {
    throw new Error('Split list did not include created split');
  }

  const historyResponse = await apiRequest(
    `/api/transactions/${transactionId}/history?limit=10`,
    {
      token,
      expectedStatus: 200,
      label: 'GET /api/transactions/:transactionId/history',
    }
  );

  const historyRows = Array.isArray(historyResponse?.data)
    ? historyResponse.data
    : [];
  const historyActions = new Set(historyRows.map((row) => row.action));
  if (!historyActions.has('create') || !historyActions.has('update')) {
    throw new Error('Transaction history missing create/update audit records');
  }

  console.log('Phase 1 smoke test passed.');
  console.log(
    JSON.stringify(
      {
        success: true,
        organization_id: organizationId,
        account_id: accountId,
        contact_id: contactId,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        transaction_id: transactionId,
        split_id: splitId,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('Phase 1 smoke test failed.');
  console.error(error.message || error);
  process.exit(1);
});
