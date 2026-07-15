const PROPOSAL_SCHEMA_ID = 'finance.proposal-envelope/v1';

function proposalEnvelope({ kind, owner, action, resourceKeys = [], timelines = [], impact, missingEvidence = [], humanReview = true, reversible = true }) {
  return {
    schema_id: PROPOSAL_SCHEMA_ID,
    proposal_kind: kind,
    target: { owner, action },
    evidence: { resource_keys: [...resourceKeys] },
    impact: { timelines: [...timelines], summary: impact },
    authority: { human_review_required: Boolean(humanReview) },
    missing_evidence: [...missingEvidence],
    recovery: { reversible: Boolean(reversible), instruction: reversible ? 'Use the typed owner resolution or reversal path.' : 'Stop and request owner evidence.' },
  };
}

module.exports = { PROPOSAL_SCHEMA_ID, proposalEnvelope };
