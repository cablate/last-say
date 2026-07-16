const { createInstitution } = require('../../../lib/queries/finance/institutions');
const { createAccount } = require('../../../lib/queries/finance/accounts');
const { createSource } = require('../../../lib/queries/finance/sources');
const { createBalanceSnapshot } = require('../../../lib/queries/finance/balances');
const { createScopeAttestation, createSourceExpectation } = require('../../../lib/queries/finance/scope');
const { createCreditCardProfile, createCardStatement, createLiability, createCommitment, createOccurrence } = require('../../../lib/queries/finance/obligations');
const { createInstrument, createHolding, createMarketQuote, createFxQuote } = require('../../../lib/queries/finance/investments');
const { createValuedItem, createValuation } = require('../../../lib/queries/finance/valued-items');
const { createSourceConflict } = require('../../../lib/queries/finance/source-conflicts');

const ACTOR = { type: 'system', note: 'Anonymized foundation demo seed' };

function seedFoundationDemo(db) {
  const institution = createInstitution({ display_name: 'North Harbor Demo Bank', institution_type: 'bank', country_code: 'TW' }, ACTOR, db);
  const bank = createAccount({ display_name: 'Daily cash account', institution_key: institution.institution_key, account_kind: 'bank', currency: 'TWD', masked_number: '****2468', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  const card = createAccount({ display_name: 'Everyday rewards card', institution_key: institution.institution_key, account_kind: 'credit_card', currency: 'TWD', masked_number: '****3579', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  const loan = createAccount({ display_name: 'Home improvement loan', institution_key: institution.institution_key, account_kind: 'loan', currency: 'TWD', masked_number: '****8080', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  const broker = createAccount({ display_name: 'Long-term investment account', account_kind: 'investment', currency: 'USD', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);

  const bankSource = createSource({ source_kind: 'bank_statement_csv', description: 'Anonymized June bank statement', account_key: bank.account_key, authority: 'institution_export', review_state: 'reviewed', period_start: '2026-06-01', period_end: '2026-06-30' }, ACTOR, db);
  const cardSource = createSource({ source_kind: 'credit_card_statement_csv', description: 'Anonymized June card statement', account_key: card.account_key, authority: 'official', review_state: 'confirmed', period_start: '2026-05-21', period_end: '2026-06-20', is_official: true }, ACTOR, db);
  const loanSource = createSource({ source_kind: 'loan_statement', description: 'Anonymized loan statement', account_key: loan.account_key, authority: 'official', review_state: 'confirmed', as_of_at: '2026-06-30T00:00:00Z', is_official: true }, ACTOR, db);
  const holdingSource = createSource({ source_kind: 'brokerage_statement', description: 'Anonymized brokerage holdings', account_key: broker.account_key, authority: 'official', review_state: 'confirmed', as_of_at: '2026-06-30T00:00:00Z' }, ACTOR, db);
  const quoteSource = createSource({ source_kind: 'market_quote_evidence', description: 'Public demo market quote', authority: 'ai_researched', review_state: 'reviewed', as_of_at: '2026-07-14T00:00:00Z' }, ACTOR, db);
  const fxSource = createSource({ source_kind: 'fx_quote_evidence', description: 'Public demo FX quote', authority: 'ai_researched', review_state: 'reviewed', as_of_at: '2026-07-14T00:00:00Z' }, ACTOR, db);
  const valuationSource = createSource({ source_kind: 'manual_note', description: 'Anonymized owner estimate', authority: 'user_confirmed', review_state: 'confirmed', as_of_at: '2026-06-30T00:00:00Z' }, ACTOR, db);
  const alternateValuationSource = createSource({ source_kind: 'manual_note', description: 'Anonymized comparable estimate', authority: 'ai_researched', review_state: 'needs_review', as_of_at: '2026-06-30T00:00:00Z' }, ACTOR, db);

  createBalanceSnapshot({ account_key: bank.account_key, source_key: bankSource.source_key, as_of_date: '2026-05-31', observed_at: '2026-06-01T00:00:00Z', balance_kind: 'statement', amount_minor: '4862300', currency: 'TWD', authority: 'official', review_state: 'confirmed' }, ACTOR, db);
  createBalanceSnapshot({ account_key: bank.account_key, source_key: bankSource.source_key, as_of_date: '2026-06-30', observed_at: '2026-07-01T00:00:00Z', balance_kind: 'statement', amount_minor: '5328400', currency: 'TWD', authority: 'official', review_state: 'confirmed' }, ACTOR, db);
  createBalanceSnapshot({ account_key: loan.account_key, source_key: loanSource.source_key, as_of_date: '2026-06-30', observed_at: '2026-07-01T00:00:00Z', balance_kind: 'principal', amount_minor: '78245000', currency: 'TWD', authority: 'official', review_state: 'confirmed' }, ACTOR, db);

  const profile = createCreditCardProfile({ account_key: card.account_key, statement_close_day: 20, payment_due_day: 8, credit_limit_minor: '12000000', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  createCardStatement({ profile_key: profile.profile_key, source_key: cardSource.source_key, period_start: '2026-05-21', period_end: '2026-06-20', close_date: '2026-06-20', due_date: '2026-07-08', statement_balance_minor: '1846200', minimum_due_minor: '184620', full_due_minor: '1846200', currency: 'TWD', authority: 'official', review_state: 'confirmed', items: [] }, ACTOR, db);
  createLiability({ account_key: loan.account_key, source_key: loanSource.source_key, liability_kind: 'amortizing_loan', original_principal_minor: '90000000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.0235', apr_as_of: '2026-06-30', start_date: '2025-09-01', maturity_date: '2030-08-31', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, ACTOR, db);
  const commitment = createCommitment({ entity_key: 'personal', commitment_kind: 'rent', direction: 'out', amount_kind: 'fixed', amount_minor: '1860000', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', next_due_date: '2026-08-01', status: 'scheduled', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  createOccurrence(commitment.commitment_key, { due_date: '2026-07-01', amount_minor: '1860000', occurrence_status: 'settled' }, ACTOR, db);

  const instrument = createInstrument({ instrument_type: 'etf', name: 'Harbor Global Equity Fund', symbol: 'HGEF', exchange: 'DEMO', quote_currency: 'USD', authority: 'official', review_state: 'confirmed' }, ACTOR, db);
  createHolding({ account_key: broker.account_key, instrument_key: instrument.instrument_key, source_key: holdingSource.source_key, as_of_date: '2026-06-30', quantity_decimal: '37.42', reported_cost_basis_minor: '402850', currency: 'USD', authority: 'official', review_state: 'confirmed' }, ACTOR, db);
  createMarketQuote({ instrument_key: instrument.instrument_key, source_key: quoteSource.source_key, price_decimal: '118.73', quote_currency: 'USD', as_of_date: '2026-07-14', quote_type: 'close', provider: 'Demo Market Data', authority: 'ai_researched', confidence: 0.94, review_state: 'reviewed' }, ACTOR, db);
  createFxQuote({ source_key: fxSource.source_key, base_currency: 'USD', quote_currency: 'TWD', rate_decimal: '32.41', as_of_date: '2026-07-14', provider: 'Demo FX Data', authority: 'ai_researched', confidence: 0.96, review_state: 'reviewed' }, ACTOR, db);

  const valuedItem = createValuedItem({ item_type: 'vehicle', display_name: 'Household vehicle', position: 'asset', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  createValuation(valuedItem.item_key, { source_key: valuationSource.source_key, as_of_date: '2026-06-30', value_minor: '63800000', currency: 'TWD', valuation_method: 'user_estimate', authority: 'user_confirmed', review_state: 'confirmed', note: 'Anonymized demo estimate.' }, ACTOR, db);
  createSourceConflict({ target_context: 'valuation', semantic_key: 'demo:vehicle:2026-06-30', left_source_key: valuationSource.source_key, right_source_key: alternateValuationSource.source_key, authority: 'ai_inferred', review_state: 'needs_review', reason: 'Synthetic valuation sources disagree.', impact_note: 'The vehicle valuation remains conflicted until one source is selected.' }, ACTOR, db);

  for (const scopeKind of ['cash_accounts', 'credit_cards', 'liabilities', 'investments', 'valued_items']) {
    createScopeAttestation({ entity_key: 'personal', scope_kind: scopeKind, as_of_date: '2026-07-14', coverage_state: 'declared_partial', included_note: 'Anonymized demo inventory; intentionally partial.', authority: 'user_confirmed', review_state: 'confirmed' }, ACTOR, db);
  }
  createSourceExpectation({ entity_key: 'personal', account_key: bank.account_key, target_context: 'account_balance', expected_source_kind: 'bank_statement_csv', cadence: 'monthly', grace_days: 10, period_anchor: 'month_end', active: true, authority: 'user_confirmed', review_state: 'confirmed', goals: ['cash_position', 'cash_flow_statement'] }, ACTOR, db);

  return { accounts: 4, sources: 8, open_review_tasks: 1 };
}

module.exports = { seedFoundationDemo };
