import test from 'node:test';import assert from 'node:assert/strict';
import {assertDevPermission,assertMaintenanceChange} from '../runtime/venture/playbooks/dev-agency/permission.ts';
const now='2026-10-29T12:00:00.000Z',permission={owner:'Client owner',system:'repo:client/shop',startsAt:'2026-10-28T00:00:00.000Z',endsAt:'2026-11-01T00:00:00.000Z',writtenFileId:'permission-file',writtenDigest:'a'.repeat(64)};
test('security work requires current written scoped permission before any local scan, never a live target',()=>{
 assert.throws(()=>assertDevPermission(null,{system:permission.system,now,writtenFileId:permission.writtenFileId,writtenDigest:permission.writtenDigest}),{code:'PERMISSION_REQUIRED'});
 assert.equal(assertDevPermission(permission,{system:permission.system,now,writtenFileId:permission.writtenFileId,writtenDigest:permission.writtenDigest}),true);
 for(const changed of [{system:'repo:another/shop'},{now:permission.endsAt},{writtenDigest:'b'.repeat(64)},{liveTarget:true}])assert.throws(()=>assertDevPermission(permission,{system:permission.system,now,writtenFileId:permission.writtenFileId,writtenDigest:permission.writtenDigest,...changed}));
});
test('maintenance first seven elapsed days permit reports only; changed timezone dates do not shorten week',()=>{
 assert.throws(()=>assertMaintenanceChange('maintenance-retainer','2026-10-23T12:00:00.000Z',now,'patch'),{code:'FIRST_WEEK_REPORT_ONLY'});
 assert.doesNotThrow(()=>assertMaintenanceChange('maintenance-retainer','2026-10-23T12:00:00.000Z',now,'report'));
 assert.doesNotThrow(()=>assertMaintenanceChange('maintenance-retainer','2026-10-22T12:00:00.000Z',now,'patch'));
 assert.throws(()=>assertMaintenanceChange('maintenance-retainer','nonsense',now,'patch'),{code:'INVALID_VENTURE_REQUEST'});
});
