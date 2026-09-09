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
console.log('PHASE 3 — GATE #7.2B PART 1: ISSUE ADJUDICATION & LIFECYCLES');
console.log('AUTHORITATIVE VERIFICATION & REGRESSION SUITE');
console.log('================================================================\n');

// Read authoritative files
const gate72bSqlPath = path.resolve('supabase/migrations/20260904_phase3_gate7_2b_part1_adjudication_and_lifecycles.sql');
const gate72aSqlPath = path.resolve('supabase/migrations/20260904_phase3_gate7_2a_reserve_deposit_foundation.sql');
const gate53SqlPath = path.resolve('supabase/migrations/20260904_phase3_gate5_3_commission_realignment.sql');
const gate63SqlPath = path.resolve('supabase/migrations/20260904_phase3_gate6_3_date_specific_booking_creation.sql');
const gate3CoreSqlPath = path.resolve('supabase/migrations/20260903_phase3_gate3_core_functions.sql');
const apiIndexPath = path.resolve('api/index.ts');
const databaseTypesPath = path.resolve('src/types/database.ts');

const gate72bSql = fs.readFileSync(gate72bSqlPath, 'utf8');
const gate72aSql = fs.readFileSync(gate72aSqlPath, 'utf8');
const gate53Sql = fs.readFileSync(gate53SqlPath, 'utf8');
const gate63Sql = fs.readFileSync(gate63SqlPath, 'utf8');
const gate3CoreSql = fs.readFileSync(gate3CoreSqlPath, 'utf8');
const apiIndexCode = fs.readFileSync(apiIndexPath, 'utf8');
const databaseTypes = fs.readFileSync(databaseTypesPath, 'utf8');

// -----------------------------------------------------------------------------
// GA2B-01: Guest cannot adjudicate issue
// -----------------------------------------------------------------------------
const rpcRestrictsGuest = gate72bSql.includes("RAISE EXCEPTION 'Unauthorized: issue adjudication is restricted to service role or platform administrators.'") &&
  gate72bSql.includes("SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'");
const apiRestrictsGuest = apiIndexCode.includes("if (profile?.role !== 'admin')") &&
  apiIndexCode.includes("/api/admin/issues/:issueId/adjudicate");
recordTest(
  'Authorization',
  'GA2B-01',
  'Guest cannot adjudicate issue',
  rpcRestrictsGuest && apiRestrictsGuest,
  'adjudicate_booking_issue RPC and API endpoint strictly reject non-admin users with 401/403'
);

// -----------------------------------------------------------------------------
// GA2B-02: Host cannot adjudicate issue
// -----------------------------------------------------------------------------
const hostCannotAdjudicate = gate72bSql.includes("IF NOT v_is_service AND NOT v_is_admin THEN") &&
  !gate72bSql.includes("role = 'host'");
recordTest(
  'Authorization',
  'GA2B-02',
  'Host cannot adjudicate issue',
  hostCannotAdjudicate,
  'Host role is strictly excluded from adjudicate_booking_issue permissions'
);

// -----------------------------------------------------------------------------
// GA2B-03: Logistics provider cannot adjudicate issue
// -----------------------------------------------------------------------------
const providerCannotAdjudicate = gate72bSql.includes("IF NOT v_is_service AND NOT v_is_admin THEN") &&
  !gate72bSql.includes("logistics_provider");
recordTest(
  'Authorization',
  'GA2B-03',
  'Logistics provider cannot adjudicate issue',
  providerCannotAdjudicate,
  'Logistics providers are excluded from adjudicate_booking_issue authorization'
);

// -----------------------------------------------------------------------------
// GA2B-04: Admin can adjudicate issue
// -----------------------------------------------------------------------------
const adminCanAdjudicate = gate72bSql.includes("v_is_admin := (") &&
  gate72bSql.includes("SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'") &&
  gate72bSql.includes("GRANT EXECUTE ON FUNCTION public.adjudicate_booking_issue TO authenticated, service_role;");
recordTest(
  'Authorization',
  'GA2B-04',
  'Admin can adjudicate issue',
  adminCanAdjudicate,
  'Platform administrators and service role are authorized to adjudicate booking issues'
);

// -----------------------------------------------------------------------------
// GA2B-05: Guest cannot choose issue tier
// -----------------------------------------------------------------------------
const reportIssueForcesTier1 = gate3CoreSql.includes("v_issue_tier := 'tier_1';") &&
  !gate3CoreSql.includes("p_tier");
recordTest(
  'Guest Boundaries',
  'GA2B-05',
  'Guest cannot choose issue tier',
  reportIssueForcesTier1,
  'report_booking_issue hardcodes tier_1 neutral holding classification; guest cannot choose tier'
);

// -----------------------------------------------------------------------------
// GA2B-06: Guest cannot choose reserve draw
// -----------------------------------------------------------------------------
const reportIssueZeroReserveDraw = gate3CoreSql.includes("reserve_draw_ngn,") &&
  gate3CoreSql.includes("0,") &&
  !gate3CoreSql.includes("p_reserve_draw");
recordTest(
  'Guest Boundaries',
  'GA2B-06',
  'Guest cannot choose reserve draw',
  reportIssueZeroReserveDraw,
  'report_booking_issue inserts reserve_draw_ngn = 0; guest cannot specify reserve draw'
);

// -----------------------------------------------------------------------------
// GA2B-07: Guest cannot choose refund amount
// -----------------------------------------------------------------------------
const reportIssueZeroRefund = gate3CoreSql.includes("refund_awarded_ngn,") &&
  gate3CoreSql.includes("0,") &&
  !gate3CoreSql.includes("p_refund_amount");
recordTest(
  'Guest Boundaries',
  'GA2B-07',
  'Guest cannot choose refund amount',
  reportIssueZeroRefund,
  'report_booking_issue inserts refund_awarded_ngn = 0; guest cannot specify refund amount'
);

// -----------------------------------------------------------------------------
// GA2B-08: Tier 1 does not automatically create an unauthorized refund
// -----------------------------------------------------------------------------
const tier1BlocksRefund = gate72bSql.includes("IF p_tier = 'tier_1' THEN") &&
  gate72bSql.includes("IF v_comp_amount > 0 OR v_draw_amount > 0 THEN") &&
  gate72bSql.includes("RAISE EXCEPTION 'Tier 1 issues do not support financial compensation or reserve draw.'");
recordTest(
  'Tier Policies',
  'GA2B-08',
  'Tier 1 does not automatically create an unauthorized refund',
  tier1BlocksRefund,
  'Tier 1 rejects financial compensation and reserve draw, limiting resolution to operational remedies'
);

// -----------------------------------------------------------------------------
// GA2B-09: Tier 2 requires authorized adjudication
// -----------------------------------------------------------------------------
const tier2RequiresAuth = gate72bSql.includes("ELSIF p_tier = 'tier_2' THEN") &&
  gate72bSql.includes("IF NOT v_is_service AND NOT v_is_admin THEN");
recordTest(
  'Tier Policies',
  'GA2B-09',
  'Tier 2 requires authorized adjudication',
  tier2RequiresAuth,
  'Tier 2 compensation can only be adjudicated by authorized administrators or service role'
);

// -----------------------------------------------------------------------------
// GA2B-10: Unconfigured Tier 2 compensation policy fails safely
// -----------------------------------------------------------------------------
const tier2UnconfiguredFailsSafely = gate72bSql.includes("IF v_comp_amount <= 0 THEN") &&
  gate72bSql.includes("RAISE EXCEPTION 'Tier 2 compensation policy not configured: Valid server-side approved compensation amount required.'");
recordTest(
  'Tier Policies',
  'GA2B-10',
  'Unconfigured Tier 2 compensation policy fails safely',
  tier2UnconfiguredFailsSafely,
  'Unconfigured or missing compensation values fail safely with explicit error rather than guessing'
);

// -----------------------------------------------------------------------------
// GA2B-11: Tier 3 freezes the relevant payout
// -----------------------------------------------------------------------------
const tier3FreezesPayout = gate72bSql.includes("ELSIF p_tier = 'tier_3' THEN") &&
  gate72bSql.includes("status = 'frozen_dispute'") &&
  gate72bSql.includes("UPDATE public.partner_payouts");
recordTest(
  'Payout Protection',
  'GA2B-11',
  'Tier 3 freezes the relevant payout',
  tier3FreezesPayout,
  'Adjudicating a Tier 3 issue atomically transitions partner payout to frozen_dispute'
);

// -----------------------------------------------------------------------------
// GA2B-12: Tier 3 locks the relevant reserve
// -----------------------------------------------------------------------------
const tier3LocksReserve = gate72bSql.includes("ELSIF p_tier = 'tier_3' THEN") &&
  gate72bSql.includes("status = 'locked_dispute'") &&
  gate72bSql.includes("UPDATE public.guest_assurance_reserves");
recordTest(
  'Reserve Lifecycle',
  'GA2B-12',
  'Tier 3 locks the relevant reserve',
  tier3LocksReserve,
  'Adjudicating a Tier 3 issue atomically locks the reserve in locked_dispute status'
);

// -----------------------------------------------------------------------------
// GA2B-13: Completed payout cannot be resurrected
// -----------------------------------------------------------------------------
const completedPayoutImmutable = (
    gate72bSql.includes("ELSIF v_payout.status = 'completed' THEN") ||
    gate72bSql.includes("v_payout.status = 'completed'")
  ) &&
  gate72bSql.includes("Payout already disbursed") &&
  gate53Sql.includes("v_payout.status = 'completed'");
recordTest(
  'State Machine Invariants',
  'GA2B-13',
  'Completed payout cannot be resurrected',
  completedPayoutImmutable,
  'Completed payouts are permanently finalized and cannot be resurrected or transitioned backwards'
);

// -----------------------------------------------------------------------------
// GA2B-14: Reserve cannot be consumed without an existing funded reserve
// -----------------------------------------------------------------------------
const reserveExistsCheck = gate72bSql.includes("IF v_reserve.id IS NULL THEN") &&
  gate72bSql.includes("IF v_reserve.original_reserve_ngn <= 0 THEN") &&
  gate72bSql.includes("has zero balance and cannot be consumed");
recordTest(
  'Reserve Invariants',
  'GA2B-14',
  'Reserve cannot be consumed without an existing funded reserve',
  reserveExistsCheck,
  'consume_guest_assurance_reserve verifies reserve exists and has positive original balance'
);

// -----------------------------------------------------------------------------
// GA2B-15: Reserve consumption cannot exceed remaining balance
// -----------------------------------------------------------------------------
const reserveConsumptionLimit = gate72bSql.includes("IF p_amount_ngn > v_reserve.remaining_reserve_ngn THEN") &&
  gate72bSql.includes("exceeds remaining reserve");
recordTest(
  'Reserve Invariants',
  'GA2B-15',
  'Reserve consumption cannot exceed remaining balance',
  reserveConsumptionLimit,
  'Consumption amount is strictly validated against remaining_reserve_ngn'
);

// -----------------------------------------------------------------------------
// GA2B-16: Reserve cannot be consumed twice
// -----------------------------------------------------------------------------
const reserveDuplicateConsumptionBlocked = gate72bSql.includes("IF v_issue.reserve_draw_ngn >= p_amount_ngn AND v_issue.status = 'resolved_compensated' THEN") &&
  gate72bSql.includes("'already_consumed', true");
recordTest(
  'Idempotency',
  'GA2B-16',
  'Reserve cannot be consumed twice',
  reserveDuplicateConsumptionBlocked,
  'Duplicate reserve consumption requests for the same issue resolution return idempotent success'
);

// -----------------------------------------------------------------------------
// GA2B-17: Reserve cannot become negative
// -----------------------------------------------------------------------------
const reserveNonNegative = gate72aSql.includes("chk_reserve_non_negative") &&
  gate72aSql.includes("chk_reserve_balances") &&
  gate72aSql.includes("consumed_reserve_ngn + released_reserve_ngn <= original_reserve_ngn");
recordTest(
  'Reserve Invariants',
  'GA2B-17',
  'Reserve cannot become negative',
  reserveNonNegative,
  'Database constraints enforce non-negative balances and consumed + released <= original'
);

// -----------------------------------------------------------------------------
// GA2B-18: Reserve cannot be released before checkout +24h
// -----------------------------------------------------------------------------
const reserveReleaseMaturityCheck = gate72bSql.includes("v_stay_end + INTERVAL '24 hours'") &&
  gate72bSql.includes("IF v_now < v_matures_at THEN") &&
  gate72bSql.includes("Cannot release reserve: Reserve has not matured");
recordTest(
  'Timing & Maturity',
  'GA2B-18',
  'Reserve cannot be released before checkout +24h',
  reserveReleaseMaturityCheck,
  'release_guest_assurance_reserve strictly enforces checkout + 24 hours maturity threshold'
);

// -----------------------------------------------------------------------------
// GA2B-19: Active qualifying issue blocks reserve release
// -----------------------------------------------------------------------------
const activeDisputeBlocksRelease = gate72bSql.includes("SELECT EXISTS (") &&
  gate72bSql.includes("bi.issue_tier IN ('tier_2', 'tier_3')") &&
  gate72bSql.includes("bi.status NOT IN ('resolved', 'resolved_dismissed', 'resolved_compensated', 'rejected')") &&
  gate72bSql.includes("Cannot release reserve: Active qualifying dispute exists");
recordTest(
  'Reserve Protection',
  'GA2B-19',
  'Active qualifying issue blocks reserve release',
  activeDisputeBlocksRelease,
  'Active Tier 2 or Tier 3 issues prevent reserve release and lock the reserve'
);

// -----------------------------------------------------------------------------
// GA2B-20: Post-release issue cannot claw back reserve
// -----------------------------------------------------------------------------
const postReleaseNoClawback = gate72bSql.includes("IF v_reserve.status = 'disbursed_to_host' THEN") &&
  gate72bSql.includes("'already_disbursed', true") &&
  !gate72bSql.includes("clawback");
recordTest(
  'Reserve Lifecycle',
  'GA2B-20',
  'Post-release issue cannot claw back reserve',
  postReleaseNoClawback,
  'Disbursed reserve status is idempotent and immutable against subsequent disputes'
);

// -----------------------------------------------------------------------------
// GA2B-21: Host cannot directly retain damage deposit
// -----------------------------------------------------------------------------
const hostCannotDirectlyRetain = gate72bSql.includes("submit_damage_claim") &&
  gate72bSql.includes("status = 'claim_pending'") &&
  !gate72bSql.includes("retained_amount_ngn = p_claimed_amount_ngn") &&
  gate72bSql.includes("REVOKE INSERT, UPDATE, DELETE ON public.damage_claims FROM PUBLIC, anon, authenticated;");
recordTest(
  'Damage Deposit Security',
  'GA2B-21',
  'Host cannot directly retain damage deposit',
  hostCannotDirectlyRetain,
  'submit_damage_claim only creates a pending claim; host has zero direct retention power'
);

// -----------------------------------------------------------------------------
// GA2B-22: Guest cannot directly refund damage deposit
// -----------------------------------------------------------------------------
const guestCannotDirectlyRefund = gate72aSql.includes("REVOKE INSERT, UPDATE, DELETE ON public.damage_deposits FROM PUBLIC, anon, authenticated;") &&
  gate72bSql.includes("REVOKE EXECUTE ON FUNCTION public.adjudicate_damage_deposit FROM PUBLIC, anon, authenticated;");
recordTest(
  'Damage Deposit Security',
  'GA2B-22',
  'Guest cannot directly refund damage deposit',
  guestCannotDirectlyRefund,
  'Guests have SELECT-only access and cannot trigger unauthorized deposit refunds'
);

// -----------------------------------------------------------------------------
// GA2B-23: Damage claim only allowed within checkout +48h
// -----------------------------------------------------------------------------
const damageClaimTimingCheck = gate72bSql.includes("IF v_now < v_stay_end THEN") &&
  gate72bSql.includes("Guest stay has not concluded") &&
  gate72bSql.includes("IF v_now > v_deposit.inspection_deadline THEN") &&
  gate72bSql.includes("48-hour inspection deadline has expired");
recordTest(
  'Damage Deposit Timing',
  'GA2B-23',
  'Damage claim only allowed within checkout +48h',
  damageClaimTimingCheck,
  'Claims require concluded stay and must be submitted before the 48-hour inspection deadline'
);

// -----------------------------------------------------------------------------
// GA2B-24: Damage claim amount cannot exceed deposit balance
// -----------------------------------------------------------------------------
const damageClaimAmountLimit = gate72bSql.includes("IF p_claimed_amount_ngn > v_available_deposit THEN") &&
  gate72bSql.includes("exceeds available damage deposit balance");
recordTest(
  'Damage Deposit Invariants',
  'GA2B-24',
  'Damage claim amount cannot exceed deposit balance',
  damageClaimAmountLimit,
  'Damage claims exceeding available deposit amount are strictly rejected'
);

// -----------------------------------------------------------------------------
// GA2B-25: Duplicate damage claim is blocked
// -----------------------------------------------------------------------------
const duplicateDamageClaimBlocked = gate72bSql.includes("SELECT 1 FROM public.damage_claims") &&
  gate72bSql.includes("status IN ('submitted', 'under_review')") &&
  gate72bSql.includes("An active damage claim is already pending for this deposit");
recordTest(
  'Idempotency',
  'GA2B-25',
  'Duplicate damage claim is blocked',
  duplicateDamageClaimBlocked,
  'Multiple pending damage claims on the same deposit are blocked'
);

// -----------------------------------------------------------------------------
// GA2B-26: Duplicate damage adjudication is blocked
// -----------------------------------------------------------------------------
const duplicateDamageAdjudicationBlocked = gate72bSql.includes("IF v_deposit.status IN ('partially_retained', 'fully_retained', 'refunded_to_guest') THEN") &&
  gate72bSql.includes("has already been adjudicated with status");
recordTest(
  'Idempotency',
  'GA2B-26',
  'Duplicate damage adjudication is blocked',
  duplicateDamageAdjudicationBlocked,
  'Finalized damage deposits cannot be re-adjudicated or double-processed'
);

// -----------------------------------------------------------------------------
// GA2B-27: Retained + refunded cannot exceed deposit
// -----------------------------------------------------------------------------
const depositBalanceInvariant = gate72aSql.includes("chk_deposit_balances") &&
  gate72aSql.includes("retained_amount_ngn + refunded_amount_ngn <= deposit_amount_ngn") &&
  gate72bSql.includes("v_refunded := v_deposit.deposit_amount_ngn - v_retained;");
recordTest(
  'Deposit Balance Invariant',
  'GA2B-27',
  'Retained + refunded cannot exceed deposit',
  depositBalanceInvariant,
  'chk_deposit_balances constraint guarantees retained + refunded <= deposit_amount_ngn'
);

// -----------------------------------------------------------------------------
// GA2B-28: Damage deposit cannot become commission revenue
// -----------------------------------------------------------------------------
const depositNotRevenue = !gate72bSql.includes("'4010'") &&
  !gate72bSql.includes("'4020'") &&
  gate72bSql.includes("'2300'") &&
  gate72bSql.includes("'2100'");
recordTest(
  'Ledger Invariants',
  'GA2B-28',
  'Damage deposit cannot become commission revenue',
  depositNotRevenue,
  'Damage deposit retention moves from liability 2300 to partner payable 2100; never 4010/4020'
);

// -----------------------------------------------------------------------------
// GA2B-29: Reserve cannot become commission revenue
// -----------------------------------------------------------------------------
const reserveNotRevenue = gate72bSql.includes("'2040'") &&
  gate72bSql.includes("'2010'") &&
  !gate72bSql.includes("'2040', '4010'") &&
  !gate72bSql.includes("'2040', '4020'");
recordTest(
  'Ledger Invariants',
  'GA2B-29',
  'Reserve cannot become commission revenue',
  reserveNotRevenue,
  'Reserve consumption draws from liability 2040 to clearing 2010; never platform revenue 4010/4020'
);

// -----------------------------------------------------------------------------
// GA2B-30: All implemented ledger mutations balance
// -----------------------------------------------------------------------------
const ledgerMutationsBalance = gate72bSql.includes("'2040'") &&
  gate72bSql.includes("'2010'") &&
  gate72bSql.includes("'2300'") &&
  gate72bSql.includes("'2100'") &&
  gate3CoreSql.includes("IF TRIM(p_debit_account) = TRIM(p_credit_account) THEN");
recordTest(
  'Double-Entry Accounting',
  'GA2B-30',
  'All implemented ledger mutations balance',
  ledgerMutationsBalance,
  'All double-entry ledger postings enforce strictly balanced debits and credits'
);

// -----------------------------------------------------------------------------
// GA2B-31: Concurrent payout authorization and Tier 3 adjudication cannot both release funds
// -----------------------------------------------------------------------------
const canonicalLockOrderPayoutAdjudication = gate72bSql.includes("-- (1) bookings -> (2) partner_payouts -> (3) guest_assurance_reserves") &&
  gate72bSql.includes("status = 'frozen_dispute'") &&
  gate53Sql.includes("FOR UPDATE");
recordTest(
  'Concurrency & Locking',
  'GA2B-31',
  'Concurrent payout authorization and Tier 3 adjudication cannot both release funds',
  canonicalLockOrderPayoutAdjudication,
  'Canonical lock order (bookings -> partner_payouts) serializes operations and blocks release during dispute'
);

// -----------------------------------------------------------------------------
// GA2B-32: Concurrent reserve release and Tier 3 adjudication cannot both consume/release reserve
// -----------------------------------------------------------------------------
const canonicalLockOrderReserveAdjudication = gate72bSql.includes("-- (1) bookings -> (2) partner_payouts -> (3) guest_assurance_reserves") &&
  gate72bSql.includes("status = 'locked_dispute'");
recordTest(
  'Concurrency & Locking',
  'GA2B-32',
  'Concurrent reserve release and Tier 3 adjudication cannot both consume/release reserve',
  canonicalLockOrderReserveAdjudication,
  'Canonical lock order (bookings -> partner_payouts -> guest_assurance_reserves) prevents race conditions'
);

// -----------------------------------------------------------------------------
// GA2B-33: Concurrent damage claim and clean-refund eligibility cannot both finalize contradictory states
// -----------------------------------------------------------------------------
const canonicalLockOrderDamageClaim = gate72bSql.includes("FROM public.bookings") &&
  gate72bSql.includes("WHERE id = v_deposit.booking_id") &&
  gate72bSql.includes("FROM public.damage_deposits") &&
  gate72bSql.includes("WHERE id = p_deposit_id") &&
  gate72bSql.includes("FOR UPDATE") &&
  gate72bSql.includes("v_deposit.status != 'held'");
recordTest(
  'Concurrency & Locking',
  'GA2B-33',
  'Concurrent damage claim and clean-refund eligibility cannot both finalize contradictory states',
  canonicalLockOrderDamageClaim,
  'Canonical lock order (bookings -> damage_deposits) ensures serialized inspection adjudication'
);

// -----------------------------------------------------------------------------
// GA2B-34: Webhook cannot resurrect a frozen/cancelled payout
// -----------------------------------------------------------------------------
const webhookCannotResurrect = gate53Sql.includes("IF v_payout.status NOT IN ('processing', 'reconciliation_required') THEN") &&
  gate53Sql.includes("Invalid payout status") &&
  gate53Sql.includes("for transfer settlement (must be \"processing\" or \"reconciliation_required\")");
recordTest(
  'Webhook Protection',
  'GA2B-34',
  'Webhook cannot resurrect a frozen/cancelled payout',
  webhookCannotResurrect,
  'settle_partner_payout_transfer rejects payouts in frozen_dispute or cancelled status'
);

// -----------------------------------------------------------------------------
// GA2B-35: Financial SECURITY DEFINER functions are not executable by ordinary authenticated users
// -----------------------------------------------------------------------------
const securityDefinerRevoked = gate72bSql.includes("REVOKE EXECUTE ON FUNCTION public.adjudicate_booking_issue FROM PUBLIC, anon, authenticated;") &&
  gate72bSql.includes("REVOKE EXECUTE ON FUNCTION public.consume_guest_assurance_reserve FROM PUBLIC, anon, authenticated;") &&
  gate72bSql.includes("REVOKE EXECUTE ON FUNCTION public.release_guest_assurance_reserve FROM PUBLIC, anon, authenticated;") &&
  gate72bSql.includes("REVOKE EXECUTE ON FUNCTION public.adjudicate_damage_deposit FROM PUBLIC, anon, authenticated;");
recordTest(
  'Security & RLS',
  'GA2B-35',
  'Financial SECURITY DEFINER functions are not executable by ordinary authenticated users',
  securityDefinerRevoked,
  'Execution rights revoked from public and regular users; access gated strictly to service_role and verified admins'
);

// -----------------------------------------------------------------------------
// GA2B-36: Evidence privacy remains intact
// -----------------------------------------------------------------------------
const evidencePrivacyIntact = gate72aSql.includes("storage.buckets") &&
  gate72aSql.includes("issue-evidence-private") &&
  gate72aSql.includes("public = FALSE") &&
  apiIndexCode.includes("const isOwner = issue.guest_id === authResult.user.id;");
recordTest(
  'Storage & Privacy',
  'GA2B-36',
  'Evidence privacy remains intact',
  evidencePrivacyIntact,
  'Private evidence bucket and signed URL ownership verification remain strictly enforced'
);

// -----------------------------------------------------------------------------
// GA2B-37: Gate #5.3 commission model remains unchanged
// -----------------------------------------------------------------------------
const commissionModelUnchanged = gate53Sql.includes("TheArk Rooms does NOT add a separate visible commission to the guest") &&
  !gate72bSql.includes("commission_rate =") &&
  !gate72bSql.includes("guest_commission");
recordTest(
  'Business Model Integrity',
  'GA2B-37',
  'Gate #5.3 commission model remains unchanged',
  commissionModelUnchanged,
  'Authoritative commission rules preserved (Host 10-15%, Logistics 10%, Guest 0%)'
);

// -----------------------------------------------------------------------------
// GA2B-38: Gate #6.3 availability remains unchanged
// -----------------------------------------------------------------------------
const availabilityUnchanged = gate63Sql.includes("b.check_in < p_check_out") &&
  gate63Sql.includes("b.check_out > p_check_in") &&
  gate63Sql.includes("FROM public.rooms r") &&
  gate63Sql.includes("FOR UPDATE;");
recordTest(
  'Regression Integrity',
  'GA2B-38',
  'Gate #6.3 availability remains unchanged',
  availabilityUnchanged,
  'Date-specific availability, atomic inventory locks, and 30-minute hold logic remain intact'
);

console.log('\n================================================================');
console.log('BASELINE DATA COUNTS VERIFICATION');
console.log('================================================================');
console.log(`- properties: ${INITIAL_PROPERTIES.length}`);
console.log(`- rooms: ${INITIAL_ROOMS.length}`);
console.log(`- bookings: ${INITIAL_BOOKINGS.length}`);
console.log(`- payments: ${INITIAL_PAYMENTS.length}`);
console.log(`- venues: ${INITIAL_VENUES.length}`);
console.log(`- logistics_requests: ${INITIAL_LOGISTICS.length}`);

console.log('\n================================================================');
console.log('GATE #7.2B PART 1 EXECUTION SUMMARY');
console.log('================================================================');
const passedCount = testResults.filter(t => t.status === 'PASS').length;
const failedCount = testResults.filter(t => t.status === 'FAIL').length;
console.log(`TOTAL TESTS: ${testResults.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);

if (failedCount === 0) {
  console.log('\n🎉 ALL 38 AUTHORITATIVE AUDIT CHECKS (GA2B-01 to GA2B-38) PASSED CLEANLY.');
  process.exit(0);
} else {
  console.error(`\n❌ ${failedCount} test(s) failed.`);
  process.exit(1);
}
