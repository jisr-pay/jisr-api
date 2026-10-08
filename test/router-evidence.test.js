import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHorizonLookup } from '../src/evidence.js';
import { openStore } from '../src/store.js';
import { createReconciler } from '../src/reconcile.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures-router-payment.json',import.meta.url)));
const policy={contractId:'CCGSUUQLWXKU6AZ6YKUNXLR7R6KLBYBG4AJGJ54XV4DC63AJ3LDVPNW4',tokenAddress:'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',treasuryAddress:'GBHS7NUWCDQAQSC2DFM5E7BBYRD74KVJPCVE3OVYMU7LBQDSJBY34AAP',feeBps:125};
const record={hash:fixture.txHash,network:'TESTNET',asset:'XLM',sender:'GB34YRHMR75TG554F7PUUKOPNZZVNCNW3BGO3VN7N5E2C3DOC2DSXWY2',recipient:'GBSRRMJVNL2L66LZKZNHNAZDDJ7XXOJ65HC7Z52A4HG7PT7QJG5MFP24',amount:'1',contractId:policy.contractId,submittedAt:'2026-10-08T13:18:10.000Z'};
function adapter({rpc=fixture,ledger=fixture.ledger,wrongNetwork=false,rpcUnavailable=false}={}) {
 return createHorizonLookup({horizonUrl:'https://horizon.invalid',rpcUrl:'https://rpc.invalid',routerPolicy:policy,fetcher:async(url,opts)=>{
  if(url.startsWith('https://rpc.invalid')){if(rpcUnavailable)throw new Error('timeout');const req=JSON.parse(opts.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:req.method==='getNetwork'?{passphrase:wrongNetwork?'wrong':'Test SDF Network ; September 2015'}:rpc}));}
  const body=url.includes('/operations')?{_embedded:{records:[]}}:url.includes('/transactions/')?{id:record.hash,hash:record.hash,source_account:record.sender,successful:true,ledger,fee_charged:'100',created_at:'2026-10-08T13:18:10Z'}:{network_passphrase:'Test SDF Network ; September 2015'};
  return new Response(JSON.stringify(body));
 }});
}
test('configured router invocation and fee evidence confirms a durable transfer',async t=>{const store=openStore(':memory:');t.after(()=>store.close());store.register(record);const result=await createReconciler(store,adapter())(record.hash);assert.equal(result.outcome,'confirmed');assert.equal(store.get(record.hash).status,'confirmed');});
test('unknown, mismatched, incomplete and duplicate contract evidence stays pending',async t=>{
 const duplicate=structuredClone(fixture);duplicate.events.contractEventsXdr[0].push(duplicate.events.contractEventsXdr[0][0]);
 for(const setup of [{rpc:{status:'NOT_FOUND'}},{rpc:{...fixture,txHash:'a'.repeat(64)}},{rpc:{...fixture,events:{}}},{rpc:duplicate},{ledger:fixture.ledger+1}]){const store=openStore(':memory:');try{store.register(record);assert.equal((await createReconciler(store,adapter(setup))(record.hash)).outcome,'unverified_payment');assert.equal(store.get(record.hash).status,'pending');}finally{store.close();}}
});
test('RPC timeouts and wrong network identity cannot settle a payment',async()=>{for(const setup of [{wrongNetwork:true},{rpcUnavailable:true}]){const store=openStore(':memory:');try{store.register(record);assert.equal((await createReconciler(store,adapter(setup))(record.hash)).outcome,'unavailable');assert.equal(store.get(record.hash).status,'pending');}finally{store.close();}}});
test('unconfigured and incomplete router configuration fail closed',()=>{assert.throws(()=>createHorizonLookup({horizonUrl:'https://horizon.invalid',routerPolicy:policy}),/together/);assert.throws(()=>createHorizonLookup({horizonUrl:'https://horizon.invalid',rpcUrl:'https://rpc.invalid'}),/together/);});
