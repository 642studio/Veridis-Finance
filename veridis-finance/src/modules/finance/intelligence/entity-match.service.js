const pool = require('../../../db/pool');
const logger = require('../../../logger');
const { normalizeString } = require('./utils/string-normalizer');

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const STOP_AFTER_MARKER_TOKENS = new Set([
  'REFERENCIA',
  'RFC',
  'COMISION',
  'CONCEPTO',
  'SALDO',
  'FOLIO',
  'CLABE',
  'BANCO',
]);

function normalizeForScan(input) {
  return String(input || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenMatchStats(entityName, description) {
  const entityTokens = Array.from(new Set(normalizeString(entityName)));
  const descriptionTokens = new Set(normalizeString(description));

  if (!entityTokens.length) {
    return {
      overlappingTokens: 0,
      totalEntityTokens: 0,
      score: 0,
      matched: false,
    };
  }

  const overlappingTokens = entityTokens.filter((token) =>
    descriptionTokens.has(token)
  ).length;

  const score = overlappingTokens / entityTokens.length;
  const matched = overlappingTokens >= 2 || score >= HIGH_CONFIDENCE_THRESHOLD;

  return {
    overlappingTokens,
    totalEntityTokens: entityTokens.length,
    score: Number(score.toFixed(4)),
    matched,
  };
}

function matchTokens(entityName, description) {
  return tokenMatchStats(entityName, description).matched;
}

function effectiveConfidence(stats) {
  if (stats.overlappingTokens >= 2) {
    return Number(Math.max(stats.score, 0.72).toFixed(4));
  }

  return Number(stats.score.toFixed(4));
}

function baseResult() {
  return {
    member_id: null,
    member_name: null,
    client_id: null,
    client_name: null,
    vendor_id: null,
    vendor_name: null,
    match_confidence: null,
    match_method: null,
    entity_link_source: null,
  };
}

function resultForMember(member, confidence, source, method) {
  return {
    ...baseResult(),
    member_id: member.id,
    member_name: member.full_name,
    match_confidence: confidence,
    match_method: method,
    entity_link_source: source,
  };
}

function resultForClient(client, confidence, source, method) {
  return {
    ...baseResult(),
    client_id: client.id,
    client_name: client.name,
    match_confidence: confidence,
    match_method: method,
    entity_link_source: source,
  };
}

function resultForVendor(vendor, confidence, source, method) {
  return {
    ...baseResult(),
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    match_confidence: confidence,
    match_method: method,
    entity_link_source: source,
  };
}

function extractCounterpartyHint(rawDescription, marker) {
  const source = normalizeForScan(rawDescription);
  const normalizedMarker = normalizeForScan(marker);

  if (!source || !normalizedMarker) {
    return '';
  }

  const markerIndex = source.indexOf(normalizedMarker);
  if (markerIndex < 0) {
    return '';
  }

  const tail = source.slice(markerIndex + normalizedMarker.length).trim();
  if (!tail) {
    return '';
  }

  const tokens = tail.split(' ').filter(Boolean);
  const hintTokens = [];

  for (const token of tokens) {
    if (STOP_AFTER_MARKER_TOKENS.has(token)) {
      break;
    }

    hintTokens.push(token);

    if (hintTokens.length >= 8) {
      break;
    }
  }

  return hintTokens.join(' ').trim();
}

function findBestFuzzyMatch(entities, candidate, nameSelector) {
  if (!candidate || !Array.isArray(entities) || entities.length === 0) {
    return null;
  }

  let best = null;

  for (const entity of entities) {
    const name = nameSelector(entity);
    const stats = tokenMatchStats(name, candidate);

    if (!stats.matched) {
      continue;
    }

    const confidence = effectiveConfidence(stats);

    if (!best || confidence > best.confidence) {
      best = {
        entity,
        confidence,
        stats,
      };
    }
  }

  return best;
}

async function listActiveMembers(db, organizationId) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        full_name,
        alias,
        active
      FROM finance.members
      WHERE organization_id = $1
        AND active = true
      ORDER BY full_name ASC
    `,
    values: [organizationId],
  };

  const { rows } = await db.query(query);
  return rows;
}

async function listActiveClients(db, organizationId) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        business_name,
        active
      FROM finance.clients
      WHERE organization_id = $1
        AND active = true
      ORDER BY name ASC
    `,
    values: [organizationId],
  };

  const { rows } = await db.query(query);
  return rows;
}

async function listActiveVendors(db, organizationId) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        type,
        active
      FROM finance.vendors
      WHERE organization_id = $1
        AND active = true
      ORDER BY name ASC
    `,
    values: [organizationId],
  };

  const { rows } = await db.query(query);
  return rows;
}

function logMatchingDecision({
  organizationId,
  transaction,
  result,
  reason,
  loggerInstance,
}) {
  loggerInstance.info(
    {
      source: 'entity_matching',
      organization_id: organizationId,
      transaction_description:
        transaction?.raw_description || transaction?.description || transaction?.concept || null,
      reason,
      member_id: result.member_id,
      client_id: result.client_id,
      vendor_id: result.vendor_id,
      match_confidence: result.match_confidence,
      match_method: result.match_method,
      entity_link_source: result.entity_link_source,
    },
    'Entity matching decision'
  );
}

function manualEntityResult(transaction, members, clients, vendors) {
  const memberId = String(transaction?.member_id || '').trim() || null;
  const clientId = String(transaction?.client_id || '').trim() || null;
  const vendorId = String(transaction?.vendor_id || '').trim() || null;

  if (!memberId && !clientId && !vendorId) {
    return null;
  }

  if (memberId) {
    const member = members.find((item) => item.id === memberId);
    return resultForMember(
      {
        id: memberId,
        full_name: member?.full_name || transaction?.member_name || null,
      },
      1,
      'manual_assignment',
      'manual'
    );
  }

  if (clientId) {
    const client = clients.find((item) => item.id === clientId);
    return resultForClient(
      {
        id: clientId,
        name: client?.name || transaction?.client_name || null,
      },
      1,
      'manual_assignment',
      'manual'
    );
  }

  const vendor = vendors.find((item) => item.id === vendorId);
  return resultForVendor(
    {
      id: vendorId,
      name: vendor?.name || transaction?.vendor_name || null,
    },
    1,
    'manual_assignment',
    'manual'
  );
}

async function matchTransactionToEntity({
  organizationId,
  transaction,
  db = pool,
  members,
  clients,
  vendors,
  loggerInstance = logger,
  minConfidence = HIGH_CONFIDENCE_THRESHOLD,
}) {
  if (!organizationId) {
    throw new Error('organizationId is required for entity matching');
  }

  const [scopedMembers, scopedClients, scopedVendors] = await Promise.all([
    Array.isArray(members) ? Promise.resolve(members) : listActiveMembers(db, organizationId),
    Array.isArray(clients) ? Promise.resolve(clients) : listActiveClients(db, organizationId),
    Array.isArray(vendors) ? Promise.resolve(vendors) : listActiveVendors(db, organizationId),
  ]);

  const manualResult = manualEntityResult(
    transaction,
    scopedMembers,
    scopedClients,
    scopedVendors
  );

  if (manualResult) {
    logMatchingDecision({
      organizationId,
      transaction,
      result: manualResult,
      reason: 'manual_assignment_preserved',
      loggerInstance,
    });
    return manualResult;
  }

  const description =
    String(transaction?.raw_description || transaction?.description || transaction?.concept || '').trim();
  const normalizedDescription = normalizeForScan(description);

  if (!normalizedDescription) {
    const emptyResult = baseResult();
    logMatchingDecision({
      organizationId,
      transaction,
      result: emptyResult,
      reason: 'empty_description',
      loggerInstance,
    });
    return emptyResult;
  }

  if (normalizedDescription.includes('SPEI RECIBIDO DE')) {
    const hint = extractCounterpartyHint(normalizedDescription, 'SPEI RECIBIDO DE');

    const bestClient = findBestFuzzyMatch(
      scopedClients,
      hint,
      (client) => [client.business_name, client.name].filter(Boolean).join(' ')
    );
    if (bestClient && bestClient.confidence >= minConfidence) {
      const matched = resultForClient(
        bestClient.entity,
        bestClient.confidence,
        'spei_recibido_client',
        'fuzzy'
      );

      logMatchingDecision({
        organizationId,
        transaction,
        result: matched,
        reason: 'spei_recibido_client',
        loggerInstance,
      });
      return matched;
    }
  }

  if (normalizedDescription.includes('SPEI ENVIADO A')) {
    const hint = extractCounterpartyHint(normalizedDescription, 'SPEI ENVIADO A');

    const bestMember = findBestFuzzyMatch(scopedMembers, hint, (member) =>
      [member.full_name, member.alias].filter(Boolean).join(' ')
    );

    if (bestMember && bestMember.confidence >= minConfidence) {
      const matched = resultForMember(
        bestMember.entity,
        bestMember.confidence,
        'spei_enviado_member',
        'fuzzy'
      );

      logMatchingDecision({
        organizationId,
        transaction,
        result: matched,
        reason: 'spei_enviado_member',
        loggerInstance,
      });
      return matched;
    }
  }

  if (
    normalizedDescription.includes('FACEBK') ||
    normalizedDescription.includes('FACEBOOK')
  ) {
    const adsVendors = scopedVendors.filter(
      (vendor) => String(vendor.type || '').toLowerCase() === 'ads'
    );

    const vendorPool = adsVendors.length ? adsVendors : scopedVendors;
    const bestFacebookVendor = findBestFuzzyMatch(
      vendorPool,
      'FACEBOOK ADS META FACEBK',
      (vendor) => vendor.name
    );

    if (bestFacebookVendor && bestFacebookVendor.confidence >= minConfidence) {
      const matched = resultForVendor(
        bestFacebookVendor.entity,
        Number(Math.max(bestFacebookVendor.confidence, 0.9).toFixed(4)),
        'vendor_facebook_ads',
        'rule'
      );

      logMatchingDecision({
        organizationId,
        transaction,
        result: matched,
        reason: 'facebook_vendor_rule',
        loggerInstance,
      });
      return matched;
    }
  }

  if (normalizedDescription.includes('CLICKUP')) {
    const bestClickUpVendor = findBestFuzzyMatch(
      scopedVendors,
      'CLICKUP',
      (vendor) => vendor.name
    );

    if (bestClickUpVendor && bestClickUpVendor.confidence >= minConfidence) {
      const matched = resultForVendor(
        bestClickUpVendor.entity,
        Number(Math.max(bestClickUpVendor.confidence, 0.92).toFixed(4)),
        'vendor_clickup',
        'rule'
      );

      logMatchingDecision({
        organizationId,
        transaction,
        result: matched,
        reason: 'clickup_vendor_rule',
        loggerInstance,
      });
      return matched;
    }
  }

  if (normalizedDescription.includes('CANVA')) {
    const bestCanvaVendor = findBestFuzzyMatch(scopedVendors, 'CANVA', (vendor) => vendor.name);

    if (bestCanvaVendor && bestCanvaVendor.confidence >= minConfidence) {
      const matched = resultForVendor(
        bestCanvaVendor.entity,
        Number(Math.max(bestCanvaVendor.confidence, 0.92).toFixed(4)),
        'vendor_canva',
        'rule'
      );

      logMatchingDecision({
        organizationId,
        transaction,
        result: matched,
        reason: 'canva_vendor_rule',
        loggerInstance,
      });
      return matched;
    }
  }

  const unmatched = baseResult();
  logMatchingDecision({
    organizationId,
    transaction,
    result: unmatched,
    reason: 'no_high_confidence_match',
    loggerInstance,
  });

  return unmatched;
}

module.exports = {
  normalizeForScan,
  matchTokens,
  tokenMatchStats,
  matchTransactionToEntity,
};
