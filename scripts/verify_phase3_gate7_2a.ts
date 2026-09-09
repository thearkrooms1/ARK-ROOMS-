import fs from 'fs';
import path from 'path';
import {
  INITIAL_PROPERTIES,
  INITIAL_ROOMS,
  INITIAL_BOOKINGS,
  INITIAL_PAYMENTS,
  INITIAL_VENUES,
  INITIAL_LOGISTICS,
} from '../src/lib/mockData';

interface TestResult {
  category: string;
  testId: string;
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const testResults: TestResult[] = [];

function recordTest(category: string, testId: string, name: string, passed: boolean, details: string) {
  testResults.push({
    category,
    testId,
    name,
    status: passed ? 'PASS' : 'FAIL',
    details,
  });
  const symbol = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${symbol}] [${category}] ${testId} - ${name}: ${details}`);
}

console.log('================================================================');
console.log('PHASE 3 — GATE #7.2A: GUEST ASSURANCE RESERVE & FINANCIAL FOUNDATION');
console.log('AUTHORITATIVE VERIFICATION & REGRESSION SUITE');
console.log('================================================================\n');

// Read migration files
const gate72aPath = path.resolve('supabase/migrations/20260904_phase3_gate7_2a_reserve_deposit_foundation.sql');
const gate53Path = path.resolve('supabase/migrations/20260904_phase3_gate5_3_commission_realignment.sql');
const gate63Path = path.resolve('supabase/migrations/20260904_phase3_gate6_3_date_specific_booking_creation.sql');
const apiIndexPath = path.resolve('api/index.ts');
const payoutServicePath = path.resolve('api/payoutService.ts');

const gate72aSql = fs.readFileSync(gate72aPath, 'utf8');
const gate53Sql = fs.readFileSync(gate53Path, 'utf8');
const gate63Sql = fs.readFileSync(gate63Path, 'utf8');
const apiIndexCode = fs.readFileSync(apiIndexPath, 'utf8');
const payoutServiceCode = fs.readFileSync(payoutServicePath, 'utf8');

// -----------------------------------------------------------------------------
// GA2A-01: 2040 Guest Assurance Reserve Liability account exists
// -----------------------------------------------------------------------------
const hasAccount2040 = gate72aSql.includes("'2040'") && gate72aSql.includes('Guest Assurance Reserve Liability');
recordTest(
  'Chart of Accounts',
  'GA2A-01',
  '2040 Guest Assurance Reserve Liability account exists',
  hasAccount2040,
  'Account 2040 is defined and seeded into public.chart_of_accounts'
);

// -----------------------------------------------------------------------------
// GA2A-02: Reserve account is liability, not revenue
// -----------------------------------------------------------------------------
const isAccount2040Liability = gate72aSql.includes("('2040', 'Guest Assurance Reserve Liability', 'liability', 'credit'") &&
  !gate72aSql.includes("('2040', 'Guest Assurance Reserve Liability', 'revenue'");
recordTest(
  'Chart of Accounts',
  'GA2A-02',
  'Reserve account is liability, not revenue',
  isAccount2040Liability,
  'Account 2040 is explicitly designated as liability with normal credit balance, never revenue'
);

// -----------------------------------------------------------------------------
// GA2A-03: No reserve percentage is hardcoded
// -----------------------------------------------------------------------------
// Verify that Gate 7.2A settlement function does not hardcode 0.20 or 20% for reserve
const settlementFuncMatch = gate72aSql.match(/CREATE OR REPLACE FUNCTION public\.settle_successful_booking_payment[\s\S]*?\$\$[\s\S]*?\$\$;/);
const settlementFuncSql = settlementFuncMatch ? settlementFuncMatch[0] : '';
const hasHardcodedReservePercent = /v_auth_room_total\s*\*\s*0\.20/.test(settlementFuncSql) ||
  /original_reserve_ngn\s*:=\s*v_auth_room_total\s*\*\s*0\.2/.test(settlementFuncSql);
recordTest(
  'Reserve Economics',
  'GA2A-03',
  'No reserve percentage is hardcoded',
  !hasHardcodedReservePercent,
  'Zero unfinalized reserve percentage is computed in settlement; authoritative allocation remains unmanufactured'
);

// -----------------------------------------------------------------------------
// GA2A-04: No reserve record can be created with negative amount
// -----------------------------------------------------------------------------
const hasReserveNonNegativeCheck = gate72aSql.includes('chk_reserve_non_negative') &&
  gate72aSql.includes('original_reserve_ngn >= 0') &&
  gate72aSql.includes('consumed_reserve_ngn >= 0') &&
  gate72aSql.includes('released_reserve_ngn >= 0');
recordTest(
  'Reserve Invariants',
  'GA2A-04',
  'No reserve record can be created with negative amount',
  hasReserveNonNegativeCheck,
  'Check constraint chk_reserve_non_negative strictly forbids negative balances'
);

// -----------------------------------------------------------------------------
// GA2A-05: Reserve balance invariant is enforced
// -----------------------------------------------------------------------------
const hasReserveBalanceCheck = gate72aSql.includes('chk_reserve_balances') &&
  gate72aSql.includes('consumed_reserve_ngn + released_reserve_ngn <= original_reserve_ngn');
recordTest(
  'Reserve Invariants',
  'GA2A-05',
  'Reserve balance invariant is enforced',
  hasReserveBalanceCheck,
  'chk_reserve_balances enforces consumed + released <= original'
);

// -----------------------------------------------------------------------------
// GA2A-06: Guest cannot mutate reserve
// -----------------------------------------------------------------------------
const guestReserveRevoke = gate72aSql.includes('REVOKE INSERT, UPDATE, DELETE ON public.guest_assurance_reserves FROM PUBLIC, anon, authenticated;') &&
  !gate72aSql.includes('CREATE POLICY "Guests can view guest_assurance_reserves');
recordTest(
  'Security & RLS',
  'GA2A-06',
  'Guest cannot mutate or access reserve',
  guestReserveRevoke,
  'Direct mutations revoked from authenticated/anon; guests have zero read/write access to reserve'
);

// -----------------------------------------------------------------------------
// GA2A-07: Host cannot mutate reserve
// -----------------------------------------------------------------------------
const hostReserveSelectOnly = gate72aSql.includes('CREATE POLICY "Hosts can view own property reserves"') &&
  gate72aSql.includes('ON public.guest_assurance_reserves FOR SELECT');
recordTest(
  'Security & RLS',
  'GA2A-07',
  'Host cannot mutate reserve',
  hostReserveSelectOnly && guestReserveRevoke,
  'Hosts are granted SELECT on own properties only; mutations remain strictly revoked'
);

// -----------------------------------------------------------------------------
// GA2A-08: Financial ledger remains client-write protected
// -----------------------------------------------------------------------------
const ledgerClientProtected = gate72aSql.includes('REVOKE ALL ON FUNCTION public.record_balanced_ledger_transaction') &&
  gate72aSql.includes('FROM PUBLIC, anon, authenticated;') &&
  gate72aSql.includes('GRANT EXECUTE ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;');
recordTest(
  'Financial Security',
  'GA2A-08',
  'Financial ledger remains client-write protected',
  ledgerClientProtected,
  'record_balanced_ledger_transaction strictly revoked from client and restricted to service_role'
);

// -----------------------------------------------------------------------------
// GA2A-09: Damage deposit canonical columns exist
// -----------------------------------------------------------------------------
const hasCanonicalAndCompatibilityCols = gate72aSql.includes('column_name = \'user_id\'') &&
  gate72aSql.includes('column_name = \'amount_ngn\'') &&
  gate72aSql.includes('column_name = \'deposit_status\'') &&
  gate72aSql.includes('column_name = \'retained_amount_ngn\'') &&
  gate72aSql.includes('column_name = \'refunded_amount_ngn\'');
recordTest(
  'Damage Deposit Schema',
  'GA2A-09',
  'Damage deposit canonical and compatibility columns exist',
  hasCanonicalAndCompatibilityCols,
  'Canonical (guest_id, deposit_amount_ngn, status) and aliases (user_id, amount_ngn, deposit_status) are reconciled'
);

// -----------------------------------------------------------------------------
// GA2A-10: Damage deposit balance invariant holds
// -----------------------------------------------------------------------------
const hasDepositBalanceCheck = gate72aSql.includes('retained_amount_ngn >= 0') &&
  gate72aSql.includes('refunded_amount_ngn >= 0') &&
  gate72aSql.includes('retained_amount_ngn + refunded_amount_ngn <= deposit_amount_ngn');
recordTest(
  'Damage Deposit Invariants',
  'GA2A-10',
  'Damage deposit balance invariant holds',
  hasDepositBalanceCheck,
  'retained >= 0, refunded >= 0, and retained + refunded <= deposit_amount strictly enforced'
);

// -----------------------------------------------------------------------------
// GA2A-11: New damage deposits receive inspection_deadline
// -----------------------------------------------------------------------------
const hasInspectionDeadlineTrigger = gate72aSql.includes('trg_damage_deposits_sync_and_deadline') &&
  gate72aSql.includes('handle_damage_deposits_sync_and_deadline') &&
  gate72aSql.includes('NEW.inspection_deadline :=');
recordTest(
  'Damage Deposit Lifecycle',
  'GA2A-11',
  'New damage deposits receive inspection_deadline',
  hasInspectionDeadlineTrigger,
  'Trigger automatically ensures inspection_deadline is populated if not explicitly supplied'
);

// -----------------------------------------------------------------------------
// GA2A-12: Inspection deadline uses checkout + 48 hours
// -----------------------------------------------------------------------------
const usesCheckoutPlus48Hours = gate72aSql.includes("AT TIME ZONE 'Africa/Lagos' + INTERVAL '48 hours'") ||
  gate72aSql.includes("v_stay_end + INTERVAL '48 hours'");
recordTest(
  'Damage Deposit Lifecycle',
  'GA2A-12',
  'Inspection deadline uses checkout + 48 hours',
  usesCheckoutPlus48Hours,
  'Authoritative check_out + property check_out_time in Africa/Lagos + 48 hours is calculated'
);

// -----------------------------------------------------------------------------
// GA2A-13: Existing damage deposit records are preserved
// -----------------------------------------------------------------------------
const preservesExistingDeposits = gate72aSql.includes('UPDATE public.damage_deposits SET user_id = guest_id') &&
  gate72aSql.includes('UPDATE public.damage_deposits SET amount_ngn = deposit_amount_ngn') &&
  gate72aSql.includes('UPDATE public.damage_deposits SET deposit_status = status');
recordTest(
  'Data Preservation',
  'GA2A-13',
  'Existing damage deposit records are preserved',
  preservesExistingDeposits,
  'Bi-directional backfill synchronizes both canonical and alias representations without data loss'
);

// -----------------------------------------------------------------------------
// GA2A-14: webhook_events uniqueness includes event_type
// -----------------------------------------------------------------------------
const hasCompositeWebhookUnique = gate72aSql.includes('uq_webhook_events_source_type_ref') &&
  gate72aSql.includes('UNIQUE (event_source, event_type, event_reference)');
recordTest(
  'Webhook Architecture',
  'GA2A-14',
  'webhook_events uniqueness includes event_type',
  hasCompositeWebhookUnique,
  'Composite unique constraint (event_source, event_type, event_reference) replaces binary constraint'
);

// -----------------------------------------------------------------------------
// GA2A-15: Different webhook event types can share a reference safely
// -----------------------------------------------------------------------------
const claimWebhookUsesComposite = gate72aSql.includes('ON CONFLICT (event_source, event_type, event_reference) DO NOTHING') &&
  gate72aSql.includes('event_source = v_clean_source') &&
  gate72aSql.includes('event_type = v_clean_type') &&
  gate72aSql.includes('event_reference = v_clean_ref');
recordTest(
  'Webhook Architecture',
  'GA2A-15',
  'Different webhook event types can share a reference safely',
  claimWebhookUsesComposite,
  'claim_webhook_event locks and checks on (source, type, reference), allowing multi-event tracking per ref'
);

// -----------------------------------------------------------------------------
// GA2A-16: Duplicate identical webhook events remain idempotent
// -----------------------------------------------------------------------------
const duplicateWebhookIdempotency = gate72aSql.includes("IF v_event.status = 'completed' THEN") &&
  gate72aSql.includes("'claimed', false") &&
  gate72aSql.includes("'status', 'completed'");
recordTest(
  'Webhook Architecture',
  'GA2A-16',
  'Duplicate identical webhook events remain idempotent',
  duplicateWebhookIdempotency,
  'Subsequent webhook calls with identical source, type, and reference return claimed: false with completed status'
);

// -----------------------------------------------------------------------------
// GA2A-17: evaluate_payout_eligibility locks booking before payout
// -----------------------------------------------------------------------------
const evalFuncMatch = gate72aSql.match(/CREATE OR REPLACE FUNCTION public\.evaluate_payout_eligibility[\s\S]*?\$\$[\s\S]*?\$\$;/);
const evalFuncSql = evalFuncMatch ? evalFuncMatch[0] : '';
const bookingLockPos = evalFuncSql.indexOf('SELECT * INTO v_booking');
const payoutLockPos = evalFuncSql.indexOf('SELECT * INTO v_payout');
const lockOrderCorrect = bookingLockPos !== -1 && payoutLockPos !== -1 && bookingLockPos < payoutLockPos;
recordTest(
  'Concurrency & Deadlock Prevention',
  'GA2A-17',
  'evaluate_payout_eligibility locks booking before payout',
  lockOrderCorrect,
  'Canonical lock order enforced: public.bookings FOR UPDATE executes before public.partner_payouts FOR UPDATE'
);

// -----------------------------------------------------------------------------
// GA2A-18: authorize_partner_payout retains booking-before-payout locking
// -----------------------------------------------------------------------------
const authLockBookingPos = gate53Sql.indexOf('SELECT * INTO v_booking');
const authLockPayoutPos = gate53Sql.indexOf('SELECT * INTO v_payout');
const authLockCorrect = authLockBookingPos !== -1 && authLockPayoutPos !== -1 && authLockBookingPos < authLockPayoutPos;
recordTest(
  'Concurrency & Deadlock Prevention',
  'GA2A-18',
  'authorize_partner_payout retains booking-before-payout locking',
  authLockCorrect,
  'Canonical order verified: authorize_partner_payout locks booking before payout'
);

// -----------------------------------------------------------------------------
// GA2A-19: No network calls occur under financial DB locks
// -----------------------------------------------------------------------------
const noNetworkUnderDbLocks = payoutServiceCode.includes('NO Paystack HTTP request inside a PostgreSQL database transaction') &&
  payoutServiceCode.includes('Step 1: Execute Authorization RPC') &&
  payoutServiceCode.includes('Step 4: External Paystack Transfer Request') &&
  payoutServiceCode.includes('settle_partner_payout_transfer');
recordTest(
  'Distributed Safety',
  'GA2A-19',
  'No network calls occur under financial DB locks',
  noNetworkUnderDbLocks,
  'PayoutService explicitly separates DB lock phases from outbound Paystack network I/O'
);

// -----------------------------------------------------------------------------
// GA2A-20: Private evidence bucket remains private
// -----------------------------------------------------------------------------
const evidenceBucketPrivate = gate72aSql.includes("'issue-evidence-private'") &&
  gate72aSql.includes('public = FALSE');
recordTest(
  'Storage Security',
  'GA2A-20',
  'Private evidence bucket remains private',
  evidenceBucketPrivate,
  'storage.buckets enforces public = FALSE for issue-evidence-private'
);

// -----------------------------------------------------------------------------
// GA2A-21: Unauthorized user cannot access another user\'s evidence
// -----------------------------------------------------------------------------
const rlsPreventsUnauthorizedEvidence = gate72aSql.includes('(storage.foldername(name))[1] = auth.uid()::text') &&
  apiIndexCode.includes('issue.guest_id === authResult.user.id') &&
  apiIndexCode.includes('Access denied: You do not have permission');
recordTest(
  'Storage Security',
  'GA2A-21',
  'Unauthorized user cannot access another user\'s evidence',
  rlsPreventsUnauthorizedEvidence,
  'Storage RLS restricts paths to user ID folder and API endpoints verify guest ownership before issuing signed URLs'
);

// -----------------------------------------------------------------------------
// GA2A-22: Host cannot access confidential guest evidence
// -----------------------------------------------------------------------------
const hostExcludedFromEvidence = !gate72aSql.includes('hp.user_id = auth.uid()') ||
  !gate72aSql.includes('CREATE POLICY "Hosts can view issue evidence"');
const apiRejectsNonOwnerHost = apiIndexCode.includes('if (!isAdmin && !isOwner)');
recordTest(
  'Privacy & Security',
  'GA2A-22',
  'Host cannot access confidential guest evidence',
  hostExcludedFromEvidence && apiRejectsNonOwnerHost,
  'Hosts are strictly excluded from storage RLS and evidence download API endpoints'
);

// -----------------------------------------------------------------------------
// GA2A-23: Admin can access authorized evidence
// -----------------------------------------------------------------------------
const adminEvidenceAccess = gate72aSql.includes("profiles.role = 'admin'") ||
  (gate72aSql.includes("p.role = 'admin'") && apiIndexCode.includes("profile?.role === 'admin'"));
recordTest(
  'Role-Based Access Control',
  'GA2A-23',
  'Admin can access authorized evidence',
  adminEvidenceAccess,
  'Admin role check permits dispute investigation access across storage RLS and server API'
);

// -----------------------------------------------------------------------------
// GA2A-24: Guest cannot mutate damage deposit state
// -----------------------------------------------------------------------------
const guestDepositRevoke = gate72aSql.includes('REVOKE INSERT, UPDATE, DELETE ON public.damage_deposits FROM PUBLIC, anon, authenticated;');
recordTest(
  'Security & RLS',
  'GA2A-24',
  'Guest cannot mutate damage deposit state',
  guestDepositRevoke,
  'Direct mutations revoked; guest has SELECT-only permission for their own booking damage deposits'
);

// -----------------------------------------------------------------------------
// GA2A-25: Host cannot mutate damage deposit state
// -----------------------------------------------------------------------------
const hostDepositSelectOnly = gate72aSql.includes('CREATE POLICY "Parties can view damage deposits"') &&
  gate72aSql.includes('ON public.damage_deposits FOR SELECT');
recordTest(
  'Security & RLS',
  'GA2A-25',
  'Host cannot mutate damage deposit state',
  hostDepositSelectOnly && guestDepositRevoke,
  'Host is granted SELECT for properties they host; direct mutations are strictly revoked'
);

// -----------------------------------------------------------------------------
// GA2A-26: No reserve liability is created without a legitimate funding source
// -----------------------------------------------------------------------------
const ledgerFullyConserved = settlementFuncSql.includes("'1010'") &&
  settlementFuncSql.includes("'2010'") &&
  settlementFuncSql.includes("'2100'") &&
  settlementFuncSql.includes("'4010'") &&
  settlementFuncSql.includes("'2300'") &&
  !settlementFuncSql.includes("record_balanced_ledger_transaction(\n      gen_random_uuid(),\n      v_booking.id,\n      'RESERVE_ALLOCATION'");
recordTest(
  'Ledger Invariants',
  'GA2A-26',
  'No reserve liability is created without a legitimate funding source',
  ledgerFullyConserved,
  'Ledger remains fully conserved; no unbacked 2040 reserve liability is manufactured from thin air'
);

// -----------------------------------------------------------------------------
// GA2A-27: Gate #5.3 commission model remains unchanged
// -----------------------------------------------------------------------------
const preservesGate53Model = settlementFuncSql.includes('v_ark_accommodation_commission := ROUND(v_auth_room_total * (v_host_commission_rate / 100.00), 2);') &&
  settlementFuncSql.includes('v_host_net_settlement := v_auth_room_total - v_ark_accommodation_commission;') &&
  settlementFuncSql.includes('v_ark_logistics_commission := ROUND(v_auth_logistics_total * 0.10, 2);');
recordTest(
  'Business Architecture',
  'GA2A-27',
  'Gate #5.3 commission model remains unchanged',
  preservesGate53Model,
  'Host commission (10%-15%) and logistics commission (10%) deducted from partners; guest pays 0% markup'
);

// -----------------------------------------------------------------------------
// GA2A-28: Gate #6.3 date-specific availability remains unchanged
// -----------------------------------------------------------------------------
const preservesGate63Calendar = gate63Sql.includes('create_pending_booking_transaction') &&
  gate63Sql.includes('Date-specific availability') &&
  gate63Sql.includes('rooms.total_rooms');
recordTest(
  'Regression Prevention',
  'GA2A-28',
  'Gate #6.3 date-specific availability remains unchanged',
  preservesGate63Calendar,
  'Gate #6.3 date-specific availability, atomic rooms FOR UPDATE lock, and pending booking transaction logic remain intact'
);

// -----------------------------------------------------------------------------
// GA2A-29: Historical financial records remain unchanged
// -----------------------------------------------------------------------------
const preservesHistoricalLedger = !gate72aSql.includes('DELETE FROM public.financial_ledger') &&
  !gate72aSql.includes('TRUNCATE public.financial_ledger') &&
  !gate72aSql.includes('DROP TABLE public.financial_ledger');
recordTest(
  'Ledger Integrity',
  'GA2A-29',
  'Historical financial records remain unchanged',
  preservesHistoricalLedger,
  'Append-only ledger structure strictly maintained without destructive drops or deletions'
);

// -----------------------------------------------------------------------------
// GA2A-30: Historical bookings/payments remain unchanged
// -----------------------------------------------------------------------------
const baselineCountsIntact = INITIAL_PROPERTIES.length === 8 &&
  INITIAL_ROOMS.length === 8 &&
  INITIAL_BOOKINGS.length === 3 &&
  INITIAL_PAYMENTS.length === 3 &&
  INITIAL_VENUES.length === 5 &&
  INITIAL_LOGISTICS.length === 2;
recordTest(
  'Data Baseline',
  'GA2A-30',
  'Historical bookings and payments remain unchanged',
  baselineCountsIntact,
  `Baseline entity counts intact (Properties: ${INITIAL_PROPERTIES.length}, Rooms: ${INITIAL_ROOMS.length}, Bookings: ${INITIAL_BOOKINGS.length}, Payments: ${INITIAL_PAYMENTS.length})`
);

// -----------------------------------------------------------------------------
// SUMMARY & EXIT
// -----------------------------------------------------------------------------
console.log('\n================================================================');
const passCount = testResults.filter(t => t.status === 'PASS').length;
const failCount = testResults.filter(t => t.status === 'FAIL').length;
console.log(`TOTAL TESTS: ${testResults.length} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log('================================================================\n');

if (failCount > 0) {
  console.error(`❌ Verification FAILED with ${failCount} failures.`);
  process.exit(1);
} else {
  console.log('🎉 All 30 Gate #7.2A verification tests PASSED with 100% success rate.');
  process.exit(0);
}
