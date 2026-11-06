// Independent root review of the provider evidence boundary, with synthetic XML only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tallyData,tallyImportConfirmed} from '../runtime/adapters/accounting/tally-write-xml.ts';
test('review: successful Tally export headers cannot hide a provider error beside empty results',()=>{
 for(const error of ['<LINEERROR>Company unavailable</LINEERROR>','<ERROR>Partial export</ERROR>']){
  const xml='<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY>'+error+'<DATA><COLLECTION/></DATA></BODY></ENVELOPE>';
  assert.throws(()=>tallyData(xml),'An explicit provider error must never authorize an empty existing lookup.');
 }
});
test('review: a Tally import error cannot be hidden behind nominal success counters',()=>{
 const counters='<CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED><LASTVCHID>8</LASTVCHID>';
 assert.throws(()=>tallyImportConfirmed('<RESPONSE>'+counters+'<ERROR>Import refused</ERROR></RESPONSE>'));
});
