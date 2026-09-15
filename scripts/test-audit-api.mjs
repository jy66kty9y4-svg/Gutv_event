import { startAuditFixture } from './audit-fixture.mjs';
import { runAdminAuditChecks } from './test-audit-admin.mjs';
import { runRequesterAuditChecks } from './test-audit-requester.mjs';

const fixture = await startAuditFixture();
try {
  await runAdminAuditChecks(fixture);
  const result = await runRequesterAuditChecks(fixture);
  console.log(result.results.map(check => 'PASS requester audit: ' + check).join('\n'));
} finally { await fixture.close(); }
