const crypto = require('crypto');

const pool = require('../../../db/pool');
const logger = require('../../../logger');
const { classifyTransactionWithAi } = require('./ai-provider.service');
const { matchTransactionToEntity } = require('./entity-match.service');

const STOPWORDS = new Set([
  'a',
  'al',
  'de',
  'del',
  'el',
  'en',
  'la',
  'las',
  'los',
  'por',
  'para',
  'con',
  'sin',
  'una',
  'uno',
  'un',
  'y',
  'o',
  'por',
  'se',
  'que',
  'mc',
  'terminacion',
  'hora',
  'dato',
  'no',
  'verificado',
  'esta',
  'institucion',
]);

const MIN_TOKEN_LENGTH = 3;
const MAX_KEYWORD_TOKENS = 8;
const FUZZY_THRESHOLD = 0.45;
const RULE_LIMIT = 300;
const AI_RULE_AUTOSAVE_CONFIDENCE = 0.85;
const DEFAULT_CATEGORY_HINTS = [
  'sales',
  'services',
  'operations',
  'payroll',
  'marketing',
  'suppliers',
  'rent',
  'taxes',
  'bank_fees',
  'transfer',
  'other',
];
const PAYROLL_TOKENS = [
  'nomina',
  'sueldo',
  'salary',
  'payroll',
  'quincena',
  'aguinaldo',
  'imss',
  'isr sueldos',
];

function toNullableUuid(value) {
  const input = String(value || '').trim();
  if (!input) {
    return null;
  }

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input
    )
  ) {
    return input.toLowerCase();
  }

  return null;
}

function normalizeDescription(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalizedDescription(normalizedDescription) {
  return String(normalizedDescription || '')
    .split(' ')
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token)
    );
}

function uniqueTokens(tokens) {
  const seen = new Set();
  const results = [];

  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    results.push(token);
  }

  return results;
}

function buildKeywordPattern(input) {
  const normalized = normalizeDescription(input);
  if (!normalized) {
    return '';
  }

  const tokens = uniqueTokens(tokenizeNormalizedDescription(normalized));
  if (!tokens.length) {
    return normalized.slice(0, 120);
  }

  return tokens.slice(0, MAX_KEYWORD_TOKENS).join(' ').slice(0, 120);
}

function tokenJaccardSimilarity(leftText, rightText) {
  const leftTokens = new Set(
    tokenizeNormalizedDescription(normalizeDescription(leftText))
  );
  const rightTokens = new Set(
    tokenizeNormalizedDescription(normalizeDescription(rightText))
  );

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  if (!union) {
    return 0;
  }

  return intersection / union;
}

function deterministicUuidFromText(value) {
  const hash = crypto
    .createHash('sha1')
    .update(`veridis:${String(value || '').trim().toLowerCase()}`)
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function ensureCategoryId(categoryId, categoryLabel) {
  const fromId = toNullableUuid(categoryId);
  if (fromId) {
    return fromId;
  }

  const normalizedCategory = normalizeDescription(categoryLabel);
  if (!normalizedCategory) {
    return null;
  }

  return deterministicUuidFromText(`category:${normalizedCategory}`);
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function normalizeMatchMethod(value) {
  const method = String(value || '')
    .trim()
    .toLowerCase();

  if (!method) {
    return null;
  }

  if (method === 'rule' || method === 'fuzzy' || method === 'manual') {
    return method;
  }

  return null;
}

function ruleUsageWeight(timesApplied) {
  return Math.min(0.12, Math.log1p(Math.max(0, toFiniteNumber(timesApplied))) * 0.02);
}

function confidenceToRange(value, fallback = 0) {
  const parsed = toFiniteNumber(value, fallback);
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1.5) {
    return 1.5;
  }
  return parsed;
}

function buildMemberSignals(member) {
  const candidates = [member.full_name, member.alias]
    .map((item) => normalizeDescription(item))
    .filter(Boolean);

  const uniqueCandidates = uniqueTokens(candidates.join(' ').split(' '));
  return {
    phrases: candidates,
    tokens: uniqueCandidates.filter((token) => token.length >= 3),
  };
}

function detectMemberFromDescription(normalizedDescription, members) {
  if (!normalizedDescription || !members.length) {
    return null;
  }

  let bestMatch = null;

  for (const member of members) {
    const signals = buildMemberSignals(member);

    let score = 0;

    for (const phrase of signals.phrases) {
      if (!phrase) {
        continue;
      }

      if (normalizedDescription.includes(phrase)) {
        score = Math.max(score, phrase === normalizeDescription(member.full_name) ? 0.98 : 0.9);
      }
    }

    if (score < 0.65 && signals.tokens.length > 0) {
      const matchedTokens = signals.tokens.filter((token) =>
        normalizedDescription.includes(token)
      ).length;

      const coverage = matchedTokens / signals.tokens.length;
      if (coverage >= 0.5) {
        score = Math.max(score, 0.65 + coverage * 0.2);
      }
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        member_id: member.id,
        member_name: member.full_name,
        score: Number(score.toFixed(4)),
      };
    }
  }

  if (!bestMatch || bestMatch.score < 0.65) {
    return null;
  }

  return bestMatch;
}

function safeDbTableError(error) {
  return error?.code === '42P01' || error?.code === '42703';
}

async function listActiveMembers(db, organizationId) {
  try {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          full_name,
          alias,
          bank_account_last4,
          rfc,
          salary_estimate,
          active,
          created_at
        FROM finance.members
        WHERE organization_id = $1
          AND active = true
        ORDER BY full_name ASC
      `,
      values: [organizationId],
    };

    const { rows } = await db.query(query);
    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

async function listActiveClients(db, organizationId) {
  try {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          name,
          business_name,
          email,
          phone,
          notes,
          active,
          created_at,
          updated_at
        FROM finance.clients
        WHERE organization_id = $1
          AND active = true
        ORDER BY name ASC
      `,
      values: [organizationId],
    };

    const { rows } = await db.query(query);
    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

async function listActiveVendors(db, organizationId) {
  try {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          name,
          type,
          default_category_id,
          active,
          created_at,
          updated_at
        FROM finance.vendors
        WHERE organization_id = $1
          AND active = true
        ORDER BY name ASC
      `,
      values: [organizationId],
    };

    const { rows } = await db.query(query);
    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

function scoreStringSimilarity(left, right) {
  const leftNorm = normalizeDescription(left);
  const rightNorm = normalizeDescription(right);

  if (!leftNorm || !rightNorm) {
    return 0;
  }

  if (leftNorm === rightNorm) {
    return 1;
  }

  if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) {
    return 0.9;
  }

  return tokenJaccardSimilarity(leftNorm, rightNorm);
}

function extractCounterpartyHint(normalizedDescription, marker) {
  const markerNorm = normalizeDescription(marker);
  const source = normalizeDescription(normalizedDescription);

  if (!source || !markerNorm) {
    return '';
  }

  const markerIndex = source.indexOf(markerNorm);
  if (markerIndex < 0) {
    return '';
  }

  const afterMarker = source.slice(markerIndex + markerNorm.length).trim();
  if (!afterMarker) {
    return '';
  }

  const stopTokens = [
    'referencia',
    'rfc',
    'comision',
    'concepto',
    'saldo',
    'fol',
  ];

  let hint = afterMarker;
  for (const token of stopTokens) {
    const tokenIndex = hint.indexOf(token);
    if (tokenIndex > 0) {
      hint = hint.slice(0, tokenIndex).trim();
    }
  }

  return hint.slice(0, 120);
}

function findBestMemberByHint(members, hint) {
  const normalizedHint = normalizeDescription(hint);
  if (!normalizedHint || !members.length) {
    return null;
  }

  let best = null;

  for (const member of members) {
    const fullName = normalizeDescription(member.full_name);
    const alias = normalizeDescription(member.alias);
    const fullScore = scoreStringSimilarity(normalizedHint, fullName);
    const aliasScore = alias ? scoreStringSimilarity(normalizedHint, alias) : 0;
    const score = Math.max(fullScore, aliasScore);

    if (!best || score > best.score) {
      best = {
        member_id: member.id,
        member_name: member.full_name,
        score: Number(score.toFixed(4)),
      };
    }
  }

  if (!best || best.score < 0.35) {
    return null;
  }

  return best;
}

function findBestClientByHint(clients, hint) {
  const normalizedHint = normalizeDescription(hint);
  if (!normalizedHint || !clients.length) {
    return null;
  }

  let best = null;

  for (const client of clients) {
    const clientName = normalizeDescription(client.name);
    const score = scoreStringSimilarity(normalizedHint, clientName);

    if (!best || score > best.score) {
      best = {
        client_id: client.id,
        client_name: client.name,
        score: Number(score.toFixed(4)),
      };
    }
  }

  if (!best || best.score < 0.35) {
    return null;
  }

  return best;
}

function findVendorByKeyword(vendors, keywords) {
  if (!vendors.length) {
    return null;
  }

  const keywordText = keywords.join(' ');
  let best = null;

  for (const vendor of vendors) {
    const normalizedVendorName = normalizeDescription(vendor.name);
    const score = scoreStringSimilarity(normalizedVendorName, keywordText);

    if (!best || score > best.score) {
      best = {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        score: Number(score.toFixed(4)),
      };
    }
  }

  if (!best || best.score < 0.28) {
    return null;
  }

  return best;
}

function resolveEntityAutoLink({
  normalizedDescription,
  members,
  clients,
  vendors,
  classification,
}) {
  const source = normalizeDescription(normalizedDescription);

  const speiSentHint = extractCounterpartyHint(source, 'spei enviado a');
  if (speiSentHint) {
    const member = findBestMemberByHint(members, speiSentHint);
    if (member) {
      return {
        member_id: member.member_id,
        member_name: member.member_name,
        client_id: null,
        client_name: null,
        vendor_id: null,
        vendor_name: null,
        auto_link_source: 'spei_enviado_member',
      };
    }
  }

  const speiReceivedHint = extractCounterpartyHint(source, 'spei recibido de');
  if (speiReceivedHint) {
    const client = findBestClientByHint(clients, speiReceivedHint);
    if (client) {
      return {
        member_id: null,
        member_name: null,
        client_id: client.client_id,
        client_name: client.client_name,
        vendor_id: null,
        vendor_name: null,
        auto_link_source: 'spei_recibido_client',
      };
    }
  }

  if (source.includes('facebk') || source.includes('facebook')) {
    const vendor = findVendorByKeyword(vendors, ['facebook', 'meta', 'ads']);
    if (vendor) {
      return {
        member_id: null,
        member_name: null,
        client_id: null,
        client_name: null,
        vendor_id: vendor.vendor_id,
        vendor_name: vendor.vendor_name,
        auto_link_source: 'vendor_facebook',
      };
    }
  }

  if (source.includes('clickup')) {
    const vendor = findVendorByKeyword(vendors, ['clickup']);
    if (vendor) {
      return {
        member_id: null,
        member_name: null,
        client_id: null,
        client_name: null,
        vendor_id: vendor.vendor_id,
        vendor_name: vendor.vendor_name,
        auto_link_source: 'vendor_clickup',
      };
    }
  }

  if (source.includes('canva')) {
    const vendor = findVendorByKeyword(vendors, ['canva']);
    if (vendor) {
      return {
        member_id: null,
        member_name: null,
        client_id: null,
        client_name: null,
        vendor_id: vendor.vendor_id,
        vendor_name: vendor.vendor_name,
        auto_link_source: 'vendor_canva',
      };
    }
  }

  if (classification?.member_id) {
    return {
      member_id: classification.member_id,
      member_name: classification.member_name || null,
      client_id: null,
      client_name: null,
      vendor_id: null,
      vendor_name: null,
      auto_link_source: 'classification_member',
    };
  }

  return {
    member_id: null,
    member_name: null,
    client_id: null,
    client_name: null,
    vendor_id: null,
    vendor_name: null,
    auto_link_source: null,
  };
}

function enforceSingleLinkedEntity({
  member_id,
  member_name,
  client_id,
  client_name,
  vendor_id,
  vendor_name,
}) {
  if (member_id) {
    return {
      member_id,
      member_name: member_name || null,
      client_id: null,
      client_name: null,
      vendor_id: null,
      vendor_name: null,
    };
  }

  if (client_id) {
    return {
      member_id: null,
      member_name: null,
      client_id,
      client_name: client_name || null,
      vendor_id: null,
      vendor_name: null,
    };
  }

  if (vendor_id) {
    return {
      member_id: null,
      member_name: null,
      client_id: null,
      client_name: null,
      vendor_id,
      vendor_name: vendor_name || null,
    };
  }

  return {
    member_id: null,
    member_name: null,
    client_id: null,
    client_name: null,
    vendor_id: null,
    vendor_name: null,
  };
}

async function listOrganizationCategories(db, organizationId) {
  try {
    const query = {
      text: `
        WITH category_candidates AS (
          SELECT DISTINCT lower(trim(category)) AS category
          FROM finance.transactions
          WHERE organization_id = $1
            AND deleted_at IS NULL
            AND category IS NOT NULL
            AND length(trim(category)) > 0

          UNION

          SELECT DISTINCT lower(trim(category_label)) AS category
          FROM finance.transaction_rules
          WHERE organization_id = $1
            AND category_label IS NOT NULL
            AND length(trim(category_label)) > 0
        )
        SELECT category
        FROM category_candidates
        ORDER BY category ASC
        LIMIT 200
      `,
      values: [organizationId],
    };

    const { rows } = await db.query(query);
    const categories = rows
      .map((row) => safeCategoryLabel(row.category).toLowerCase())
      .filter(Boolean);

    const merged = new Set(DEFAULT_CATEGORY_HINTS);
    for (const category of categories) {
      merged.add(category);
    }

    return Array.from(merged);
  } catch (error) {
    if (safeDbTableError(error)) {
      return [...DEFAULT_CATEGORY_HINTS];
    }
    throw error;
  }
}

function findMemberByAiSuggestion(members, suggestion) {
  const hint = normalizeDescription(suggestion);
  if (!hint) {
    return null;
  }

  for (const member of members) {
    const memberFullName = normalizeDescription(member.full_name);
    const memberAlias = normalizeDescription(member.alias);

    if (memberFullName && (memberFullName === hint || memberFullName.includes(hint) || hint.includes(memberFullName))) {
      return {
        member_id: member.id,
        member_name: member.full_name,
      };
    }

    if (memberAlias && (memberAlias === hint || memberAlias.includes(hint) || hint.includes(memberAlias))) {
      return {
        member_id: member.id,
        member_name: member.full_name,
      };
    }
  }

  return null;
}

async function findRulesForLikeMatching(db, organizationId, normalizedDescription) {
  try {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          keyword_pattern,
          category_id,
          subcategory_id,
          member_id,
          category_label,
          subcategory_label,
          confidence_score,
          times_applied,
          created_at
        FROM finance.transaction_rules
        WHERE organization_id = $1
          AND (
            $2 LIKE '%' || keyword_pattern || '%'
            OR keyword_pattern LIKE '%' || $2 || '%'
          )
        ORDER BY confidence_score DESC, times_applied DESC, created_at DESC
        LIMIT 25
      `,
      values: [organizationId, normalizedDescription],
    };

    const { rows } = await db.query(query);
    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

async function findExactRule(db, organizationId, keywordPattern) {
  if (!keywordPattern) {
    return null;
  }

  try {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          keyword_pattern,
          category_id,
          subcategory_id,
          member_id,
          category_label,
          subcategory_label,
          confidence_score,
          times_applied,
          created_at
        FROM finance.transaction_rules
        WHERE organization_id = $1
          AND keyword_pattern = $2
        ORDER BY confidence_score DESC, times_applied DESC, created_at DESC
        LIMIT 1
      `,
      values: [organizationId, keywordPattern],
    };

    const { rows } = await db.query(query);
    return rows[0] || null;
  } catch (error) {
    if (safeDbTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function listRuleCandidates(db, organizationId) {
  try {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          keyword_pattern,
          category_id,
          subcategory_id,
          member_id,
          category_label,
          subcategory_label,
          confidence_score,
          times_applied,
          created_at
        FROM finance.transaction_rules
        WHERE organization_id = $1
        ORDER BY times_applied DESC, confidence_score DESC, created_at DESC
        LIMIT ${RULE_LIMIT}
      `,
      values: [organizationId],
    };

    const { rows } = await db.query(query);
    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

function scoreRuleMatch(rule, baseScore) {
  const confidence = confidenceToRange(rule.confidence_score, 1);
  const usageWeight = ruleUsageWeight(rule.times_applied);

  return Number((baseScore + usageWeight + confidence * 0.08).toFixed(4));
}

async function findBestRuleMatch({
  db,
  organizationId,
  normalizedDescription,
  keywordPattern,
}) {
  const exactRule = await findExactRule(db, organizationId, keywordPattern);
  if (exactRule) {
    return {
      rule: exactRule,
      matched_by: 'exact',
      score: scoreRuleMatch(exactRule, 1),
    };
  }

  const likeRules = await findRulesForLikeMatching(
    db,
    organizationId,
    normalizedDescription
  );
  if (likeRules.length) {
    return {
      rule: likeRules[0],
      matched_by: 'like',
      score: scoreRuleMatch(likeRules[0], 0.86),
    };
  }

  const candidates = await listRuleCandidates(db, organizationId);
  if (!candidates.length) {
    return null;
  }

  let best = null;

  for (const candidate of candidates) {
    const similarity = tokenJaccardSimilarity(
      normalizedDescription,
      candidate.keyword_pattern
    );

    if (similarity < FUZZY_THRESHOLD) {
      continue;
    }

    const score = scoreRuleMatch(candidate, similarity);
    if (!best || score > best.score) {
      best = {
        rule: candidate,
        matched_by: 'fuzzy',
        score,
      };
    }
  }

  return best;
}

async function incrementRuleTimesApplied(db, ruleId) {
  if (!ruleId) {
    return;
  }

  try {
    await db.query(
      `
        UPDATE finance.transaction_rules
        SET times_applied = times_applied + 1
        WHERE id = $1
      `,
      [ruleId]
    );
  } catch (error) {
    if (safeDbTableError(error)) {
      return;
    }
    throw error;
  }
}

function safeCategoryLabel(value) {
  return String(value || '').trim().slice(0, 120);
}

function safeSubcategoryLabel(value) {
  return String(value || '').trim().slice(0, 120);
}

function isPayrollCandidate(normalizedDescription, categoryLabel) {
  const joined = `${normalizeDescription(normalizedDescription)} ${normalizeDescription(
    categoryLabel
  )}`.trim();

  if (!joined) {
    return false;
  }

  return PAYROLL_TOKENS.some((token) => joined.includes(token));
}

function defaultClassification(normalizedDescription) {
  return {
    normalized_description: normalizedDescription,
    keyword_pattern: buildKeywordPattern(normalizedDescription),
    classification_status: 'uncategorized',
    classification_source: null,
    matched_by: null,
    matched_rule_id: null,
    confidence_score: 0,
    category_id: null,
    subcategory_id: null,
    category: 'uncategorized',
    subcategory: null,
    member_id: null,
    member_name: null,
    ai_provider: null,
    ai_model: null,
    ai_usage_tokens: 0,
    is_payroll_candidate: false,
  };
}

async function classifyTransaction({
  organizationId,
  description,
  db = pool,
  incrementRuleUsage = true,
}) {
  const normalizedDescription = normalizeDescription(description);
  const keywordPattern = buildKeywordPattern(normalizedDescription);

  const base = defaultClassification(normalizedDescription);

  if (!normalizedDescription) {
    return base;
  }

  const [ruleMatch, members] = await Promise.all([
    findBestRuleMatch({
      db,
      organizationId,
      normalizedDescription,
      keywordPattern,
    }),
    listActiveMembers(db, organizationId),
  ]);

  const memberMatch = detectMemberFromDescription(normalizedDescription, members);

  if (ruleMatch) {
    if (incrementRuleUsage) {
      await incrementRuleTimesApplied(db, ruleMatch.rule.id);
    }

    const categoryLabel = safeCategoryLabel(ruleMatch.rule.category_label);
    const subcategoryLabel = safeSubcategoryLabel(ruleMatch.rule.subcategory_label);
    const fallbackMemberId = toNullableUuid(ruleMatch.rule.member_id);
    const finalMemberId = fallbackMemberId || memberMatch?.member_id || null;

    return {
      normalized_description: normalizedDescription,
      keyword_pattern: keywordPattern,
      classification_status: 'classified',
      classification_source: 'rule',
      matched_by: ruleMatch.matched_by,
      matched_rule_id: ruleMatch.rule.id,
      confidence_score: Number(ruleMatch.score.toFixed(4)),
      category_id: toNullableUuid(ruleMatch.rule.category_id),
      subcategory_id: toNullableUuid(ruleMatch.rule.subcategory_id),
      category: categoryLabel || 'uncategorized',
      subcategory: subcategoryLabel || null,
      member_id: finalMemberId,
      member_name: memberMatch?.member_name || null,
      ai_provider: null,
      ai_model: null,
      ai_usage_tokens: 0,
      is_payroll_candidate: isPayrollCandidate(
        normalizedDescription,
        categoryLabel || null
      ),
    };
  }

  if (memberMatch) {
    return {
      ...base,
      classification_status: 'classified',
      classification_source: 'member',
      member_id: memberMatch.member_id,
      member_name: memberMatch.member_name,
      confidence_score: Number(memberMatch.score.toFixed(4)),
      is_payroll_candidate: isPayrollCandidate(normalizedDescription, null),
    };
  }

  const categories = await listOrganizationCategories(db, organizationId);
  let aiResult = null;

  try {
    aiResult = await classifyTransactionWithAi({
      organizationId,
      description: description || normalizedDescription,
      categories,
      members,
      db,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        organization_id: organizationId,
      },
      'AI classification failed; falling back to uncategorized'
    );
  }

  if (!aiResult) {
    return {
      ...base,
      is_payroll_candidate: isPayrollCandidate(normalizedDescription, null),
    };
  }

  const aiCategoryLabel =
    safeCategoryLabel(aiResult.category).toLowerCase() || 'uncategorized';
  const aiCategoryId = ensureCategoryId(null, aiCategoryLabel);
  const aiConfidence = confidenceToRange(aiResult.confidence, 0);
  const aiMemberMatch =
    findMemberByAiSuggestion(members, aiResult.member) || null;

  if (aiResult.key_source === 'system') {
    logger.info(
      {
        source: 'ai_classification',
        organization_id: organizationId,
        provider: aiResult.provider,
        model: aiResult.model,
        usage_tokens: aiResult.usage_tokens,
        key_source: aiResult.key_source,
      },
      'AI classification token usage'
    );
  }

  if (aiConfidence >= AI_RULE_AUTOSAVE_CONFIDENCE && aiCategoryLabel !== 'uncategorized') {
    try {
      await learnRuleFromManualCategorization({
        organizationId,
        description: description || normalizedDescription,
        category: aiCategoryLabel,
        categoryId: aiCategoryId,
        memberId: aiMemberMatch?.member_id || null,
        confidenceScore: aiConfidence,
        db,
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          organization_id: organizationId,
          confidence: aiConfidence,
          category: aiCategoryLabel,
        },
        'AI auto-rule creation failed'
      );
    }
  }

  return {
    normalized_description: normalizedDescription,
    keyword_pattern: keywordPattern,
    classification_status: 'classified',
    classification_source: 'ai',
    matched_by: null,
    matched_rule_id: null,
    confidence_score: Number(aiConfidence.toFixed(4)),
    category_id: aiCategoryId,
    subcategory_id: null,
    category: aiCategoryLabel,
    subcategory: null,
    member_id: aiMemberMatch?.member_id || null,
    member_name: aiMemberMatch?.member_name || null,
    ai_provider: aiResult.provider,
    ai_model: aiResult.model,
    ai_usage_tokens: Number(aiResult.usage_tokens || 0),
    is_payroll_candidate: isPayrollCandidate(
      normalizedDescription,
      aiCategoryLabel
    ),
  };
}

async function classifyTransactions({
  organizationId,
  transactions,
  db = pool,
  incrementRuleUsage = true,
}) {
  const input = Array.isArray(transactions) ? transactions : [];
  const output = [];
  const [members, clients, vendors] = await Promise.all([
    listActiveMembers(db, organizationId),
    listActiveClients(db, organizationId),
    listActiveVendors(db, organizationId),
  ]);

  for (const transaction of input) {
    const description =
      transaction?.raw_description ||
      transaction?.description ||
      transaction?.concept ||
      '';

    const classification = await classifyTransaction({
      organizationId,
      description,
      db,
      incrementRuleUsage,
    });

    const autoLinkedEntity = await matchTransactionToEntity({
      organizationId,
      transaction: {
        ...transaction,
        raw_description: description,
      },
      members,
      clients,
      vendors,
      db,
    });

    const finalEntityLink = enforceSingleLinkedEntity({
      member_id:
        toNullableUuid(transaction?.member_id) ||
        autoLinkedEntity.member_id ||
        classification.member_id ||
        null,
      member_name:
        safeCategoryLabel(transaction?.member_name) ||
        autoLinkedEntity.member_name ||
        classification.member_name,
      client_id: toNullableUuid(transaction?.client_id) || autoLinkedEntity.client_id || null,
      client_name:
        safeCategoryLabel(transaction?.client_name) || autoLinkedEntity.client_name || null,
      vendor_id: toNullableUuid(transaction?.vendor_id) || autoLinkedEntity.vendor_id || null,
      vendor_name:
        safeCategoryLabel(transaction?.vendor_name) || autoLinkedEntity.vendor_name || null,
    });

    const classificationEntityFallbackApplied =
      !toNullableUuid(transaction?.member_id) &&
      !toNullableUuid(transaction?.client_id) &&
      !toNullableUuid(transaction?.vendor_id) &&
      !autoLinkedEntity.member_id &&
      !autoLinkedEntity.client_id &&
      !autoLinkedEntity.vendor_id &&
      Boolean(classification.member_id);
    const classificationFallbackMatchMethod = classificationEntityFallbackApplied
      ? classification.classification_source === 'rule'
        ? 'rule'
        : 'fuzzy'
      : null;
    const classificationFallbackMatchConfidence = classificationEntityFallbackApplied
      ? Number(
          Math.max(0, Math.min(1, toFiniteNumber(classification.confidence_score, 0))).toFixed(
            4
          )
        )
      : null;

    output.push({
      ...transaction,
      category:
        safeCategoryLabel(transaction?.category) ||
        safeCategoryLabel(classification.category) ||
        safeCategoryLabel(transaction?.concept) ||
        'uncategorized',
      category_id: toNullableUuid(transaction?.category_id) || classification.category_id,
      subcategory_id:
        toNullableUuid(transaction?.subcategory_id) || classification.subcategory_id,
      member_id: finalEntityLink.member_id,
      member_name: finalEntityLink.member_name,
      client_id: finalEntityLink.client_id,
      client_name: finalEntityLink.client_name,
      vendor_id: finalEntityLink.vendor_id,
      vendor_name: finalEntityLink.vendor_name,
      entity_link_source: autoLinkedEntity.entity_link_source,
      match_confidence:
        transaction?.match_confidence === null ||
        transaction?.match_confidence === undefined
          ? autoLinkedEntity.match_confidence ??
            classificationFallbackMatchConfidence ??
            null
          : Number(toFiniteNumber(transaction?.match_confidence, 0).toFixed(4)),
      match_method:
        normalizeMatchMethod(transaction?.match_method) ||
        normalizeMatchMethod(autoLinkedEntity.match_method) ||
        normalizeMatchMethod(classificationFallbackMatchMethod) ||
        null,
      is_payroll_candidate:
        typeof transaction?.is_payroll_candidate === 'boolean'
          ? transaction.is_payroll_candidate
          : classification.is_payroll_candidate,
      confidence_score: Number(
        toFiniteNumber(transaction?.confidence_score, classification.confidence_score).toFixed(4)
      ),
      classification_status: classification.classification_status,
      classification_source:
        transaction?.classification_source || classification.classification_source,
      classification_match_type: classification.matched_by,
      classification_rule_id: classification.matched_rule_id,
      ai_provider: transaction?.ai_provider || classification.ai_provider || null,
      ai_model: transaction?.ai_model || classification.ai_model || null,
      ai_usage_tokens: Number(
        toFiniteNumber(transaction?.ai_usage_tokens, classification.ai_usage_tokens).toFixed(0)
      ),
      normalized_description: classification.normalized_description,
      keyword_pattern: classification.keyword_pattern,
    });
  }

  return output;
}

async function learnRuleFromManualCategorization({
  organizationId,
  description,
  category,
  categoryId,
  subcategoryId,
  memberId,
  confidenceScore = 1,
  db = pool,
}) {
  const normalizedDescription = normalizeDescription(description);
  const keywordPattern = buildKeywordPattern(normalizedDescription);
  const categoryLabel = safeCategoryLabel(category);

  if (!keywordPattern || !categoryLabel) {
    return null;
  }

  const resolvedCategoryId = ensureCategoryId(categoryId, categoryLabel);
  const resolvedSubcategoryId = toNullableUuid(subcategoryId);
  const resolvedMemberId = toNullableUuid(memberId);
  const safeConfidence = confidenceToRange(confidenceScore, 1);

  try {
    const existingRuleQuery = {
      text: `
        SELECT id
        FROM finance.transaction_rules
        WHERE organization_id = $1
          AND keyword_pattern = $2
          AND category_id IS NOT DISTINCT FROM $3
          AND subcategory_id IS NOT DISTINCT FROM $4
          AND member_id IS NOT DISTINCT FROM $5
          AND COALESCE(category_label, '') = COALESCE($6, '')
        LIMIT 1
      `,
      values: [
        organizationId,
        keywordPattern,
        resolvedCategoryId,
        resolvedSubcategoryId,
        resolvedMemberId,
        categoryLabel,
      ],
    };

    const existingRuleResult = await db.query(existingRuleQuery);
    const existingRule = existingRuleResult.rows[0];

    if (existingRule) {
      await db.query(
        `
          UPDATE finance.transaction_rules
          SET
            confidence_score = GREATEST(confidence_score, $2),
            times_applied = times_applied + 1
          WHERE id = $1
        `,
        [existingRule.id, safeConfidence]
      );

      return {
        id: existingRule.id,
        keyword_pattern: keywordPattern,
        category_id: resolvedCategoryId,
        subcategory_id: resolvedSubcategoryId,
        member_id: resolvedMemberId,
        category: categoryLabel,
      };
    }

    const insertRuleQuery = {
      text: `
        INSERT INTO finance.transaction_rules (
          organization_id,
          keyword_pattern,
          category_id,
          subcategory_id,
          member_id,
          category_label,
          confidence_score,
          times_applied
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
        RETURNING
          id,
          organization_id,
          keyword_pattern,
          category_id,
          subcategory_id,
          member_id,
          category_label,
          confidence_score,
          times_applied,
          created_at
      `,
      values: [
        organizationId,
        keywordPattern,
        resolvedCategoryId,
        resolvedSubcategoryId,
        resolvedMemberId,
        categoryLabel,
        safeConfidence,
      ],
    };

    const insertResult = await db.query(insertRuleQuery);
    const inserted = insertResult.rows[0];

    return {
      id: inserted.id,
      keyword_pattern: inserted.keyword_pattern,
      category_id: inserted.category_id,
      subcategory_id: inserted.subcategory_id,
      member_id: inserted.member_id,
      category: inserted.category_label,
    };
  } catch (error) {
    if (safeDbTableError(error)) {
      return null;
    }
    throw error;
  }
}

module.exports = {
  normalizeDescription,
  buildKeywordPattern,
  classifyTransaction,
  classifyTransactions,
  learnRuleFromManualCategorization,
  deterministicUuidFromText,
  ensureCategoryId,
};
