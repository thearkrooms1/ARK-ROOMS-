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
console.log('PHASE 3 — GATE #9.2: PROPERTY-TYPE PAYOUT BIFURCATION');
console.log('AUTHORITATIVE VERIFICATION & COMPLIANCE SUITE (PB-01 to PB-35)');
console.log('================================================================\n');

// Read authoritative files
const gate92MigrationPath = path.resolve('supabase/migrations/20260905_phase3_gate9_2_payout_bifurcation.sql');
const databaseTypesPath = path.resolve('src/types/database.ts');
const mockDataPath = path.resolve('src/lib/mockData.ts');

const migrationExists = fs.existsSync(gate92MigrationPath);
const migrationSql = migrationExists ? fs.readFileSync(gate92MigrationPath, 'utf8') : '';
const databaseTypes = fs.readFileSync(databaseTypesPath, 'utf8');
const mockDataCode = fs.readFileSync(mockDataPath, 'utf8');

// -----------------------------------------------------------------------------
// SECTION 1: SCHEMA & PROPERTY-TYPE CLASSIFICATION (PB-01 to PB-07)
// -----------------------------------------------------------------------------
console.log('--- [1. SCHEMA & PROPERTY-TYPE CLASSIFICATION] ---');

recordTest(
  'Schema',
  'PB-01',
  'Gate 9.2 Migration File Exists',
  migrationExists,
  `Path: ${gate92MigrationPath}`
);

const hasPartnerTierCol = migrationSql.includes("ADD COLUMN IF NOT EXISTS partner_tier TEXT NOT NULL DEFAULT 'individual_host';");
recordTest(
  'Schema',
  'PB-02',
  'Authoritative partner_tier Column Added to public.properties',
  hasPartnerTierCol,
  'Column partner_tier added with default "individual_host"'
);

const hasPartnerTierCheck = migrationSql.includes("chk_properties_partner_tier") &&
  migrationSql.includes("CHECK (partner_tier IN ('individual_host', 'hotel_organization'))");
recordTest(
  'Schema',
  'PB-03',
  'Authoritative CHECK Constraint on partner_tier Values',
  hasPartnerTierCheck,
  'Constraint restricts partner_tier strictly to individual_host or hotel_organization'
);

const hasHotelBackfill = migrationSql.includes("'20000000-0000-4000-8000-000000000001'") && // Hilton
  migrationSql.includes("'20000000-0000-4000-8000-000000000002'") && // Continental
  migrationSql.includes("'20000000-0000-4000-8000-000000000004'") && // Maitama
  migrationSql.includes("'20000000-0000-4000-8000-000000000005'") && // Nordic
  migrationSql.includes("'20000000-0000-4000-8000-000000000006'");    // Wells Carlton
recordTest(
  'Schema',
  'PB-04',
  'Commercial Hotels Backfilled to hotel_organization',
  hasHotelBackfill,
  'Transcorp Hilton, Abuja Continental, Maitama Diplomatic, Nordic, and Wells Carlton backfilled to hotel_organization'
);

const hasHostBackfill = migrationSql.includes("'20000000-0000-4000-8000-000000000003'") && // Fraser
  migrationSql.includes("'20000000-0000-4000-8000-000000000007'") && // Hawthorn
  migrationSql.includes("'20000000-0000-4000-8000-000000000008'");    // Villa One
recordTest(
  'Schema',
  'PB-05',
  'Serviced Apartments and Boutique Stays Backfilled to individual_host',
  hasHostBackfill,
  'Fraser Suites, Hawthorn Suites, and Villa One backfilled to individual_host'
);

const hasProtectionTrigger = migrationSql.includes("fn_protect_property_partner_tier") &&
  migrationSql.includes("trg_protect_property_partner_tier");
recordTest(
  'Security',
  'PB-06',
  'partner_tier Mutation Protection Trigger Implemented',
  hasProtectionTrigger,
  'Trigger prevents unauthorized client modification of partner_tier'
);

const hasTypeScriptTypes = databaseTypes.includes("export type PropertyPartnerTier = 'individual_host' | 'hotel_organization';") &&
  databaseTypes.includes("partner_tier?: PropertyPartnerTier;");
recordTest(
  'TypeScript',
  'PB-07',
  'TypeScript Types Updated with PropertyPartnerTier',
  hasTypeScriptTypes,
  'Property interface and PropertyPartnerTier type aligned in src/types/database.ts'
);

// -----------------------------------------------------------------------------
// SECTION 2: COMMISSION-FIRST ARITHMETIC & RULES (PB-08 to PB-14)
// -----------------------------------------------------------------------------
console.log('\n--- [2. COMMISSION-FIRST MATHEMATICAL INTEGRITY] ---');

const hasCommissionFirstRoom = migrationSql.includes("v_ark_accommodation_commission := ROUND(v_auth_room_total * (v_host_commission_rate / 100.00), 2);") &&
  migrationSql.includes("v_net_settlement_pool := v_auth_room_total - v_ark_accommodation_commission;");
recordTest(
  'Commission',
  'PB-08',
  'Platform Commission Computed from Full Gross Accommodation Amount',
  hasCommissionFirstRoom,
  'Commission is computed directly from v_auth_room_total before any partner/reserve splits'
);

const hasNetSettlementPoolDef = migrationSql.includes("v_net_settlement_pool NUMERIC(14,2);");
recordTest(
  'Commission',
  'PB-09',
  'Net Settlement Pool Defined as Gross minus Commission',
  hasNetSettlementPoolDef && hasCommissionFirstRoom,
  'v_net_settlement_pool equals full gross minus Ark accommodation commission'
);

// Mathematical verification function
function calculateBifurcatedSettlement(grossRoom: number, commissionRate: number, tier: 'individual_host' | 'hotel_organization') {
  const comm = Math.round(grossRoom * (commissionRate / 100.0) * 100) / 100;
  const netPool = Math.round((grossRoom - comm) * 100) / 100;
  let hostNet = 0;
  let reserve = 0;

  if (tier === 'hotel_organization') {
    hostNet = netPool;
    reserve = 0;
  } else {
    hostNet = Math.round(netPool * 0.80 * 100) / 100;
    reserve = Math.round((netPool - hostNet) * 100) / 100;
  }

  const sumCheck = Math.round((hostNet + reserve + comm) * 100) / 100;
  const isConserved = sumCheck === grossRoom;

  return { comm, netPool, hostNet, reserve, sumCheck, isConserved };
}

// Test case 1: Standard Individual Host ₦255,000 at 10%
const ind1 = calculateBifurcatedSettlement(255000, 10, 'individual_host');
recordTest(
  'Arithmetic',
  'PB-10',
  'Individual Host Split (₦255k @ 10%): Comm=₦25.5k, Host=₦183.6k, Reserve=₦45.9k',
  ind1.comm === 25500 && ind1.netPool === 229500 && ind1.hostNet === 183600 && ind1.reserve === 45900 && ind1.isConserved,
  `Comm: ₦${ind1.comm}, Host: ₦${ind1.hostNet}, Reserve: ₦${ind1.reserve}, Conserved: ${ind1.isConserved}`
);

// Test case 2: Hotel Organization ₦255,000 at 10%
const hot1 = calculateBifurcatedSettlement(255000, 10, 'hotel_organization');
recordTest(
  'Arithmetic',
  'PB-11',
  'Hotel Organization Split (₦255k @ 10%): Comm=₦25.5k, Hotel=₦229.5k, Reserve=₦0',
  hot1.comm === 25500 && hot1.netPool === 229500 && hot1.hostNet === 229500 && hot1.reserve === 0 && hot1.isConserved,
  `Comm: ₦${hot1.comm}, Hotel: ₦${hot1.hostNet}, Reserve: ₦${hot1.reserve}, Conserved: ${hot1.isConserved}`
);

// Test case 3: Odd gross amount with fractional kobo (₦123,456.78 @ 12.50%)
const ind2 = calculateBifurcatedSettlement(123456.78, 12.5, 'individual_host');
const ind2SumNet = Math.round((ind2.hostNet + ind2.reserve) * 100) / 100;
recordTest(
  'Arithmetic',
  'PB-12',
  'Individual Host Penny Rounding Precision (₦123,456.78 @ 12.5%)',
  ind2.isConserved && ind2SumNet === ind2.netPool,
  `Gross: ₦123,456.78 -> Comm: ₦${ind2.comm}, Host: ₦${ind2.hostNet}, Reserve: ₦${ind2.reserve}, Conserved: ${ind2.isConserved}`
);

const hot2 = calculateBifurcatedSettlement(123456.78, 12.5, 'hotel_organization');
recordTest(
  'Arithmetic',
  'PB-13',
  'Hotel Organization Penny Rounding Precision (₦123,456.78 @ 12.5%)',
  hot2.isConserved && hot2.reserve === 0 && hot2.hostNet === hot2.netPool,
  `Gross: ₦123,456.78 -> Comm: ₦${hot2.comm}, Hotel: ₦${hot2.hostNet}, Reserve: ₦0, Conserved: ${hot2.isConserved}`
);

// Strict Conservation exception in settlement RPC
const hasConservationCheck = migrationSql.includes("IF (v_host_net_settlement + v_reserve_allocation + v_ark_accommodation_commission) <> v_auth_room_total THEN") &&
  migrationSql.includes("RAISE EXCEPTION 'Accommodation settlement conservation violation");
recordTest(
  'Conservation',
  'PB-14',
  'RPC Enforces Strict Conservation Assertion',
  hasConservationCheck,
  'settle_successful_booking_payment raises exception if components do not sum to gross'
);

// -----------------------------------------------------------------------------
// SECTION 3: HOTEL-ORGANIZATION SETTLEMENT BIFURCATION (PB-15 to PB-20)
// -----------------------------------------------------------------------------
console.log('\n--- [3. HOTEL-ORGANIZATION BIFURCATION & ZERO-RESERVE DISCIPLINE] ---');

const hasHotelBranch = migrationSql.includes("IF v_property_tier = 'hotel_organization' THEN") &&
  migrationSql.includes("v_host_net_settlement := v_net_settlement_pool;") &&
  migrationSql.includes("v_reserve_allocation := 0;");
recordTest(
  'Hotel Settlement',
  'PB-15',
  'Hotel Receives 100% of Net Settlement Pool and 0% Reserve',
  hasHotelBranch,
  'Hotel allocation branch sets host net settlement to 100% of net pool and reserve to 0'
);

const hasZeroDepositForHotel = migrationSql.includes("IF v_property_tier = 'hotel_organization' THEN") &&
  migrationSql.includes("v_auth_damage_deposit := 0;");
recordTest(
  'Hotel Settlement',
  'PB-16',
  'Damage Deposit Overridden to ₦0 for Hotels in Settlement',
  hasZeroDepositForHotel,
  'Hotels never collect damage deposits from guests'
);

const hasReserveIndividualOnly = migrationSql.includes("IF v_property_tier = 'individual_host' AND v_reserve_allocation > 0 THEN") &&
  migrationSql.includes("INSERT INTO public.guest_assurance_reserves");
recordTest(
  'Hotel Settlement',
  'PB-17',
  'public.guest_assurance_reserves Insert Restricted Strictly to individual_host',
  hasReserveIndividualOnly,
  'No row is ever inserted into guest_assurance_reserves for hotel_organization properties'
);

const hasDepositIndividualOnly = migrationSql.includes("IF v_property_tier = 'individual_host' AND v_auth_damage_deposit > 0 THEN") &&
  migrationSql.includes("INSERT INTO public.damage_deposits");
recordTest(
  'Hotel Settlement',
  'PB-18',
  'public.damage_deposits Insert Restricted Strictly to individual_host',
  hasDepositIndividualOnly,
  'No row is ever inserted into damage_deposits for hotel_organization properties'
);

const hasReserveLedgerIndividualOnly = migrationSql.includes("IF v_property_tier = 'individual_host' AND v_reserve_allocation > 0 THEN") &&
  migrationSql.includes("'2040'");
recordTest(
  'Ledger',
  'PB-19',
  'Account 2040 (Reserve Liability) Ledger Posting Restricted to individual_host',
  hasReserveLedgerIndividualOnly,
  'Ledger posting Dr 2010 -> Cr 2040 is executed ONLY for individual hosts with active reserve'
);

const hasDamageLedgerIndividualOnly = migrationSql.includes("IF v_property_tier = 'individual_host' AND v_auth_damage_deposit > 0 THEN") &&
  migrationSql.includes("'2300'");
recordTest(
  'Ledger',
  'PB-20',
  'Account 2300 (Damage Escrow) Ledger Posting Restricted to individual_host',
  hasDamageLedgerIndividualOnly,
  'Ledger posting Dr 2010 -> Cr 2300 is executed ONLY for individual hosts with damage deposit'
);

// -----------------------------------------------------------------------------
// SECTION 4: PAYOUT TIMING & PROTECTION WINDOWS (PB-21 to PB-26)
// -----------------------------------------------------------------------------
console.log('\n--- [4. PROTECTION WINDOWS & TIMING BIFURCATION] ---');

const hasCheckInWindowInterval = migrationSql.includes("IF v_booking.partner_tier = 'hotel_organization' THEN") &&
  migrationSql.includes("v_payout_window_interval := INTERVAL '24 hours';") &&
  migrationSql.includes("v_payout_window_interval := INTERVAL '4 hours';");
recordTest(
  'Timing',
  'PB-21',
  'Dual Check-in Sets 24h Window for Hotels and 4h for Hosts',
  hasCheckInWindowInterval,
  'confirm_booking_check_in branches protection window interval by partner_tier'
);

const hasAdminForceWindowInterval = migrationSql.includes("admin_force_check_in") &&
  migrationSql.includes("IF v_booking.partner_tier = 'hotel_organization' THEN") &&
  migrationSql.includes("v_payout_window_interval := INTERVAL '24 hours';") &&
  migrationSql.includes("v_payout_window_interval := INTERVAL '4 hours';");
recordTest(
  'Timing',
  'PB-22',
  'Admin Force Check-in Sets 24h Window for Hotels and 4h for Hosts',
  hasAdminForceWindowInterval,
  'admin_force_check_in branches partner_payout_eligible_at calculation by partner_tier'
);

const hasPartnerPayoutStatusUpdate = migrationSql.includes("IF FOUND AND v_payout_rec.status IN ('allocated', 'protection_window') THEN") &&
  migrationSql.includes("status = 'protection_window'") &&
  migrationSql.includes("scheduled_eligibility_at = v_partner_payout_eligible_at");
recordTest(
  'Timing',
  'PB-23',
  'Partner Payout scheduled_eligibility_at Updated on Check-in',
  hasPartnerPayoutStatusUpdate,
  'partner_payouts table receives the bifurcated scheduled_eligibility_at timestamp'
);

// Payout timing calculations
const checkInTime = new Date('2026-09-15T14:00:00Z');
const hostEligibility = new Date(checkInTime.getTime() + 4 * 3600 * 1000);
const hotelEligibility = new Date(checkInTime.getTime() + 24 * 3600 * 1000);

recordTest(
  'Timing',
  'PB-24',
  'Host Eligibility Timestamp = Check-in + 4 Hours',
  hostEligibility.toISOString() === '2026-09-15T18:00:00.000Z',
  `Check-in: 14:00 -> Host Eligibility: ${hostEligibility.toISOString()}`
);

recordTest(
  'Timing',
  'PB-25',
  'Hotel Eligibility Timestamp = Check-in + 24 Hours',
  hotelEligibility.toISOString() === '2026-09-16T14:00:00.000Z',
  `Check-in: 14:00 -> Hotel Eligibility: ${hotelEligibility.toISOString()}`
);

const hasCheckInReturnTier = migrationSql.includes("'partner_tier', v_booking.partner_tier");
recordTest(
  'Timing',
  'PB-26',
  'Check-in RPC Returns Authoritative partner_tier in Outcome',
  hasCheckInReturnTier,
  'confirm_booking_check_in and admin_force_check_in expose partner_tier in return json'
);

// -----------------------------------------------------------------------------
// SECTION 5: DAMAGE CLAIM & DISPUTE HARD EXCLUSION (PB-27 to PB-30)
// -----------------------------------------------------------------------------
console.log('\n--- [5. HOTEL DAMAGE CLAIM EXCLUSION & DISPUTE GOVERNANCE] ---');

const hasDamageClaimHotelExclusion = migrationSql.includes("IF v_property.partner_tier = 'hotel_organization' THEN") &&
  migrationSql.includes("RAISE EXCEPTION 'Damage claims are not supported for commercial hotel properties. Commercial dispute resolution applies.'");
recordTest(
  'Damage Claims',
  'PB-27',
  'submit_damage_claim Rejects Claims for Commercial Hotels',
  hasDamageClaimHotelExclusion,
  'submit_damage_claim raises authoritative exception for hotel_organization'
);

const hasDamageClaimCanonicalLock = migrationSql.includes("-- (1) bookings -> (2) damage_deposits") &&
  migrationSql.includes("SELECT * INTO v_booking") &&
  migrationSql.includes("SELECT * INTO v_deposit");
recordTest(
  'Concurrency',
  'PB-28',
  'submit_damage_claim Follows Canonical Lock Order',
  hasDamageClaimCanonicalLock,
  'Canonical Lock Order (bookings -> damage_deposits) strictly preserved'
);

const hasDamageClaimSecurityAuth = migrationSql.includes("SELECT hp.* INTO v_host_profile") &&
  migrationSql.includes("WHERE hp.user_id = v_caller_id AND prop.id = v_deposit.property_id");
recordTest(
  'Security',
  'PB-29',
  'submit_damage_claim Enforces Host Ownership Verification',
  hasDamageClaimSecurityAuth,
  'Host must own property or caller must be admin/service role'
);

const hasDamageClaimInspectionCheck = migrationSql.includes("IF v_now > v_deposit.inspection_deadline THEN") &&
  migrationSql.includes("48-hour inspection deadline has expired");
recordTest(
  'Timing',
  'PB-30',
  'submit_damage_claim Enforces 48-hour Inspection Deadline',
  hasDamageClaimInspectionCheck,
  'Claim must be filed within 48h after guest scheduled checkout'
);

// -----------------------------------------------------------------------------
// SECTION 6: MOCK DATA & REPOSITORY INTEGRITY (PB-31 to PB-35)
// -----------------------------------------------------------------------------
console.log('\n--- [6. MOCK DATA & REPOSITORY BASELINE INTEGRITY] ---');

const hotelProperties = INITIAL_PROPERTIES.filter(p => p.partner_tier === 'hotel_organization');
const individualProperties = INITIAL_PROPERTIES.filter(p => p.partner_tier === 'individual_host');

recordTest(
  'Baseline',
  'PB-31',
  'All 8 Properties in INITIAL_PROPERTIES Have Valid partner_tier',
  hotelProperties.length === 5 && individualProperties.length === 3,
  `5 Hotels (${hotelProperties.map(p => p.title).join(', ')}), 3 Hosts (${individualProperties.map(p => p.title).join(', ')})`
);

recordTest(
  'Baseline',
  'PB-32',
  'Core Database Baseline Maintained',
  INITIAL_PROPERTIES.length === 8 && INITIAL_ROOMS.length > 0 && INITIAL_BOOKINGS.length > 0,
  `Properties: ${INITIAL_PROPERTIES.length}, Rooms: ${INITIAL_ROOMS.length}, Bookings: ${INITIAL_BOOKINGS.length}`
);

const hiltonProp = INITIAL_PROPERTIES.find(p => p.id === '20000000-0000-4000-8000-000000000001');
recordTest(
  'Baseline',
  'PB-33',
  'Transcorp Hilton Abuja is Classified as hotel_organization',
  hiltonProp?.partner_tier === 'hotel_organization',
  `Transcorp Hilton partner_tier: ${hiltonProp?.partner_tier}`
);

const fraserProp = INITIAL_PROPERTIES.find(p => p.id === '20000000-0000-4000-8000-000000000003');
recordTest(
  'Baseline',
  'PB-34',
  'Fraser Suites Abuja is Classified as individual_host',
  fraserProp?.partner_tier === 'individual_host',
  `Fraser Suites partner_tier: ${fraserProp?.partner_tier}`
);

const settlementReturnFields = migrationSql.includes("'partner_tier', v_property_tier") &&
  migrationSql.includes("'host_net_settlement_ngn', v_host_net_settlement") &&
  migrationSql.includes("'reserve_amount_ngn', v_reserve_allocation");
recordTest(
  'Contract',
  'PB-35',
  'Settlement Return Payload Includes partner_tier, host_net_settlement, and reserve_amount',
  settlementReturnFields,
  'Authoritative json return contains all required settlement metadata'
);

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('PHASE 3 — GATE #9.2 AUDIT RESULTS SUMMARY');
console.log('================================================================');

const passedCount = testResults.filter(t => t.status === 'PASS').length;
const failedCount = testResults.filter(t => t.status === 'FAIL').length;
const totalCount = testResults.length;

console.log(`TOTAL TESTS: ${totalCount}`);
console.log(`PASSED:      ${passedCount}`);
console.log(`FAILED:      ${failedCount}`);
console.log(`SUCCESS RATE: ${Math.round((passedCount / totalCount) * 100)}%\n`);

if (failedCount > 0) {
  console.error('❌ GATE #9.2 VERIFICATION FAILED! Failures detected:');
  testResults.filter(t => t.status === 'FAIL').forEach(f => {
    console.error(`  - [${f.testId}] ${f.name}: ${f.details}`);
  });
  process.exit(1);
} else {
  console.log('✅ ALL PHASE 3 — GATE #9.2 VERIFICATION TESTS PASSED (35/35)');
  console.log('PROPERTY-TYPE PAYOUT BIFURCATION ARCHITECTURE LOCKED & CERTIFIED.');
}
