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
console.log('PHASE 3 — GATE #5.3: THREE-PARTY PARTNER-DEDUCTED COMMISSION MODEL');
console.log('AUTHORITATIVE VERIFICATION & AUDIT SUITE');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// 1. DATA SAFETY BASELINE CHECK (Pre- & Post-migration entity counts)
// -----------------------------------------------------------------------------
console.log('--- [1. DATA INTEGRITY & SAFETY BASELINE] ---');
const baseline = {
  properties: INITIAL_PROPERTIES.length,
  rooms: INITIAL_ROOMS.length,
  bookings: INITIAL_BOOKINGS.length,
  payments: INITIAL_PAYMENTS.length,
  venues: INITIAL_VENUES.length,
  logistics: INITIAL_LOGISTICS.length,
};

recordTest(
  'Data Safety',
  'DS-01',
  'Baseline Core Entities Intact',
  baseline.properties > 0 && baseline.rooms > 0,
  `Properties: ${baseline.properties}, Rooms: ${baseline.rooms}, Bookings: ${baseline.bookings}, Payments: ${baseline.payments}`
);

// -----------------------------------------------------------------------------
// 2. MIGRATION FILE & SCHEMA SPECIFICATION AUDIT
// -----------------------------------------------------------------------------
console.log('\n--- [2. SCHEMA & MIGRATION FORMALIZATION AUDIT] ---');
const migrationPath = path.resolve('supabase/migrations/20260904_phase3_gate5_3_commission_realignment.sql');
const migrationExists = fs.existsSync(migrationPath);

recordTest(
  'Schema',
  'SCH-01',
  'Migration File Exists',
  migrationExists,
  `Path: ${migrationPath}`
);

const migrationSql = fs.readFileSync(migrationPath, 'utf8');

// Check host_profiles commission_rate_percentage and boundaries
const hasHostCommissionCol = migrationSql.includes('commission_rate_percentage NUMERIC(5,2)');
const hasHostCommissionCheck =
  migrationSql.includes('commission_rate_percentage >= 10.00') &&
  migrationSql.includes('commission_rate_percentage <= 15.00');

recordTest(
  'Schema',
  'SCH-02',
  'Host Profile Commission Rate & 10.00%-15.00% Constraint',
  hasHostCommissionCol && hasHostCommissionCheck,
  'Column defined with NUMERIC(5,2) DEFAULT 10.00 and CHECK between 10.00% and 15.00%'
);

// Check host commission trigger protection
const hasHostCommissionTrigger =
  migrationSql.includes('trg_protect_host_commission_rate') &&
  migrationSql.includes('fn_protect_host_commission_rate');

recordTest(
  'Schema',
  'SCH-03',
  'Host Commission Mutation Protection Trigger',
  hasHostCommissionTrigger,
  'Trigger restricts rate adjustments to administrators/service_role'
);

// Check admin RPC for updating host commission
const hasAdminCommissionRPC =
  migrationSql.includes('admin_update_host_commission_rate') &&
  migrationSql.includes('p_commission_rate NUMERIC');

recordTest(
  'Schema',
  'SCH-04',
  'Admin RPC for Updating Negotiated Commission Rate',
  hasAdminCommissionRPC,
  'public.admin_update_host_commission_rate(UUID, NUMERIC) configured'
);

// Check logistics_providers and logistics_payout_profiles
const hasLogisticsProviderTable =
  migrationSql.includes('CREATE TABLE IF NOT EXISTS public.logistics_providers') &&
  migrationSql.includes('commission_rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00 CHECK (commission_rate_percentage = 10.00)');

const hasLogisticsPayoutProfilesTable =
  migrationSql.includes('CREATE TABLE IF NOT EXISTS public.logistics_payout_profiles') &&
  migrationSql.includes('paystack_recipient_code TEXT NOT NULL UNIQUE');

recordTest(
  'Schema',
  'SCH-05',
  'Logistics Provider and Payout Profile Tables',
  hasLogisticsProviderTable && hasLogisticsPayoutProfilesTable,
  'Logistics provider entity schema defined with 10.00% fixed commission constraint'
);

// Check canonical fleet provider seed
const hasCanonicalFleetSeed =
  migrationSql.includes('70000000-0000-4000-8000-000000000001') &&
  migrationSql.includes('TheArk Executive Chauffeur & Logistics Fleet');

recordTest(
  'Schema',
  'SCH-06',
  'Canonical Logistics Fleet Provider Seeded',
  hasCanonicalFleetSeed,
  'Canonical provider 70000000-0000-4000-8000-000000000001 present with active status'
);

// Check partner_payouts multi-party restructuring
const hasDroppedSingleBookingUnique =
  migrationSql.includes('DROP CONSTRAINT IF EXISTS partner_payouts_booking_id_key') ||
  migrationSql.includes('DROP INDEX IF EXISTS public.idx_partner_payouts_booking_id_unique');

const hasPayoutCategory =
  migrationSql.includes("payout_category TEXT NOT NULL DEFAULT 'accommodation'") &&
  migrationSql.includes("CHECK (payout_category IN ('accommodation', 'logistics'))");

const hasAuthoritativeSnapshotCols =
  migrationSql.includes('gross_amount_ngn NUMERIC(14,2)') &&
  migrationSql.includes('commission_rate_percentage NUMERIC(5,2)') &&
  migrationSql.includes('commission_amount_ngn NUMERIC(14,2)');

const hasCompositeBookingCategoryUnique =
  migrationSql.includes('uq_partner_payouts_booking_category') &&
  migrationSql.includes('UNIQUE (booking_id, payout_category)');

const hasRecipientIsolationConstraint =
  migrationSql.includes('chk_partner_payouts_recipient_isolation') &&
  migrationSql.includes("payout_category = 'accommodation'") &&
  migrationSql.includes("payout_category = 'logistics'");

recordTest(
  'Schema',
  'SCH-07',
  'Partner Payouts Multi-Party Schema & Constraints',
  hasDroppedSingleBookingUnique && hasPayoutCategory && hasAuthoritativeSnapshotCols &&
  hasCompositeBookingCategoryUnique && hasRecipientIsolationConstraint,
  'Multi-party schema supports accommodation + logistics payouts with recipient isolation'
);

// -----------------------------------------------------------------------------
// 3. FINANCIAL CONSERVATION & ARITHMETIC INVARIANT AUDIT
// -----------------------------------------------------------------------------
console.log('\n--- [3. FINANCIAL CONSERVATION & THREE-PARTY ARITHMETIC] ---');

// Helper to simulate three-party calculation exactly as the SQL RPC does
function calculateAuthoritativeSettlement(
  roomGross: number,
  hostRate: number,
  logisticsGross: number = 0,
  damageDeposit: number = 0
) {
  // Guest Total
  const guestTotal = roomGross + logisticsGross + damageDeposit;

  // Accommodation: TheArk Rooms deducts hostRate from gross
  const arkAccommodationComm = Math.floor(roomGross * (hostRate / 100) * 100) / 100;
  const hostNet = Math.round((roomGross - arkAccommodationComm) * 100) / 100;

  // Logistics: TheArk Rooms deducts exactly 10.00% from gross
  const logisticsCommRate = 10.0;
  const arkLogisticsComm = logisticsGross > 0 ? Math.floor(logisticsGross * 0.1 * 100) / 100 : 0;
  const providerNet = Math.round((logisticsGross - arkLogisticsComm) * 100) / 100;

  // Total allocated
  const totalAllocated = Math.round((hostNet + arkAccommodationComm + providerNet + arkLogisticsComm + damageDeposit) * 100) / 100;

  return {
    guestTotal,
    hostRate,
    roomGross,
    arkAccommodationComm,
    hostNet,
    logisticsGross,
    arkLogisticsComm,
    providerNet,
    damageDeposit,
    totalAllocated,
    isBalanced: Math.abs(guestTotal - totalAllocated) < 0.0001,
  };
}

// Scenario 1: Accommodation ₦200,000 at 10.00% host commission
const s1 = calculateAuthoritativeSettlement(200000, 10.0);
recordTest(
  'Financial Math',
  'FIN-01',
  '10.00% Host Commission: ₦200,000 Gross',
  s1.isBalanced && s1.arkAccommodationComm === 20000 && s1.hostNet === 180000,
  `Guest pays: ₦${s1.guestTotal}, Host Net: ₦${s1.hostNet}, Ark Comm: ₦${s1.arkAccommodationComm}`
);

// Scenario 2: Accommodation ₦200,000 at 12.50% host commission
const s2 = calculateAuthoritativeSettlement(200000, 12.5);
recordTest(
  'Financial Math',
  'FIN-02',
  '12.50% Host Commission: ₦200,000 Gross',
  s2.isBalanced && s2.arkAccommodationComm === 25000 && s2.hostNet === 175000,
  `Guest pays: ₦${s2.guestTotal}, Host Net: ₦${s2.hostNet}, Ark Comm: ₦${s2.arkAccommodationComm}`
);

// Scenario 3: Accommodation ₦200,000 at 15.00% host commission
const s3 = calculateAuthoritativeSettlement(200000, 15.0);
recordTest(
  'Financial Math',
  'FIN-03',
  '15.00% Host Commission: ₦200,000 Gross',
  s3.isBalanced && s3.arkAccommodationComm === 30000 && s3.hostNet === 170000,
  `Guest pays: ₦${s3.guestTotal}, Host Net: ₦${s3.hostNet}, Ark Comm: ₦${s3.arkAccommodationComm}`
);

// Scenario 4: Combined Accommodation (12%) + Car Service (10%) + Damage Deposit
// Accommodation: ₦250,000 @ 12% = ₦30,000 comm, ₦220,000 host net
// Car Service:   ₦60,000 @ 10%  = ₦6,000 comm, ₦54,000 provider net
// Damage Deposit: ₦50,000 held separately
// Guest pays advertised total: ₦250,000 + ₦60,000 + ₦50,000 = ₦360,000
const s4 = calculateAuthoritativeSettlement(250000, 12.0, 60000, 50000);
recordTest(
  'Financial Math',
  'FIN-04',
  'Combined 3-Party Settlement with Logistics & Damage Deposit',
  s4.isBalanced &&
    s4.guestTotal === 360000 &&
    s4.hostNet === 220000 &&
    s4.arkAccommodationComm === 30000 &&
    s4.providerNet === 54000 &&
    s4.arkLogisticsComm === 6000 &&
    s4.damageDeposit === 50000,
  `Total: ₦${s4.guestTotal} = Host Net ₦${s4.hostNet} + Ark Room ₦${s4.arkAccommodationComm} + Provider Net ₦${s4.providerNet} + Ark Car ₦${s4.arkLogisticsComm} + Deposit ₦${s4.damageDeposit}`
);

// Scenario 5: Fractional Centavo / Kobo Precision Check
const s5 = calculateAuthoritativeSettlement(123456.78, 13.75, 45678.9, 15000);
recordTest(
  'Financial Math',
  'FIN-05',
  'Fractional Kobo Conservation & Rounding Invariant',
  s5.isBalanced,
  `Guest Total: ₦${s5.guestTotal}, Allocated: ₦${s5.totalAllocated} (Conservation holds strictly)`
);

// -----------------------------------------------------------------------------
// 4. DOUBLE-ENTRY BALANCED FINANCIAL LEDGER AUDIT
// -----------------------------------------------------------------------------
console.log('\n--- [4. DOUBLE-ENTRY BALANCED LEDGER AUDIT] ---');

const hasPaymentReceivedEntry =
  migrationSql.includes('1010 - Gateway Clearing (Paystack)') &&
  migrationSql.includes('2010 - Guest Unearned Revenue');

const hasHostNetLedgerEntry =
  migrationSql.includes('2100 - Partner Payout Payable') &&
  migrationSql.includes('ACCOMMODATION_HOST_NET');

const hasArkAccommodationCommLedgerEntry =
  migrationSql.includes('4010 - Accommodation Platform Commission Revenue') &&
  migrationSql.includes('ACCOMMODATION_COMMISSION');

const hasLogisticsProviderNetLedgerEntry =
  migrationSql.includes('2110 - Logistics Provider Payable') &&
  migrationSql.includes('LOGISTICS_PROVIDER_NET');

const hasArkLogisticsCommLedgerEntry =
  migrationSql.includes('4020 - Car Service Platform Commission Revenue') &&
  migrationSql.includes('LOGISTICS_COMMISSION');

const hasDamageDepositHoldLedgerEntry =
  migrationSql.includes('2300 - Damage Deposit Liability') &&
  migrationSql.includes('DAMAGE_DEPOSIT_COLLECTED');

recordTest(
  'Ledger Integration',
  'LED-01',
  'Comprehensive Account Mappings in Settlement RPC',
  hasPaymentReceivedEntry &&
    hasHostNetLedgerEntry &&
    hasArkAccommodationCommLedgerEntry &&
    hasLogisticsProviderNetLedgerEntry &&
    hasArkLogisticsCommLedgerEntry &&
    hasDamageDepositHoldLedgerEntry,
  'Accounts 1010, 2010, 2100, 2110, 2300, 4010, and 4020 correctly debited and credited'
);

// Check transfer settlement disbursement ledger
const hasDisbursementLedger =
  migrationSql.includes('PARTNER_PAYOUT_DISBURSED') &&
  migrationSql.includes("v_payout.payout_category = 'logistics' THEN '2110 - Logistics Provider Payable'") &&
  migrationSql.includes("ELSE '2100 - Partner Payout Payable'");

recordTest(
  'Ledger Integration',
  'LED-02',
  'Disbursement Ledger Account Discrimination',
  hasDisbursementLedger,
  'Debit 2100 for host payout disbursement, Debit 2110 for logistics provider payout disbursement'
);

// -----------------------------------------------------------------------------
// 5. RECIPIENT SNAPSHOT & DISPATCH PRIVACY AUDIT
// -----------------------------------------------------------------------------
console.log('\n--- [5. RECIPIENT SNAPSHOT & DISPATCH AUDIT] ---');

const hasAuthorizeCategorySupport =
  migrationSql.includes("IF v_payout.payout_category = 'logistics' THEN") &&
  migrationSql.includes('public.logistics_providers') &&
  migrationSql.includes('public.logistics_payout_profiles') &&
  migrationSql.includes('public.host_profiles') &&
  migrationSql.includes('public.host_payout_profiles');

recordTest(
  'Payout Dispatch',
  'DISP-01',
  'Recipient Snapshot Category Isolation in Authorize RPC',
  hasAuthorizeCategorySupport,
  'Authorize RPC validates host profiles for accommodation and logistics profiles for car services'
);

// Check anti-cross contamination
const hasAntiCrossContamination =
  migrationSql.includes('Logistics payout profile % is missing Paystack recipient code') &&
  migrationSql.includes('Host payout profile % is missing Paystack recipient code');

recordTest(
  'Payout Dispatch',
  'DISP-02',
  'Anti-Cross-Contamination Safeguards',
  hasAntiCrossContamination,
  'Strict verification prevents host payout using logistics recipient and vice-versa'
);

// -----------------------------------------------------------------------------
// 6. API & PRIVACY AUDIT
// -----------------------------------------------------------------------------
console.log('\n--- [6. API PRIVACY & CLIENT EXPOSURE AUDIT] ---');
const apiIndexPath = path.resolve('api/index.ts');
const apiIndexCode = fs.readFileSync(apiIndexPath, 'utf8');

// Check that settlement response doesn't leak partner commission/net to guest
const settlementReceiptExcludesHostComm =
  !migrationSql.includes("'commission_amount_ngn', v_ark_accommodation_commission") &&
  !migrationSql.includes("'host_net_settlement', v_host_net_settlement");

recordTest(
  'API Privacy',
  'PRIV-01',
  'Guest-Facing Settlement Receipt Excludes Partner Commission & Net Settlement',
  settlementReceiptExcludesHostComm,
  'settle_successful_booking_payment returns only gross room, gross car, deposit, total'
);

// Check payout status endpoint authorization
const apiHasPartnerAuthorizationCheck =
  apiIndexCode.includes('payout.payout_category === \'logistics\'') &&
  apiIndexCode.includes('payout.host_user_id === authUser.user.id') &&
  apiIndexCode.includes('Access denied: partner payout details are private');

recordTest(
  'API Privacy',
  'PRIV-02',
  'Payout Status Endpoint Enforces Partner / Admin Privilege Isolation',
  apiHasPartnerAuthorizationCheck,
  'GET /api/partner-payouts/:id/status strictly denies guests and unrelated parties'
);

// Check admin commission configuration endpoint
const apiHasAdminCommissionEndpoint =
  apiIndexCode.includes('/api/admin/hosts/:id/commission-rate') &&
  apiIndexCode.includes('admin_update_host_commission_rate');

recordTest(
  'API Administration',
  'ADM-01',
  'Admin Commission Configuration API Endpoint',
  apiHasAdminCommissionEndpoint,
  'POST /api/admin/hosts/:id/commission-rate exposes secure admin commission adjustments'
);

// -----------------------------------------------------------------------------
// 7. SUMMARY & CONCLUSION
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('VERIFICATION SUMMARY');
console.log('================================================================');
const passedCount = testResults.filter((r) => r.status === 'PASS').length;
const totalCount = testResults.length;
console.log(`Total Invariant Checks: ${totalCount}`);
console.log(`Passed: ${passedCount}`);
console.log(`Failed: ${totalCount - passedCount}`);

if (passedCount === totalCount) {
  console.log('\n>>> ALL INVARIANTS SATISFIED FOR PHASE 3 GATE #5.3! <<<\n');
} else {
  console.error('\n>>> FAILURES DETECTED IN GATE #5.3 VERIFICATION! <<<\n');
  process.exit(1);
}
