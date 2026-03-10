const pool = require('../db/pool');

function toAmount(value) {
  return Number.parseFloat(value || '0');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(startDate, endDate) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs(endDate.getTime() - startDate.getTime()) / msPerDay;
}

function daysUntil(targetDate, now) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return (targetDate.getTime() - now.getTime()) / msPerDay;
}

function normalizeDescription(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b(SPEI|TRANSFERENCIA|PAGO|COMPRA|DEPOSITO|REF|FOLIO)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function mapFrequency(averageIntervalDays) {
  if (averageIntervalDays >= 6 && averageIntervalDays <= 9) {
    return 'weekly';
  }
  if (averageIntervalDays >= 13 && averageIntervalDays <= 17) {
    return 'biweekly';
  }
  if (averageIntervalDays >= 27 && averageIntervalDays <= 33) {
    return 'monthly';
  }
  if (averageIntervalDays >= 58 && averageIntervalDays <= 64) {
    return 'bimonthly';
  }
  if (averageIntervalDays >= 85 && averageIntervalDays <= 95) {
    return 'quarterly';
  }

  return 'custom';
}

async function loadRecurringRulesIndex(organization_id) {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          id,
          candidate_key,
          status,
          suppress_until,
          next_expected_date
        FROM finance.recurring_rules
        WHERE organization_id = $1
      `,
      [organization_id]
    );

    const now = new Date();
    const map = new Map();
    for (const row of rows) {
      const suppressUntil = row.suppress_until ? new Date(row.suppress_until) : null;
      const isSuppressed =
        row.status === 'suppressed' &&
        (!suppressUntil || suppressUntil.getTime() > now.getTime());

      map.set(row.candidate_key, {
        id: row.id,
        status: row.status,
        suppress_until: suppressUntil ? suppressUntil.toISOString() : null,
        is_suppressed: isSuppressed,
        next_expected_date: row.next_expected_date
          ? new Date(row.next_expected_date).toISOString()
          : null,
      });
    }

    return map;
  } catch (error) {
    if (error && error.code === '42P01') {
      return new Map();
    }
    throw error;
  }
}

function buildCandidate(group, now) {
  const dates = group.items
    .map((item) => new Date(item.transaction_date))
    .sort((left, right) => left.getTime() - right.getTime());

  if (dates.length < 2) {
    return null;
  }

  const intervals = [];
  for (let index = 1; index < dates.length; index += 1) {
    intervals.push(daysBetween(dates[index - 1], dates[index]));
  }

  const averageIntervalDays =
    intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const variance =
    intervals.reduce(
      (sum, value) => sum + (value - averageIntervalDays) ** 2,
      0
    ) / intervals.length;
  const stdDeviation = Math.sqrt(variance);

  const lastDate = dates[dates.length - 1];
  const roundedInterval = Math.max(1, Math.round(averageIntervalDays));
  const nextExpectedDate = new Date(lastDate);
  nextExpectedDate.setUTCDate(nextExpectedDate.getUTCDate() + roundedInterval);

  const intervalScore = clamp(
    1 - stdDeviation / Math.max(averageIntervalDays, 1),
    0,
    1
  );
  const occurrenceScore = clamp((dates.length - 1) / 6, 0, 1);
  const recencyScore = clamp(
    1 - daysBetween(lastDate, now) / Math.max(roundedInterval * 2.5, 30),
    0,
    1
  );

  const confidence = Number(
    (intervalScore * 0.5 + occurrenceScore * 0.3 + recencyScore * 0.2).toFixed(
      4
    )
  );

  const descriptionSamples = Array.from(
    new Set(
      group.items
        .map((item) => String(item.raw_description || '').trim())
        .filter(Boolean)
        .slice(0, 3)
    )
  );

  return {
    key: group.key,
    type: group.type,
    amount: Number(group.amount.toFixed(2)),
    category: group.category,
    normalized_description: group.normalizedDescription,
    sample_descriptions: descriptionSamples,
    occurrences: dates.length,
    average_interval_days: Number(averageIntervalDays.toFixed(2)),
    frequency: mapFrequency(averageIntervalDays),
    last_transaction_date: lastDate.toISOString(),
    next_expected_date: nextExpectedDate.toISOString(),
    confidence,
  };
}

async function listRecurringCandidates({
  organization_id,
  lookback_days = 180,
  min_occurrences = 3,
  limit = 20,
  include_suppressed = false,
}) {
  const query = {
    text: `
      SELECT
        id,
        type,
        amount,
        category,
        COALESCE(original_description, description, entity, '') AS raw_description,
        transaction_date
      FROM finance.transactions
      WHERE organization_id = $1
        AND deleted_at IS NULL
        AND COALESCE(status, 'posted') <> 'void'
        AND transaction_date >= now() - ($2::int * INTERVAL '1 day')
      ORDER BY transaction_date ASC
    `,
    values: [organization_id, lookback_days],
  };

  const { rows } = await pool.query(query);
  const groups = new Map();

  for (const row of rows) {
    const normalizedDescription = normalizeDescription(row.raw_description);
    if (!normalizedDescription || normalizedDescription.length < 4) {
      continue;
    }

    const amount = toAmount(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const key = `${row.type}|${amount.toFixed(2)}|${normalizedDescription}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        type: row.type,
        amount,
        category: row.category,
        normalizedDescription,
        items: [],
      });
    }

    groups.get(key).items.push(row);
  }

  const now = new Date();
  const candidates = [];
  for (const group of groups.values()) {
    if (group.items.length < min_occurrences) {
      continue;
    }

    const candidate = buildCandidate(group, now);
    if (!candidate) {
      continue;
    }
    candidates.push(candidate);
  }

  const rulesIndex = await loadRecurringRulesIndex(organization_id);

  const ranked = candidates
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      if (right.occurrences !== left.occurrences) {
        return right.occurrences - left.occurrences;
      }
      return (
        new Date(left.next_expected_date).getTime() -
        new Date(right.next_expected_date).getTime()
      );
    })
    .map((candidate) => {
      const rule = rulesIndex.get(candidate.key);
      return {
        ...candidate,
        rule_id: rule?.id || null,
        rule_status: rule?.status || null,
        suppress_until: rule?.suppress_until || null,
        is_suppressed: Boolean(rule?.is_suppressed),
      };
    })
    .filter((candidate) => include_suppressed || !candidate.is_suppressed);

  return ranked.slice(0, limit);
}

async function listRecurringAlerts({
  organization_id,
  lookback_days = 180,
  min_occurrences = 3,
  due_window_days = 7,
  overdue_grace_days = 2,
  limit = 20,
}) {
  const candidates = await listRecurringCandidates({
    organization_id,
    lookback_days,
    min_occurrences,
    limit: Math.max(limit * 4, 50),
    include_suppressed: false,
  });

  const now = new Date();
  const dueSoon = [];
  const overdue = [];

  for (const candidate of candidates) {
    const nextDate = new Date(candidate.next_expected_date);
    if (Number.isNaN(nextDate.getTime())) {
      continue;
    }

    const remainingDays = Number(daysUntil(nextDate, now).toFixed(2));
    const record = {
      ...candidate,
      days_until_due: remainingDays,
    };

    if (remainingDays >= 0 && remainingDays <= due_window_days) {
      dueSoon.push(record);
      continue;
    }

    if (remainingDays < -overdue_grace_days) {
      overdue.push(record);
    }
  }

  dueSoon.sort((left, right) => left.days_until_due - right.days_until_due);
  overdue.sort((left, right) => left.days_until_due - right.days_until_due);

  return {
    generated_at: now.toISOString(),
    due_window_days,
    overdue_grace_days,
    total_monitored: candidates.length,
    due_soon: dueSoon.slice(0, limit),
    overdue: overdue.slice(0, limit),
  };
}

module.exports = {
  listRecurringCandidates,
  listRecurringAlerts,
};
