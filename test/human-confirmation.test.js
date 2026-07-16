const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {openDatabase,initializeDatabase}=require('../lib/db');
const {createScopeAttestation}=require('../lib/queries/finance/scope');
const {createHumanConfirmation,listHumanConfirmations,confirmHumanConfirmation,consumeHumanConfirmation}=require('../lib/queries/finance/human-confirmations');

function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'last-say-confirm-'));const db=openDatabase(path.join(dir,'test.sqlite'));initializeDatabase(db);try{return run(db);}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}}
function payload(){return{entity_key:'personal',scope_kind:'cash_accounts',as_of_date:'2026-07-14',coverage_state:'declared_complete',authority:'user_confirmed'};}

test('actor label or arbitrary receipt cannot authorize declared_complete',()=>fixture(db=>{
  assert.throws(()=>createScopeAttestation(payload(),{type:'human'},db),error=>error.code==='HUMAN_CONFIRMATION_REQUIRED');
  assert.throws(()=>createScopeAttestation(payload(),{type:'human'},db,{action_kind:'declare_scope_complete',consumed_at:new Date().toISOString()}),error=>error.code==='HUMAN_CONFIRMATION_REQUIRED');
  const proposal=createHumanConfirmation({action_kind:'declare_scope_complete',resource_type:'scope_attestation',payload:payload()},db);
  assert.throws(()=>confirmHumanConfirmation(proposal.proposal_key,{},db),error=>error.code==='HUMAN_CONFIRMATION_REQUIRED');
  assert.throws(()=>consumeHumanConfirmation({action_kind:'declare_scope_complete',resource_type:'scope_attestation',resource_key:null,payload:payload(),expected_version:null,proposal_key:proposal.proposal_key,confirmation_receipt:'forged'},()=>null,db),error=>error.code==='HUMAN_CONFIRMATION_REQUIRED');
}));

test('receipt is bound to payload/version, one-time, and commits atomically',()=>fixture(db=>{
  const body=payload();const proposal=createHumanConfirmation({action_kind:'declare_scope_complete',resource_type:'scope_attestation',payload:body},db);const confirmed=confirmHumanConfirmation(proposal.proposal_key,{browserConfirmed:true},db);
  const envelope={action_kind:'declare_scope_complete',resource_type:'scope_attestation',resource_key:null,payload:{...body,as_of_date:'2026-07-13'},expected_version:null,proposal_key:proposal.proposal_key,confirmation_receipt:confirmed.confirmation_receipt};
  assert.throws(()=>consumeHumanConfirmation(envelope,()=>null,db),/payload or version changed/);
  envelope.payload=body;const result=consumeHumanConfirmation(envelope,authorization=>createScopeAttestation(body,{type:'human_ui'},db,authorization),db);assert.equal(result.coverage_state,'declared_complete');
  assert.throws(()=>consumeHumanConfirmation(envelope,()=>null,db),/already consumed/);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM data_change_log WHERE resource_type='human_confirmation'").get().count,1);
}));

test('expired confirmation fails closed and leaves the pending queue',()=>fixture(db=>{const old=new Date('2026-07-14T00:00:00Z');const proposal=createHumanConfirmation({action_kind:'declare_scope_complete',resource_type:'scope_attestation',payload:payload()},db,old);assert.throws(()=>confirmHumanConfirmation(proposal.proposal_key,{browserConfirmed:true},db,new Date('2026-07-14T00:11:00Z')),/expired/);assert.equal(db.prepare('SELECT status FROM human_confirmation_requests WHERE proposal_key=?').get(proposal.proposal_key).status,'expired');}));

test('confirmation list evaluates expiry without writing through a read model',()=>fixture(db=>{
  const createdAt=new Date('2026-07-14T00:00:00Z');
  const proposal=createHumanConfirmation({action_kind:'declare_scope_complete',resource_type:'scope_attestation',payload:payload()},db,createdAt);
  db.exec('PRAGMA query_only=ON');
  const now=new Date('2026-07-14T00:11:00Z');
  assert.equal(listHumanConfirmations({status:'pending',now},db).length,0);
  assert.equal(listHumanConfirmations({status:'expired',now},db)[0].proposal_key,proposal.proposal_key);
  assert.equal(listHumanConfirmations({status:'all',now},db)[0].status,'expired');
  assert.equal(db.prepare('SELECT status FROM human_confirmation_requests WHERE proposal_key=?').get(proposal.proposal_key).status,'pending');
}));
