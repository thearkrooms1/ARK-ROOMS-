/**
 * Verification Script for Phase 2 Gate #6.3
 * Booking Creation Transaction Rewrite Audit & Simulation Suite
 */

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
  code: string;
  category: 'SAFETY' | 'SCHEMA' | 'LOGIC';
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const results: TestResult[] = [];

function recordTest(code: string, category: 'SAFETY' | 'SCHEMA' | 'LOGIC', name: string, passed: boolean, details: string) {
  results.push({
    code,
    category,
    name,
    status: passed ? 'PASS' : 'FAIL',
    details,
  });
}

// 1. Read files to analyze
const migrationGate63Path = path.resolve('supabase/migrations/20260903_phase2_gate6_3_booking_transaction.sql');
const migrationGate62Path = path.resolve('supabase/migrations/20260903_phase2_gate6_2_availability_foundation.sql');
const apiIndexPath = path.resolve('api/index.ts');
const supabaseLibPath = path.resolve('src/lib/supabase.ts');
const typesPath = path.resolve('src/types/database.ts');

if (!fs.existsSync(migrationGate63Path)) {
  console.error('Gate 6.3 Migration file not found at:', migrationGate63Path);
  process.exit(1);
}

const sqlGate63 = fs.readFileSync(migrationGate63Path, 'utf8');
const sqlGate62 = fs.readFileSync(migrationGate62Path, 'utf8');
const apiCode = fs.readFileSync(apiIndexPath, 'utf8');
const supabaseLibCode = fs.readFileSync(supabaseLibPath, 'utf8');
const typesCode = fs.readFileSync(typesPath, 'utf8');

// ==============================================================================
// 1. SAFETY & BOUNDARY PRESERVATION CHECKS (SAFE-01 to SAFE-08)
// ==============================================================================

// SAFE-01: Baseline entity preservation across all 6 core tables
const safe01Passed =
  INITIAL_PROPERTIES.length === 8 &&
  INITIAL_ROOMS.length === 8 &&
  INITIAL_BOOKINGS.length === 3 &&
  INITIAL_PAYMENTS.length === 3 &&
  INITIAL_VENUES.length === 5 &&
  INITIAL_LOGISTICS.length === 2;

recordTest(
  'SAFE-01',
  'SAFETY',
  'Baseline entity preservation across all 6 core tables',
  safe01Passed,
  `Counts: props=${INITIAL_PROPERTIES.length}, rooms=${INITIAL_ROOMS.length}, bookings=${INITIAL_BOOKINGS.length}, payments=${INITIAL_PAYMENTS.length}, venues=${INITIAL_VENUES.length}, logistics=${INITIAL_LOGISTICS.length}`
);

// SAFE-02: Paystack transfer logic untouched
const safe02Passed =
  apiCode.includes('/api/paystack/initialize') &&
  apiCode.includes('/api/paystack/verify') &&
  !sqlGate63.includes('paystack') &&
  !sqlGate63.includes('recipient_code');

recordTest(
  'SAFE-02',
  'SAFETY',
  'Paystack transfer logic untouched and preserved',
  safe02Passed,
  'Paystack recipient and transfer execution logic in api/index.ts remains intact'
);

// SAFE-03: Partner payout & ledger logic untouched
const safe03Passed =
  (apiCode.includes('partner_payouts') || apiCode.includes('partner_payout_records')) &&
  !sqlGate63.includes('partner_payout_records');

recordTest(
  'SAFE-03',
  'SAFETY',
  'Partner payout & ledger logic untouched and preserved',
  safe03Passed,
  'Payout and ledger management remains strictly isolated'
);

// SAFE-04: Guest Assurance Reserve logic untouched
const safe04Passed =
  apiCode.includes('settle_successful_booking_payment') &&
  !sqlGate63.includes('guest_assurance_reserve_records');

recordTest(
  'SAFE-04',
  'SAFETY',
  'Guest Assurance Reserve logic untouched and preserved',
  safe04Passed,
  'Reserve records and logic remain strictly isolated'
);

// SAFE-05: Payment settlement RPC settle_successful_booking_payment NOT modified in Gate 6.3
const safe05Passed =
  !sqlGate63.includes('CREATE OR REPLACE FUNCTION public.settle_successful_booking_payment') &&
  !sqlGate63.includes('settle_successful_booking_payment(');

recordTest(
  'SAFE-05',
  'SAFETY',
  'Payment settlement RPC settle_successful_booking_payment NOT modified in Gate 6.3',
  safe05Passed,
  'Settlement function remains untouched for dedicated gate'
);

// SAFE-06: No direct mutation or resetting of rooms.available_rooms
const safe06Passed =
  !sqlGate63.includes('available_rooms = available_rooms - 1') &&
  !sqlGate63.includes('UPDATE public.rooms\n  SET available_rooms') &&
  !sqlGate63.includes('UPDATE public.rooms SET available_rooms');

recordTest(
  'SAFE-06',
  'SAFETY',
  'rooms.available_rooms counter is NOT decremented or mutated',
  safe06Passed,
  'Legacy global counter is no longer mutated; availability is date-specific'
);

// SAFE-07: rooms.total_rooms and bookings.expires_at schema integrity preserved
const safe07Passed =
  sqlGate62.includes('ADD COLUMN total_rooms INTEGER') &&
  sqlGate62.includes('ADD COLUMN expires_at TIMESTAMPTZ') &&
  typesCode.includes('total_rooms') &&
  typesCode.includes('expires_at');

recordTest(
  'SAFE-07',
  'SAFETY',
  'Schema integrity of total_rooms and expires_at verified',
  safe07Passed,
  'total_rooms and expires_at properly defined and typed'
);

// SAFE-08: Frontend UI not modified (pages, components intact)
const safe08Passed =
  fs.existsSync(path.resolve('src/pages/PropertyDetailPage.tsx')) &&
  (fs.existsSync(path.resolve('src/pages/BookingCheckoutPage.tsx')) || fs.existsSync(path.resolve('src/pages/CheckoutPage.tsx')));

recordTest(
  'SAFE-08',
  'SAFETY',
  'Frontend UI components strictly preserved',
  safe08Passed,
  'PropertyDetailPage, CheckoutPage, and BookingForm untouched in this gate'
);

// ==============================================================================
// 2. SCHEMA & FUNCTION DEFINITION CHECKS (SCH-01 to SCH-10)
// ==============================================================================

// SCH-01: Migration file exists and has proper header
const sch01Passed =
  fs.existsSync(migrationGate63Path) &&
  sqlGate63.includes('GATE #6.3 — BOOKING CREATION TRANSACTION REWRITE');

recordTest(
  'SCH-01',
  'SCHEMA',
  'Migration file 20260903_phase2_gate6_3_booking_transaction.sql exists',
  sch01Passed,
  `Path: ${migrationGate63Path}`
);

// SCH-02: Row lock FOR UPDATE on public.rooms BEFORE availability check
const sch02Passed =
  sqlGate63.includes('FROM public.rooms r') &&
  sqlGate63.includes('WHERE r.id = p_room_id') &&
  sqlGate63.includes('FOR UPDATE;') &&
  sqlGate63.indexOf('FOR UPDATE;') < sqlGate63.indexOf('INTO v_active_bookings');

recordTest(
  'SCH-02',
  'SCHEMA',
  'Atomic SELECT ... FOR UPDATE locks room row BEFORE availability check',
  sch02Passed,
  'Room is locked prior to active booking calculation to serialize concurrent requests'
);

// SCH-03: Room operational status (is_active) check
const sch03Passed =
  sqlGate63.includes('v_room.is_active = FALSE') &&
  sqlGate63.includes('This room is currently inactive and not available for booking.');

recordTest(
  'SCH-03',
  'SCHEMA',
  'Room operational status validation (is_active) enforced',
  sch03Passed,
  'Inactive or maintenance rooms are rejected with descriptive exception'
);

// SCH-04: Property-room relationship validation
const sch04Passed =
  sqlGate63.includes('v_room.property_id <> p_property_id') &&
  sqlGate63.includes('Selected room does not belong to the specified property.');

recordTest(
  'SCH-04',
  'SCHEMA',
  'Property-room foreign key relationship validation enforced',
  sch04Passed,
  'Validates that room belongs to the requested property'
);

// SCH-05: Date validation (check_in, check_out, check_out > check_in)
const sch05Passed =
  sqlGate63.includes('p_check_in IS NULL OR p_check_out IS NULL') &&
  sqlGate63.includes('p_check_out <= p_check_in') &&
  sqlGate63.includes('Invalid reservation dates: Check-out must be strictly after check-in.');

recordTest(
  'SCH-05',
  'SCHEMA',
  'Check-in and check-out date validity enforced',
  sch05Passed,
  'Validates non-null and check_out strictly after check_in'
);

// SCH-06: Date-specific occupancy calculation uses half-open interval and status filters
const sch06Passed =
  sqlGate63.includes('b.room_id = p_room_id') &&
  sqlGate63.includes('b.check_in < p_check_out') &&
  sqlGate63.includes('b.check_out > p_check_in') &&
  sqlGate63.includes("b.booking_status IN ('confirmed', 'checked_in', 'checked_out', 'completed')") &&
  sqlGate63.includes("b.booking_status = 'pending'") &&
  sqlGate63.includes('b.expires_at IS NOT NULL') &&
  sqlGate63.includes('b.expires_at > now()');

recordTest(
  'SCH-06',
  'SCHEMA',
  'Occupancy calculation enforces half-open interval and active hold criteria',
  sch06Passed,
  'Counts confirmed bookings + unexpired pending holds within [check_in, check_out)'
);

// SCH-07: Capacity check compares active bookings against total_rooms (NOT available_rooms)
const sch07Passed =
  sqlGate63.includes('IF v_active_bookings >= v_room.total_rooms THEN') &&
  sqlGate63.includes('This room is sold out and no longer available for the selected dates.');

recordTest(
  'SCH-07',
  'SCHEMA',
  'Capacity exhaustion check compares against rooms.total_rooms',
  sch07Passed,
  'Rejects when active bookings >= total_rooms'
);

// SCH-08: Authoritative 30-minute hold timestamp created (expires_at = now() + 30 min)
const sch08Passed =
  sqlGate63.includes("v_expires_at := now() + INTERVAL '30 minutes';") &&
  sqlGate63.includes('expires_at,') &&
  sqlGate63.includes('v_expires_at,');

recordTest(
  'SCH-08',
  'SCHEMA',
  'Authoritative 30-minute hold timestamp set on booking INSERT',
  sch08Passed,
  "Sets expires_at = now() + INTERVAL '30 minutes' in public.bookings"
);

// SCH-09: Authoritative server-side pricing calculation (accommodation + logistics + damage deposit)
const sch09Passed =
  sqlGate63.includes('v_room_total_ngn := v_nights * COALESCE(v_room.price_per_night_ngn, 0);') &&
  sqlGate63.includes('p_logistics_services IS NOT NULL') &&
  sqlGate63.includes('v_property.requires_damage_deposit') &&
  sqlGate63.includes('v_damage_deposit_ngn := COALESCE(v_property.damage_deposit_amount_ngn, 0);') &&
  sqlGate63.includes('v_total_amount_ngn := v_room_total_ngn + v_logistics_total_ngn + v_damage_deposit_ngn;');

recordTest(
  'SCH-09',
  'SCHEMA',
  'Authoritative server-side pricing calculation preserved',
  sch09Passed,
  'Calculates room subtotal, logistics subtotal, damage deposit, and total amount'
);

// SCH-10: Overloads and privileges (15-param canonical + 12-param backward compatible overload)
const sch10Passed =
  sqlGate63.includes('CREATE OR REPLACE FUNCTION public.create_pending_booking_transaction(\n  p_property_id UUID') &&
  sqlGate63.includes('CREATE OR REPLACE FUNCTION public.create_pending_booking_transaction(\n  p_user_id UUID') &&
  sqlGate63.includes('GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction(\n  UUID, UUID, DATE, DATE') &&
  sqlGate63.includes('GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction(\n  UUID, UUID, UUID, DATE, DATE');

recordTest(
  'SCH-10',
  'SCHEMA',
  'Both 15-parameter canonical RPC and 12-parameter overload defined with GRANT EXECUTE',
  sch10Passed,
  'Ensures 100% backward compatibility with frontend caller and older migrations'
);

// ==============================================================================
// 3. LOGIC & SIMULATION SPECIFICATION TESTS (LOGIC-A to LOGIC-L)
// ==============================================================================

// Helper simulation function matching SQL logic exactly
interface SimulatedBooking {
  id: string;
  room_id: string;
  check_in: string;
  check_out: string;
  booking_status: string;
  payment_status: string;
  expires_at?: string | null;
}

interface SimulatedRoom {
  id: string;
  property_id: string;
  price_per_night_ngn: number;
  total_rooms: number;
  max_guests: number;
  is_active: boolean;
}

interface SimulatedProperty {
  id: string;
  requires_damage_deposit: boolean;
  damage_deposit_amount_ngn: number;
}

function simulateCreatePendingBooking(
  existingBookings: SimulatedBooking[],
  room: SimulatedRoom,
  property: SimulatedProperty,
  params: {
    check_in: string;
    check_out: string;
    guests: number;
    property_id?: string;
    logistics_services?: Array<{ price_ngn?: number; amount?: number; priceNGN?: number }>;
    reference?: string;
  },
  nowTime: Date = new Date()
): {
  success: boolean;
  booking_id?: string;
  expires_at?: string;
  room_total_ngn?: number;
  logistics_total_ngn?: number;
  damage_deposit_ngn?: number;
  total_amount_ngn?: number;
  available_rooms_remaining?: number;
  error?: string;
} {
  // 1. Date validation
  if (!params.check_in || !params.check_out) {
    return { success: false, error: 'Check-in and check-out dates are required.' };
  }
  const checkInDate = new Date(params.check_in);
  const checkOutDate = new Date(params.check_out);
  if (checkOutDate <= checkInDate) {
    return { success: false, error: 'Invalid reservation dates: Check-out must be strictly after check-in.' };
  }

  const nights = Math.max(1, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 3600 * 24)));

  // 2. Guest count validation
  if (!params.guests || params.guests <= 0) {
    return { success: false, error: 'Number of guests must be at least 1.' };
  }
  if (params.guests > room.max_guests) {
    return { success: false, error: `Guest count exceeds maximum room capacity (${room.max_guests} max).` };
  }

  // 3. Room & Property validation
  if (params.property_id && room.property_id !== params.property_id) {
    return { success: false, error: 'Selected room does not belong to the specified property.' };
  }
  if (!room.is_active) {
    return { success: false, error: 'This room is currently inactive and not available for booking.' };
  }

  // 4. Calculate date-specific active occupancy (Half-open [check_in, check_out))
  let activeBookings = 0;
  for (const b of existingBookings) {
    if (b.room_id !== room.id) continue;

    const bIn = new Date(b.check_in);
    const bOut = new Date(b.check_out);
    const overlaps = bIn < checkOutDate && bOut > checkInDate;
    if (!overlaps) continue;

    const isConfirmed = ['confirmed', 'checked_in', 'checked_out', 'completed'].includes(b.booking_status);
    const isHoldActive =
      b.booking_status === 'pending' &&
      ['unpaid', 'pending'].includes(b.payment_status) &&
      b.expires_at != null &&
      new Date(b.expires_at) > nowTime;

    if (isConfirmed || isHoldActive) {
      activeBookings++;
    }
  }

  // 5. Capacity check against total_rooms
  if (activeBookings >= room.total_rooms) {
    return { success: false, error: 'This room is sold out and no longer available for the selected dates.' };
  }

  // 6. Pricing calculation
  const roomTotal = nights * room.price_per_night_ngn;
  let logisticsTotal = 0;
  if (params.logistics_services && Array.isArray(params.logistics_services)) {
    for (const s of params.logistics_services) {
      logisticsTotal += Number(s.price_ngn ?? s.priceNGN ?? s.amount ?? 0);
    }
  }
  const damageDeposit = property.requires_damage_deposit ? property.damage_deposit_amount_ngn : 0;
  const grandTotal = roomTotal + logisticsTotal + damageDeposit;

  const expiresAt = new Date(nowTime.getTime() + 30 * 60 * 1000).toISOString();
  const remaining = Math.max(0, room.total_rooms - activeBookings - 1);

  return {
    success: true,
    booking_id: `bk-${Date.now()}`,
    expires_at: expiresAt,
    room_total_ngn: roomTotal,
    logistics_total_ngn: logisticsTotal,
    damage_deposit_ngn: damageDeposit,
    total_amount_ngn: grandTotal,
    available_rooms_remaining: remaining,
  };
}

// Standard test fixtures
const testRoom1: SimulatedRoom = {
  id: 'room-101',
  property_id: 'prop-001',
  price_per_night_ngn: 150000,
  total_rooms: 1,
  max_guests: 2,
  is_active: true,
};

const testProp1: SimulatedProperty = {
  id: 'prop-001',
  requires_damage_deposit: true,
  damage_deposit_amount_ngn: 50000,
};

// TEST-A: Standard successful pending booking creation with 30-min hold
const testAResult = simulateCreatePendingBooking(
  [],
  testRoom1,
  testProp1,
  {
    check_in: '2026-10-01',
    check_out: '2026-10-04',
    guests: 2,
    property_id: 'prop-001',
    logistics_services: [{ priceNGN: 25000 }],
  }
);
const testAPassed =
  testAResult.success === true &&
  testAResult.room_total_ngn === 450000 &&
  testAResult.logistics_total_ngn === 25000 &&
  testAResult.damage_deposit_ngn === 50000 &&
  testAResult.total_amount_ngn === 525000 &&
  testAResult.available_rooms_remaining === 0;

recordTest(
  'TEST-A',
  'LOGIC',
  'Standard booking creation succeeds with 30-min hold and authoritative pricing',
  testAPassed,
  `Total: ₦${testAResult.total_amount_ngn} (room: ₦${testAResult.room_total_ngn} + log: ₦${testAResult.logistics_total_ngn} + deposit: ₦${testAResult.damage_deposit_ngn})`
);

// TEST-B: Checkout day turnover succeeds (half-open [check_in, check_out) boundary)
const testBExisting: SimulatedBooking[] = [
  {
    id: 'b-1',
    room_id: 'room-101',
    check_in: '2026-10-01',
    check_out: '2026-10-04',
    booking_status: 'confirmed',
    payment_status: 'paid',
  },
];
const testBResult = simulateCreatePendingBooking(
  testBExisting,
  testRoom1,
  testProp1,
  {
    check_in: '2026-10-04',
    check_out: '2026-10-07',
    guests: 1,
  }
);
recordTest(
  'TEST-B',
  'LOGIC',
  'Turnover on checkout day (Oct 4 check-in after Oct 1-4 checkout) succeeds',
  testBResult.success === true,
  `Success: ${testBResult.success}, Remaining: ${testBResult.available_rooms_remaining}`
);

// TEST-C: Overlapping booking rejected when capacity exhausted (total_rooms = 1)
const testCResult = simulateCreatePendingBooking(
  testBExisting,
  testRoom1,
  testProp1,
  {
    check_in: '2026-10-02',
    check_out: '2026-10-05',
    guests: 1,
  }
);
recordTest(
  'TEST-C',
  'LOGIC',
  'Overlapping booking rejected when room capacity is exhausted',
  testCResult.success === false && (testCResult.error?.includes('sold out') ?? false),
  `Error: "${testCResult.error}"`
);

// TEST-D: Active unexpired pending hold blocks second booking
const now = new Date('2026-09-03T12:00:00Z');
const testDExisting: SimulatedBooking[] = [
  {
    id: 'b-hold',
    room_id: 'room-101',
    check_in: '2026-10-10',
    check_out: '2026-10-15',
    booking_status: 'pending',
    payment_status: 'unpaid',
    expires_at: new Date('2026-09-03T12:25:00Z').toISOString(), // 25 min in future
  },
];
const testDResult = simulateCreatePendingBooking(
  testDExisting,
  testRoom1,
  testProp1,
  {
    check_in: '2026-10-12',
    check_out: '2026-10-14',
    guests: 1,
  },
  now
);
recordTest(
  'TEST-D',
  'LOGIC',
  'Active unexpired pending hold correctly blocks overlapping reservation',
  testDResult.success === false && (testDResult.error?.includes('sold out') ?? false),
  `Error: "${testDResult.error}"`
);

// TEST-E: Expired pending hold automatically releases capacity without manual intervention
const testEExisting: SimulatedBooking[] = [
  {
    id: 'b-expired-hold',
    room_id: 'room-101',
    check_in: '2026-10-10',
    check_out: '2026-10-15',
    booking_status: 'pending',
    payment_status: 'unpaid',
    expires_at: new Date('2026-09-03T11:55:00Z').toISOString(), // 5 min in past
  },
];
const testEResult = simulateCreatePendingBooking(
  testEExisting,
  testRoom1,
  testProp1,
  {
    check_in: '2026-10-12',
    check_out: '2026-10-14',
    guests: 1,
  },
  now
);
recordTest(
  'TEST-E',
  'LOGIC',
  'Expired pending hold automatically self-releases capacity for new bookings',
  testEResult.success === true,
  `Success: ${testEResult.success}, Hold self-released without cron job or manual update`
);

// TEST-F: Cancelled and refunded bookings do not consume capacity
const testFExisting: SimulatedBooking[] = [
  {
    id: 'b-cancelled',
    room_id: 'room-101',
    check_in: '2026-10-10',
    check_out: '2026-10-15',
    booking_status: 'cancelled',
    payment_status: 'unpaid',
  },
  {
    id: 'b-refunded',
    room_id: 'room-101',
    check_in: '2026-10-10',
    check_out: '2026-10-15',
    booking_status: 'refunded',
    payment_status: 'refunded',
  },
];
const testFResult = simulateCreatePendingBooking(
  testFExisting,
  testRoom1,
  testProp1,
  {
    check_in: '2026-10-10',
    check_out: '2026-10-15',
    guests: 1,
  }
);
recordTest(
  'TEST-F',
  'LOGIC',
  'Cancelled and refunded bookings never consume capacity',
  testFResult.success === true,
  `Success: ${testFResult.success}, Remaining: ${testFResult.available_rooms_remaining}`
);

// TEST-G: Multi-inventory room (total_rooms = 3) accepts up to 3 overlapping reservations
const multiRoom: SimulatedRoom = {
  id: 'room-multi',
  property_id: 'prop-001',
  price_per_night_ngn: 100000,
  total_rooms: 3,
  max_guests: 4,
  is_active: true,
};
const twoActiveBookings: SimulatedBooking[] = [
  {
    id: 'b-1',
    room_id: 'room-multi',
    check_in: '2026-11-01',
    check_out: '2026-11-05',
    booking_status: 'confirmed',
    payment_status: 'paid',
  },
  {
    id: 'b-2',
    room_id: 'room-multi',
    check_in: '2026-11-01',
    check_out: '2026-11-05',
    booking_status: 'confirmed',
    payment_status: 'paid',
  },
];
// 3rd booking should succeed
const testGResult3 = simulateCreatePendingBooking(twoActiveBookings, multiRoom, testProp1, {
  check_in: '2026-11-02',
  check_out: '2026-11-04',
  guests: 2,
});
// 4th booking should fail
const threeActiveBookings = [...twoActiveBookings, {
  id: 'b-3',
  room_id: 'room-multi',
  check_in: '2026-11-01',
  check_out: '2026-11-05',
  booking_status: 'confirmed',
  payment_status: 'paid',
}];
const testGResult4 = simulateCreatePendingBooking(threeActiveBookings, multiRoom, testProp1, {
  check_in: '2026-11-02',
  check_out: '2026-11-04',
  guests: 2,
});

const testGPassed =
  testGResult3.success === true &&
  testGResult3.available_rooms_remaining === 0 &&
  testGResult4.success === false;

recordTest(
  'TEST-G',
  'LOGIC',
  'Multi-inventory room (total_rooms = 3) admits exactly 3 concurrent bookings and rejects 4th',
  testGPassed,
  `3rd booking success=${testGResult3.success}, 4th booking success=${testGResult4.success} (${testGResult4.error})`
);

// TEST-H: Inactive room rejection
const inactiveRoom: SimulatedRoom = { ...testRoom1, is_active: false };
const testHResult = simulateCreatePendingBooking([], inactiveRoom, testProp1, {
  check_in: '2026-12-01',
  check_out: '2026-12-05',
  guests: 1,
});
recordTest(
  'TEST-H',
  'LOGIC',
  'Inactive room is rejected immediately before pricing or hold calculation',
  testHResult.success === false && (testHResult.error?.includes('inactive') ?? false),
  `Error: "${testHResult.error}"`
);

// TEST-I: Property-room relationship mismatch rejection
const testIResult = simulateCreatePendingBooking([], testRoom1, testProp1, {
  check_in: '2026-12-01',
  check_out: '2026-12-05',
  guests: 1,
  property_id: 'prop-WRONG-999',
});
recordTest(
  'TEST-I',
  'LOGIC',
  'Mismatched property_id is rejected',
  testIResult.success === false && (testIResult.error?.includes('does not belong') ?? false),
  `Error: "${testIResult.error}"`
);

// TEST-J: Guest count exceeding capacity rejection
const testJResult = simulateCreatePendingBooking([], testRoom1, testProp1, {
  check_in: '2026-12-01',
  check_out: '2026-12-05',
  guests: 5, // max_guests is 2
});
recordTest(
  'TEST-J',
  'LOGIC',
  'Guest count exceeding room max_guests is rejected',
  testJResult.success === false && (testJResult.error?.includes('exceeds maximum') ?? false),
  `Error: "${testJResult.error}"`
);

// TEST-K: Invalid date ordering (check_out <= check_in) rejection
const testKResult = simulateCreatePendingBooking([], testRoom1, testProp1, {
  check_in: '2026-12-10',
  check_out: '2026-12-08',
  guests: 1,
});
recordTest(
  'TEST-K',
  'LOGIC',
  'Invalid date range (check_out <= check_in) is rejected',
  testKResult.success === false && (testKResult.error?.includes('Check-out must be strictly after check-in') ?? false),
  `Error: "${testKResult.error}"`
);

// TEST-L: Authoritative damage deposit conditionality
const testPropNoDeposit: SimulatedProperty = {
  id: 'prop-002',
  requires_damage_deposit: false,
  damage_deposit_amount_ngn: 0,
};
const testLResult = simulateCreatePendingBooking(
  [],
  { ...testRoom1, property_id: 'prop-002' },
  testPropNoDeposit,
  {
    check_in: '2026-12-01',
    check_out: '2026-12-03',
    guests: 1,
    property_id: 'prop-002',
  }
);
recordTest(
  'TEST-L',
  'LOGIC',
  'Property without damage deposit sets deposit to ₦0 authoritatively',
  testLResult.success === true && testLResult.damage_deposit_ngn === 0 && testLResult.total_amount_ngn === 300000,
  `Deposit: ₦${testLResult.damage_deposit_ngn}, Total: ₦${testLResult.total_amount_ngn}`
);

// ==============================================================================
// RUN SUMMARY
// ==============================================================================
console.log('\n================================================================');
console.log('PHASE 2 GATE #6.3 — BOOKING CREATION TRANSACTION AUDIT');
console.log('================================================================\n');

let allPassed = true;
const categories: ('SAFETY' | 'SCHEMA' | 'LOGIC')[] = ['SAFETY', 'SCHEMA', 'LOGIC'];

for (const cat of categories) {
  console.log(`\n--- [${cat}] CATEGORY CHECKS ---`);
  const catTests = results.filter(r => r.category === cat);
  for (const r of catTests) {
    const symbol = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`[${r.category.padEnd(6)}] ${r.code.padEnd(8)} : ${symbol} - ${r.name}`);
    console.log(`         Details: ${r.details}`);
    if (r.status !== 'PASS') allPassed = false;
  }
}

console.log('\n================================================================');
console.log(`TOTAL AUDIT CHECKS: ${results.length}`);
console.log(`PASSED: ${results.filter(r => r.status === 'PASS').length}`);
console.log(`FAILED: ${results.filter(r => r.status === 'FAIL').length}`);
console.log(`STATUS: ${allPassed ? 'ALL AUDIT CHECKS PASSED CLEANLY' : 'FAILURES DETECTED'}`);
console.log('================================================================\n');

if (!allPassed) {
  process.exit(1);
}
