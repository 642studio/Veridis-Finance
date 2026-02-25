import crypto from 'crypto';
import pool = require('../../../db/pool');
import logger = require('../../../logger');
import { classifyTransactionWithAi } from './ai-provider.service';

type MatchType = 'exact' | 'like' | 'fuzzy' | null;
type ClassificationStatus = 'classified' | 'uncategorized';

export interface ClassificationResult {
  normalized_description: string;
  keyword_pattern: string;
  classification_status: ClassificationStatus;
  classification_source: 'rule' | 'member' | 'ai' | null;
  matched_by: MatchType;
  matched_rule_id: string | null;
  confidence_score: number;
  category_id: string | null;
  subcategory_id: string | null;
  category: string;
  subcategory: string | null;
  member_id: string | null;
  member_name: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_usage_tokens: number;
  is_payroll_candidate: boolean;
}

export interface ClassifyTransactionParams {
  organizationId: string;
  description: string;
  db?: Queryable;
  incrementRuleUsage?: boolean;
}

export interface ClassifyTransactionsParams {
  organizationId: string;
  transactions: Record<string, unknown>[];
  db?: Queryable;
  incrementRuleUsage?: boolean;
}

export interface LearnRuleParams {
  organizationId: string;
  description: string;
  category: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  memberId?: string | null;
  confidenceScore?: number;
  db?: Queryable;
}

interface QueryResultLike<Row> {
  rows: Row[];
}

interface Queryable {
  query<Row = unknown>(
    query: string | { text: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<QueryResultLike<Row>>;
}

interface RuleRow {
  id: string;
  organization_id: string;
  keyword_pattern: string;
  category_id: string | null;
  subcategory_id: string | null;
  member_id: string | null;
  category_label: string | null;
  subcategory_label: string | null;
  confidence_score: number;
  times_applied: number;
  created_at: string;
}

interface MemberRow {
  id: string;
  organization_id: string;
  full_name: string;
  alias: string | null;
  bank_account_last4: string | null;
  rfc: string | null;
  salary_estimate: number | null;
  active: boolean;
  created_at: string;
}

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
] as const;
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

function toNullableUuid(value: unknown): string | null {
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

export function normalizeDescription(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalizedDescription(normalizedDescription: string): string[] {
  return String(normalizedDescription || '')
    .split(' ')
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token)
    );
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    results.push(token);
  }

  return results;
}

export function buildKeywordPattern(input: unknown): string {
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

function tokenJaccardSimilarity(leftText: string, rightText: string): number {
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
  return union ? intersection / union : 0;
}

export function deterministicUuidFromText(value: unknown): string {
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

export function ensureCategoryId(
  categoryId: unknown,
  categoryLabel: unknown
): string | null {
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

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ruleUsageWeight(timesApplied: unknown): number {
  return Math.min(0.12, Math.log1p(Math.max(0, toFiniteNumber(timesApplied))) * 0.02);
}

function confidenceToRange(value: unknown, fallback = 0): number {
  const parsed = toFiniteNumber(value, fallback);
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1.5) {
    return 1.5;
  }
  return parsed;
}

function safeDbTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703';
}

async function listActiveMembers(
  db: Queryable,
  organizationId: string
): Promise<MemberRow[]> {
  try {
    const { rows } = await db.query<MemberRow>({
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
    });

    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

async function listOrganizationCategories(
  db: Queryable,
  organizationId: string
): Promise<string[]> {
  try {
    const { rows } = await db.query<{ category: string | null }>({
      text: `
        WITH category_candidates AS (
          SELECT DISTINCT lower(trim(category)) AS category
          FROM finance.transactions
          WHERE organization_id = $1
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
    });

    const merged = new Set<string>(DEFAULT_CATEGORY_HINTS);
    for (const row of rows) {
      const category = safeCategoryLabel(row.category).toLowerCase();
      if (category) {
        merged.add(category);
      }
    }

    return Array.from(merged);
  } catch (error) {
    if (safeDbTableError(error)) {
      return [...DEFAULT_CATEGORY_HINTS];
    }
    throw error;
  }
}

function findMemberByAiSuggestion(
  members: MemberRow[],
  suggestion: unknown
): { member_id: string; member_name: string } | null {
  const hint = normalizeDescription(suggestion);
  if (!hint) {
    return null;
  }

  for (const member of members) {
    const fullName = normalizeDescription(member.full_name);
    const alias = normalizeDescription(member.alias);

    if (
      fullName &&
      (fullName === hint || fullName.includes(hint) || hint.includes(fullName))
    ) {
      return {
        member_id: member.id,
        member_name: member.full_name,
      };
    }

    if (alias && (alias === hint || alias.includes(hint) || hint.includes(alias))) {
      return {
        member_id: member.id,
        member_name: member.full_name,
      };
    }
  }

  return null;
}

function buildMemberSignals(member: MemberRow): { phrases: string[]; tokens: string[] } {
  const phrases = [member.full_name, member.alias]
    .map((item) => normalizeDescription(item))
    .filter(Boolean);

  const tokens = uniqueTokens(phrases.join(' ').split(' ')).filter(
    (token) => token.length >= 3
  );

  return { phrases, tokens };
}

function detectMemberFromDescription(
  normalizedDescription: string,
  members: MemberRow[]
): { member_id: string; member_name: string; score: number } | null {
  if (!normalizedDescription || !members.length) {
    return null;
  }

  let best: { member_id: string; member_name: string; score: number } | null = null;

  for (const member of members) {
    const signals = buildMemberSignals(member);
    let score = 0;

    for (const phrase of signals.phrases) {
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

    if (!best || score > best.score) {
      best = {
        member_id: member.id,
        member_name: member.full_name,
        score: Number(score.toFixed(4)),
      };
    }
  }

  if (!best || best.score < 0.65) {
    return null;
  }

  return best;
}

async function findExactRule(
  db: Queryable,
  organizationId: string,
  keywordPattern: string
): Promise<RuleRow | null> {
  if (!keywordPattern) {
    return null;
  }

  try {
    const { rows } = await db.query<RuleRow>({
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
    });

    return rows[0] || null;
  } catch (error) {
    if (safeDbTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function findRulesForLikeMatching(
  db: Queryable,
  organizationId: string,
  normalizedDescription: string
): Promise<RuleRow[]> {
  try {
    const { rows } = await db.query<RuleRow>({
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
    });

    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

async function listRuleCandidates(
  db: Queryable,
  organizationId: string
): Promise<RuleRow[]> {
  try {
    const { rows } = await db.query<RuleRow>({
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
    });

    return rows;
  } catch (error) {
    if (safeDbTableError(error)) {
      return [];
    }
    throw error;
  }
}

function scoreRuleMatch(rule: RuleRow, baseScore: number): number {
  const confidence = confidenceToRange(rule.confidence_score, 1);
  const usageWeight = ruleUsageWeight(rule.times_applied);
  return Number((baseScore + usageWeight + confidence * 0.08).toFixed(4));
}

async function findBestRuleMatch(params: {
  db: Queryable;
  organizationId: string;
  normalizedDescription: string;
  keywordPattern: string;
}): Promise<{ rule: RuleRow; matched_by: Exclude<MatchType, null>; score: number } | null> {
  const exactRule = await findExactRule(
    params.db,
    params.organizationId,
    params.keywordPattern
  );

  if (exactRule) {
    return {
      rule: exactRule,
      matched_by: 'exact',
      score: scoreRuleMatch(exactRule, 1),
    };
  }

  const likeRules = await findRulesForLikeMatching(
    params.db,
    params.organizationId,
    params.normalizedDescription
  );

  if (likeRules.length) {
    return {
      rule: likeRules[0],
      matched_by: 'like',
      score: scoreRuleMatch(likeRules[0], 0.86),
    };
  }

  const candidates = await listRuleCandidates(params.db, params.organizationId);
  let best: { rule: RuleRow; matched_by: Exclude<MatchType, null>; score: number } | null = null;

  for (const candidate of candidates) {
    const similarity = tokenJaccardSimilarity(
      params.normalizedDescription,
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

async function incrementRuleTimesApplied(db: Queryable, ruleId: string): Promise<void> {
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
    if (!safeDbTableError(error)) {
      throw error;
    }
  }
}

function safeCategoryLabel(value: unknown): string {
  return String(value || '').trim().slice(0, 120);
}

function safeSubcategoryLabel(value: unknown): string {
  return String(value || '').trim().slice(0, 120);
}

function isPayrollCandidate(
  normalizedDescription: string,
  categoryLabel: string | null
): boolean {
  const joined = `${normalizeDescription(normalizedDescription)} ${normalizeDescription(
    categoryLabel
  )}`.trim();

  if (!joined) {
    return false;
  }

  return PAYROLL_TOKENS.some((token) => joined.includes(token));
}

function defaultClassification(normalizedDescription: string): ClassificationResult {
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

export async function classifyTransaction(
  params: ClassifyTransactionParams
): Promise<ClassificationResult> {
  const db = params.db || (pool as Queryable);
  const normalizedDescription = normalizeDescription(params.description);
  const keywordPattern = buildKeywordPattern(normalizedDescription);
  const base = defaultClassification(normalizedDescription);

  if (!normalizedDescription) {
    return base;
  }

  const [ruleMatch, members] = await Promise.all([
    findBestRuleMatch({
      db,
      organizationId: params.organizationId,
      normalizedDescription,
      keywordPattern,
    }),
    listActiveMembers(db, params.organizationId),
  ]);

  const memberMatch = detectMemberFromDescription(normalizedDescription, members);

  if (ruleMatch) {
    if (params.incrementRuleUsage !== false) {
      await incrementRuleTimesApplied(db, ruleMatch.rule.id);
    }

    const categoryLabel = safeCategoryLabel(ruleMatch.rule.category_label);
    const subcategoryLabel = safeSubcategoryLabel(ruleMatch.rule.subcategory_label);
    const finalMemberId =
      toNullableUuid(ruleMatch.rule.member_id) || memberMatch?.member_id || null;

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

  const categories = await listOrganizationCategories(db, params.organizationId);
  let aiResult:
    | {
        category: string;
        confidence: number;
        member: string | null;
        provider: string;
        model: string;
        key_source: 'organization' | 'system';
        usage_tokens: number;
      }
    | null = null;

  try {
    aiResult = await classifyTransactionWithAi({
      organizationId: params.organizationId,
      description: params.description || normalizedDescription,
      categories,
      members,
      db,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        organization_id: params.organizationId,
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
  const aiMemberMatch = findMemberByAiSuggestion(members, aiResult.member);

  if (aiResult.key_source === 'system') {
    logger.info(
      {
        source: 'ai_classification',
        organization_id: params.organizationId,
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
        organizationId: params.organizationId,
        description: params.description || normalizedDescription,
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
          organization_id: params.organizationId,
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

export async function classifyTransactions(
  params: ClassifyTransactionsParams
): Promise<Record<string, unknown>[]> {
  const db = params.db || (pool as Queryable);
  const transactions = Array.isArray(params.transactions) ? params.transactions : [];
  const output: Record<string, unknown>[] = [];

  for (const transaction of transactions) {
    const description =
      String(transaction.raw_description || '') ||
      String(transaction.description || '') ||
      String(transaction.concept || '');

    const classification = await classifyTransaction({
      organizationId: params.organizationId,
      description,
      db,
      incrementRuleUsage: params.incrementRuleUsage !== false,
    });

    output.push({
      ...transaction,
      category:
        safeCategoryLabel(transaction.category) ||
        safeCategoryLabel(classification.category) ||
        safeCategoryLabel(transaction.concept) ||
        'uncategorized',
      category_id: toNullableUuid(transaction.category_id) || classification.category_id,
      subcategory_id:
        toNullableUuid(transaction.subcategory_id) || classification.subcategory_id,
      member_id: toNullableUuid(transaction.member_id) || classification.member_id,
      member_name: safeCategoryLabel(transaction.member_name) || classification.member_name,
      is_payroll_candidate:
        typeof transaction.is_payroll_candidate === 'boolean'
          ? transaction.is_payroll_candidate
          : classification.is_payroll_candidate,
      confidence_score: Number(
        toFiniteNumber(transaction.confidence_score, classification.confidence_score).toFixed(4)
      ),
      classification_status: classification.classification_status,
      classification_source:
        String(transaction.classification_source || '').trim() ||
        classification.classification_source,
      classification_match_type: classification.matched_by,
      classification_rule_id: classification.matched_rule_id,
      ai_provider: String(transaction.ai_provider || '').trim() || classification.ai_provider,
      ai_model: String(transaction.ai_model || '').trim() || classification.ai_model,
      ai_usage_tokens: Number(
        toFiniteNumber(transaction.ai_usage_tokens, classification.ai_usage_tokens).toFixed(0)
      ),
      normalized_description: classification.normalized_description,
      keyword_pattern: classification.keyword_pattern,
    });
  }

  return output;
}

export async function learnRuleFromManualCategorization(
  params: LearnRuleParams
): Promise<Record<string, unknown> | null> {
  const db = params.db || (pool as Queryable);
  const normalizedDescription = normalizeDescription(params.description);
  const keywordPattern = buildKeywordPattern(normalizedDescription);
  const categoryLabel = safeCategoryLabel(params.category);

  if (!keywordPattern || !categoryLabel) {
    return null;
  }

  const resolvedCategoryId = ensureCategoryId(params.categoryId, categoryLabel);
  const resolvedSubcategoryId = toNullableUuid(params.subcategoryId);
  const resolvedMemberId = toNullableUuid(params.memberId);
  const safeConfidence = confidenceToRange(params.confidenceScore, 1);

  try {
    const existingResult = await db.query<{ id: string }>({
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
        params.organizationId,
        keywordPattern,
        resolvedCategoryId,
        resolvedSubcategoryId,
        resolvedMemberId,
        categoryLabel,
      ],
    });

    const existing = existingResult.rows[0];
    if (existing) {
      await db.query(
        `
          UPDATE finance.transaction_rules
          SET
            confidence_score = GREATEST(confidence_score, $2),
            times_applied = times_applied + 1
          WHERE id = $1
        `,
        [existing.id, safeConfidence]
      );

      return {
        id: existing.id,
        keyword_pattern: keywordPattern,
        category_id: resolvedCategoryId,
        subcategory_id: resolvedSubcategoryId,
        member_id: resolvedMemberId,
        category: categoryLabel,
      };
    }

    const insertResult = await db.query<RuleRow>({
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
        params.organizationId,
        keywordPattern,
        resolvedCategoryId,
        resolvedSubcategoryId,
        resolvedMemberId,
        categoryLabel,
        safeConfidence,
      ],
    });

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
