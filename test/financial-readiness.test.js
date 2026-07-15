const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db'); const { createAccount } = require('../lib/queries/finance/accounts'); const { createSource } = require('../lib/queries/finance/sources');
const { createInstrument, createHolding, createMarketQuote } = require('../lib/queries/finance/investments'); const { readinessForGoal } = require('../lib/queries/finance/inventory');
const { createBalanceSnapshot } = require('../lib/queries/finance/balances');

test('investment readiness distinguishes missing and stale quotes',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'last-say-ready-'));const db=openDatabase(path.join(dir,'test.sqlite'));initializeDatabase(db);try{
  const account=createAccount({display_name:'Broker',account_kind:'investment',currency:'TWD',authority:'user_confirmed',review_state:'confirmed'}, {},db); const statement=createSource({source_kind:'brokerage_statement',description:'Holdings',account_key:account.account_key,authority:'official'}, {},db); const quoteSource=createSource({source_kind:'market_quote_evidence',description:'Quote evidence',authority:'ai_researched'}, {},db);
  const missing=createInstrument({instrument_type:'etf',name:'Missing Quote ETF',symbol:'MISS',exchange:'TEST',quote_currency:'TWD',authority:'official'}, {},db); createHolding({account_key:account.account_key,instrument_key:missing.instrument_key,source_key:statement.source_key,as_of_date:'2026-06-30',quantity_decimal:'1',currency:'TWD',authority:'official'}, {},db);
  let readiness=readinessForGoal('investment_value',{asOfDate:'2026-07-14'},db); assert.ok(readiness.gaps.some(gap=>gap.gap==='investment_missing_quote'));
  createMarketQuote({instrument_key:missing.instrument_key,source_key:quoteSource.source_key,price_decimal:'100',quote_currency:'TWD',as_of_date:'2026-03-31',quote_type:'close',provider:'Old',authority:'ai_researched'}, {},db);
  readiness=readinessForGoal('investment_value',{asOfDate:'2026-07-14'},db); assert.equal(readiness.status,'stale'); assert.ok(readiness.gaps.some(gap=>gap.gap==='investment_stale'));
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}});

test('readiness policy covers every initial goal and account scope does not claim global completeness',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'last-say-ready-policy-'));const db=openDatabase(path.join(dir,'test.sqlite'));initializeDatabase(db);try{
  const account=createAccount({display_name:'Scoped cash',account_kind:'bank',currency:'TWD',authority:'user_confirmed',review_state:'confirmed'}, {},db);createBalanceSnapshot({account_key:account.account_key,as_of_date:'2026-07-14',observed_at:'2026-07-14T00:00:00Z',balance_kind:'ledger',amount_minor:'500000',currency:'TWD',authority:'user_confirmed',review_state:'confirmed'}, {},db);
  const goals=['spending_history','cash_position','net_worth','debt_obligations','investment_value','cash_flow_statement','liquidity_forecast_90d','tax_or_derivatives'];for(const goal of goals){const result=readinessForGoal(goal,{asOfDate:'2026-07-14'},db);assert.equal(result.policy_version,'finance-readiness/1');assert.ok(Array.isArray(result.requirements));assert.ok(result.source_watermark);assert.ok(result.gaps.every(gap=>gap.priority&&gap.impact&&gap.effort_hint&&gap.next_action));}
  const scoped=readinessForGoal('cash_position',{asOfDate:'2026-07-14',accountKey:account.account_key},db);assert.equal(scoped.status,'complete');assert.deepEqual(scoped.scope,{kind:'account',entity_key:'personal',account_key:account.account_key});assert.equal(scoped.scope_evidence.kind,'account');const tax=readinessForGoal('tax_or_derivatives',{asOfDate:'2026-07-14'},db);assert.equal(tax.status,'unsupported');assert.equal(tax.gaps[0].gap,'separate_context_required');
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}});

test('cash-flow readiness does not call snapshots without cash activity complete',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'last-say-ready-cash-flow-'));const db=openDatabase(path.join(dir,'test.sqlite'));initializeDatabase(db);try{
  const account=createAccount({display_name:'Synthetic cash',account_kind:'bank',currency:'TWD',authority:'user_confirmed',review_state:'confirmed'}, {},db);
  createBalanceSnapshot({account_key:account.account_key,as_of_date:'2026-06-01',observed_at:'2026-06-01T00:00:00Z',balance_kind:'ledger',amount_minor:'500000',currency:'TWD',authority:'user_confirmed',review_state:'confirmed'}, {},db);
  createBalanceSnapshot({account_key:account.account_key,as_of_date:'2026-06-30',observed_at:'2026-06-30T00:00:00Z',balance_kind:'ledger',amount_minor:'500000',currency:'TWD',authority:'user_confirmed',review_state:'confirmed'}, {},db);
  const readiness=readinessForGoal('cash_flow_statement',{asOfDate:'2026-06-30',accountKey:account.account_key},db);
  assert.notEqual(readiness.status,'complete');
  assert.ok(readiness.gaps.some((gap)=>gap.gap==='no_cash_activity'));
  assert.equal(readiness.evidence.cash_activity_rows,0);
  assert.equal(readiness.report_available,true);
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}});
