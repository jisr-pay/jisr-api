import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createApi } from '../src/server.js';
import { createHorizonLookup } from '../src/evidence.js';
import { openStore } from '../src/store.js';
const sdk=JSON.parse(readFileSync('../jisr-sdk/docs/sdk-router-payment-2026-10-08.json'));
const record={...sdk.claim,network:'TESTNET',asset:'XLM',submittedAt:sdk.checkedAt};
const lookup=createHorizonLookup({horizonUrl:'https://horizon-testnet.stellar.org',rpcUrl:'https://soroban-testnet.stellar.org',routerPolicy:sdk.policy});
const store=openStore(':memory:'),token=randomBytes(32).toString('hex');
const server=createApi({store,token,lookup,timeoutMs:30000});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 const base=`http://127.0.0.1:${server.address().port}/v1/transfers`;
 const request=async(url,body)=>{const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)});return {status:response.status,body:await response.json()};};
 const registered=await request(base,record);assert.equal(registered.status,201);
 const reconciled=await request(`${base}/${record.hash}/reconcile`,{});assert.equal(reconciled.status,200);assert.equal(reconciled.body.outcome,'confirmed');assert.equal(store.get(record.hash).status,'confirmed');
 const wrong=await lookup({...record,amount:'1.0000001'});assert.equal(wrong.paymentVerified,false);
 const report={checkedAt:new Date().toISOString(),record,registrationStatus:registered.status,reconciliation:{httpStatus:reconciled.status,outcome:reconciled.body.outcome,status:reconciled.body.record.status},wrongAmountRejected:!wrong.paymentVerified,ledger:reconciled.body.record.settlement.ledger,timeoutMs:30000,note:'Real SDK-created Testnet payment, checked through local HTTP API and live Horizon/RPC. Service token and signing keys are not retained. This does not establish deployed API or Freighter acceptance.'};
 writeFileSync('docs/router-http-verification-2026-10-08.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({hash:record.hash,...report.reconciliation,wrongAmountRejected:true}));
} finally {await new Promise(resolve=>server.close(resolve));store.close();}
