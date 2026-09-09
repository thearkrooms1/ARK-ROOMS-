/**
 * Supabase Database Entities for TheArkRooms
 */

export type UserRole = 'customer' | 'admin';

export type HostStatus = 'pending' | 'active' | 'suspended';

export interface HostProfile {
  id: string;
  user_id: string; // references auth.users.id
  host_status: HostStatus;
  commission_rate_percentage?: number;
  created_at: string;
  updated_at?: string;
  profile?: Profile;
}

export interface LogisticsProvider {
  id: string;
  user_id?: string | null;
  company_name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  provider_status: 'pending' | 'active' | 'suspended';
  commission_rate_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface LogisticsPayoutProfile {
  id: string;
  provider_id: string;
  bank_name: string;
  bank_code: string;
  account_number_masked: string;
  account_name: string;
  paystack_recipient_code: string;
  is_verified: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string; // references auth.users.id
  full_name: string;
  email?: string;
  phone?: string;
  country?: string;
  role: UserRole;
  created_at: string;
  updated_at?: string;
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  address: string;
  latitude: number;
  longitude: number;
  image_url?: string;
  category?: string; // e.g. 'Convention Center', 'Exhibition Hall', 'Church Arena', 'Hotel Event Hall'
  upcoming_events_count?: number;
  status?: boolean;
  created_at: string;
}

export type PropertyPartnerTier = 'individual_host' | 'hotel_organization';

export type PropertyApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended';

export type PropertyMediaAuditAction = 'staging_upload' | 'public_promotion' | 'quarantine_demotion' | 'deletion_cleanup' | 'admin_override';

export type MediaExecutionStatus = 'success' | 'failed' | 'pending' | 'reconciliation_required';

export type MediaPublicationStatus = 'not_published' | 'publishing' | 'published' | 'reconciliation_required';

export interface PropertyMediaAudit {
  id: string;
  property_id: string;
  room_id?: string | null;
  action: PropertyMediaAuditAction;
  source_bucket: string;
  target_bucket?: string | null;
  storage_path: string;
  public_url?: string | null;
  performed_by?: string | null;
  performed_at: string;
  execution_status?: MediaExecutionStatus;
  operation_id?: string | null;
  media_revision?: number | null;
  metadata?: Record<string, any>;
}

export interface PropertyApprovalAudit {
  id: string;
  property_id: string;
  admin_id: string;
  previous_status: PropertyApprovalStatus | string;
  new_status: PropertyApprovalStatus | string;
  rejection_reason?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface Property {
  id: string;
  venue_id: string;
  host_id?: string | null;
  partner_tier?: PropertyPartnerTier;
  approval_status?: PropertyApprovalStatus;
  is_active?: boolean;
  media_revision?: number;
  media_publication_status?: MediaPublicationStatus;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  requires_damage_deposit?: boolean;
  damage_deposit_amount_ngn?: number;
  title: string;
  description: string;
  property_type: string; // e.g. 'Hotel', 'Serviced Apartment', 'Boutique Stay', 'Guest House'
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  distance_to_venue_km: number | null;
  rating: number;
  is_verified: boolean;
  amenities: string[];
  check_in_time: string;
  check_out_time: string;
  image_url?: string;
  photos?: string[];
  phone?: string;
  email?: string;
  website?: string;
  min_price?: number;
  available_rooms_count?: number;
  is_sold_out?: boolean;
  has_availability?: boolean;
  qualifying_rooms_count?: number;
  available_room_sample?: string;
  available_room_names?: string[];
  distance_km?: number;
  venue?: Venue;
  created_at: string;
}

export interface Room {
  id: string;
  property_id: string;
  name: string;
  description: string;
  room_type: string; // e.g. 'Executive Suite', 'Deluxe Room', 'Standard King'
  price_per_night: number; // Stored in NGN
  price_per_night_ngn?: number;
  capacity: number;
  max_occupancy?: number;
  max_guests?: number;
  total_rooms?: number;
  available_count: number;
  available_rooms?: number;
  available_count_for_dates?: number;
  is_available_for_dates?: boolean;
  is_sold_out?: boolean;
  status?: boolean | string;
  is_active?: boolean;
  amenities: string[];
  image_url?: string;
  created_at: string;
  updated_at?: string;
  property?: Property;
}

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
  phone: string;
  country?: string;
  total_bookings: number;
  confirmed_bookings: number;
  pending_bookings: number;
  cancelled_bookings: number;
  total_spend_ngn: number;
  last_booking_date?: string;
  bookings: Booking[];
}

export interface PropertyImage {
  id: string;
  property_id: string;
  url: string;
  is_primary: boolean;
  created_at: string;
}

export type BookingStatus =
  | 'pending_payment'
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'completed'
  | 'cancelled'
  | 'expired';

export interface Booking {
  id: string;
  booking_reference?: string;
  user_id: string;
  property_id: string;
  room_id: string;
  venue_id: string;
  guest_first_name?: string;
  guest_last_name?: string;
  guest_name?: string;
  customer_name?: string;
  guest_email?: string;
  customer_email?: string;
  guest_phone?: string;
  customer_phone?: string;
  country?: string;
  passport_name?: string;
  special_requests?: string;
  check_in: string;
  check_out: string;
  nights?: number;
  guests: number;
  accommodation_subtotal?: number;
  logistics_subtotal?: number;
  room_total_ngn?: number;
  logistics_total_ngn?: number;
  total_amount: number; // Stored in NGN
  total_amount_ngn?: number;
  currency?: string;
  status: BookingStatus;
  booking_status?: BookingStatus;
  payment_status?: PaymentStatus;
  guest_check_in_confirmed_at?: string | null;
  host_check_in_confirmed_at?: string | null;
  actual_check_in_at?: string | null;
  partner_payout_eligible_at?: string | null;
  expires_at?: string | null;
  damage_deposit_ngn?: number;
  has_logistics?: boolean;
  logistics_details?: any;
  created_at: string;
  // Joins
  property?: Property;
  room?: Room;
  venue?: Venue;
  profile?: Profile;
  logistics?: any;
}


export type PaymentProvider = 'paystack' | 'flutterwave';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'unpaid' | 'successful';

export interface Payment {
  id: string;
  booking_id: string;
  amount_ngn: number; // Stored in NGN
  currency: 'NGN' | string;
  provider: PaymentProvider | string;
  status: PaymentStatus;
  transaction_reference: string;
  paid_at?: string | null;
  created_at: string;
  updated_at?: string;
  // Legacy aliases
  amount?: number;
  reference?: string;
  user_id?: string;
  // Joins
  booking?: Booking;
  profile?: Profile;
}

export type LogisticsType =
  | 'airport_pickup'
  | 'airport_dropoff'
  | 'both_airport_transfer'
  | 'around_town'
  | 'private_driver'
  | 'event_transport'
  | 'event_shuttle'
  | 'vip_transport'
  | 'no_transfer'
  | 'car_rental'
  | 'private_transit';

export type LogisticsStatus =
  | 'pending'
  | 'assigned'
  | 'in_transit'
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'confirmed';

export interface SelectedLogisticsService {
  type: LogisticsType;
  title: string;
  priceNGN: number | null; // null indicates "Price to be confirmed"
  airport?: string;
  arrival_date?: string;
  arrival_time?: string;
  flight_number?: string;
  departure_date?: string;
  departure_time?: string;
  departure_flight_number?: string;
  requirement_type?: string; // Private car, Dedicated driver, On-demand, etc.
  start_date?: string;
  end_date?: string;
  trips_per_day?: string;
  operating_hours?: string;
  travel_description?: string;
  driver_option?: string; // Full day, Half day, Custom
  transport_date?: string;
  pickup_time?: string;
  return_transport_required?: boolean;
  vehicle_preference?: string;
  dates_required?: string;
  pickup_preference?: string;
  passengers?: number;
  pickup_location?: string;
  dropoff_location?: string;
  notes?: string;
}

export interface LogisticsRequest {
  id: string;
  user_id: string;
  booking_id?: string;
  type: LogisticsType;
  service_name?: string;
  vehicle_preference?: string;
  airport?: string;
  arrival_date?: string;
  arrival_time?: string;
  flight_number?: string;
  departure_date?: string;
  departure_time?: string;
  departure_flight_number?: string;
  pickup_location: string;
  dropoff_location: string;
  request_date?: string;
  request_time?: string;
  passengers: number;
  status: LogisticsStatus;
  amount: number; // Stored in NGN
  price_ngn?: number;
  notes?: string;
  created_at: string;
  // Joins
  profile?: Profile;
  booking?: Booking;
}

// ==============================================================================
// PHASE 3 GATE #2: FINANCIAL SETTLEMENT, DISPUTES & LEDGER TYPES
// ==============================================================================

export interface HostPayoutProfile {
  id: string;
  host_id: string;
  bank_name: string;
  bank_code: string;
  account_number_masked: string;
  account_name: string;
  paystack_recipient_code: string;
  is_verified: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export type PartnerPayoutStatus =
  | 'allocated'
  | 'protection_window'
  | 'eligible'
  | 'authorized'
  | 'processing'
  | 'reconciliation_required'
  | 'completed'
  | 'frozen_dispute'
  | 'cancelled'
  | 'failed';

export type PartnerPayoutCategory = 'accommodation' | 'logistics';

export interface PartnerPayout {
  id: string;
  booking_id: string;
  payout_category: PartnerPayoutCategory;
  host_id?: string | null;
  host_user_id?: string | null;
  provider_id?: string | null;
  payout_profile_id?: string | null;
  logistics_payout_profile_id?: string | null;
  gross_amount_ngn?: number;
  gross_accommodation_amount_ngn?: number;
  commission_rate_percentage?: number;
  commission_amount_ngn?: number;
  partner_amount_ngn: number;
  status: PartnerPayoutStatus;
  scheduled_eligibility_at?: string | null;
  authorized_at?: string | null;
  disbursed_at?: string | null;
  paystack_recipient_code_snapshot?: string | null;
  recipient_bank_name_snapshot?: string | null;
  recipient_bank_code_snapshot?: string | null;
  recipient_account_name_snapshot?: string | null;
  recipient_account_number_masked?: string | null;
  attempt_count?: number;
  last_attempt_at?: string | null;
  processing_started_at?: string | null;
  reconciliation_required_at?: string | null;
  reconciled_at?: string | null;
  reconciliation_notes?: string | null;
  paystack_transfer_reference?: string | null;
  paystack_transfer_code?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export type GuestAssuranceReserveStatus =
  | 'held'
  | 'locked_dispute'
  | 'eligible_for_release'
  | 'disbursed_to_host'
  | 'partially_consumed'
  | 'fully_consumed'
  | 'cancelled_void';

export interface GuestAssuranceReserve {
  id: string;
  booking_id: string;
  host_id: string;
  original_reserve_ngn: number;
  consumed_reserve_ngn: number;
  released_reserve_ngn: number;
  status: GuestAssuranceReserveStatus;
  matures_at: string;
  settled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type BookingIssueTier = 'tier_1' | 'tier_2' | 'tier_3';

export type BookingIssueCategory =
  | 'cleanliness'
  | 'amenities'
  | 'access'
  | 'safety'
  | 'hvac_plumbing'
  | 'host_conduct'
  | 'other';

export type BookingIssueStatus =
  | 'submitted'
  | 'under_review'
  | 'remedy_in_progress'
  | 'resolved'
  | 'resolved_dismissed'
  | 'resolved_compensated'
  | 'escalated_relocation'
  | 'rejected';

export type BookingIssueRequestedResolution =
  | 'remediation'
  | 'partial_refund'
  | 'full_refund'
  | 'emergency_relocation';

export interface BookingIssue {
  id: string;
  booking_id: string;
  guest_id: string;
  property_id: string;
  issue_tier: BookingIssueTier;
  category: BookingIssueCategory;
  title: string;
  description: string;
  status: BookingIssueStatus;
  requested_resolution?: BookingIssueRequestedResolution | null;
  refund_awarded_ngn: number;
  reserve_draw_ngn: number;
  contingency_draw_ngn: number;
  resolution_notes?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingIssueEvidence {
  id: string;
  issue_id: string;
  booking_id: string;
  uploaded_by: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  created_at: string;
}

export type DamageDepositStatus =
  | 'held'
  | 'claim_pending'
  | 'partially_retained'
  | 'fully_retained'
  | 'eligible_for_refund'
  | 'refunded_to_guest';

export interface DamageDeposit {
  id: string;
  booking_id: string;
  property_id: string;
  guest_id: string;
  deposit_amount_ngn: number;
  retained_amount_ngn: number;
  refunded_amount_ngn: number;
  status: DamageDepositStatus;
  inspection_deadline: string;
  adjudicated_at?: string | null;
  created_at: string;
  updated_at: string;
  // Compatibility aliases
  user_id?: string;
  amount_ngn?: number;
  deposit_status?: DamageDepositStatus;
}

export type DamageClaimStatus =
  | 'submitted'
  | 'under_review'
  | 'approved_full'
  | 'approved_partial'
  | 'rejected'
  | 'dismissed';

export interface DamageClaim {
  id: string;
  deposit_id: string;
  booking_id: string;
  property_id: string;
  host_id: string;
  claimed_amount_ngn: number;
  description: string;
  evidence_urls?: string[];
  status: DamageClaimStatus;
  adjudicated_amount_ngn: number;
  adjudication_notes?: string | null;
  adjudicated_by?: string | null;
  adjudicated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export interface ChartOfAccount {
  account_code: string;
  account_name: string;
  account_type: AccountType;
  normal_balance: NormalBalance;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export type FinancialEntryType = 'debit' | 'credit';

export interface FinancialLedgerEntry {
  id: string;
  transaction_group_id: string;
  booking_id?: string | null;
  transaction_type: string;
  account_code: string;
  account_name: string;
  entry_type: FinancialEntryType;
  amount_ngn: number;
  description: string;
  reference: string;
  created_at: string;
}

export type WebhookEventStatus = 'received' | 'processing' | 'completed' | 'failed';

export interface WebhookEvent {
  id: string;
  event_source: string;
  event_type: string;
  event_reference: string;
  payload: Record<string, any>;
  status: WebhookEventStatus;
  retry_count: number;
  processing_started_at?: string | null;
  processed_at?: string | null;
  last_error?: string | null;
  created_at: string;
}

export interface AdminCheckInAudit {
  id: string;
  booking_id: string;
  admin_id: string;
  reason: string;
  prior_guest_confirmed_at?: string | null;
  prior_host_confirmed_at?: string | null;
  actual_check_in_at: string;
  partner_payout_eligible_at: string;
  forced_at: string;
}

export interface ConfirmBookingCheckInResult {
  success: boolean;
  booking_id: string;
  confirmed_by: 'guest' | 'host' | 'both';
  guest_check_in_confirmed_at?: string | null;
  host_check_in_confirmed_at?: string | null;
  actual_check_in_at?: string | null;
  partner_payout_eligible_at?: string | null;
  is_fully_confirmed: boolean;
  booking_status: string;
}

export interface ReportBookingIssueResult {
  success: boolean;
  issue_id: string;
  booking_id: string;
  status: BookingIssueStatus;
  issue_tier: BookingIssueTier;
  category: BookingIssueCategory;
  requested_resolution?: BookingIssueRequestedResolution | null;
  created_at: string;
}

export interface AdminForceCheckInResult {
  success: boolean;
  booking_id: string;
  admin_id: string;
  audit_id: string;
  reason: string;
  prior_guest_confirmed_at?: string | null;
  prior_host_confirmed_at?: string | null;
  actual_check_in_at: string;
  partner_payout_eligible_at: string;
  booking_status: string;
  forced_at: string;
}

export interface RecordBalancedLedgerResult {
  success: boolean;
  transaction_group_id: string;
  booking_id?: string | null;
  transaction_type: string;
  reference: string;
  amount_ngn: number;
  debit_account: string;
  credit_account: string;
  debit_entry_id: string;
  credit_entry_id: string;
  created_at: string;
}

export type RefundCategory =
  | 'damage_deposit'
  | 'guest_assurance_issue'
  | 'booking_cancellation'
  | 'administrative';

export type RefundOperationStatus =
  | 'requested'
  | 'authorized'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'reconciliation_required';

export interface RefundOperation {
  id: string;
  booking_id: string;
  payment_id?: string | null;
  issue_id?: string | null;
  deposit_id?: string | null;
  refund_category: RefundCategory;
  refund_reason: string;
  amount_ngn: number;
  currency: string;
  paystack_reference: string;
  paystack_refund_id?: string | null;
  status: RefundOperationStatus;
  requested_by?: string | null;
  created_at: string;
  processing_started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  reconciliation_required_at?: string | null;
  reconciliation_attempts: number;
  metadata?: Record<string, any>;
  updated_at: string;
}

export interface FinancialAuditLog {
  id: string;
  actor_id?: string | null;
  actor_role: string;
  operation_type: string;
  entity_type: string;
  entity_id: string;
  previous_state?: string | null;
  new_state: string;
  amount_ngn?: number | null;
  booking_id?: string | null;
  payment_id?: string | null;
  reference?: string | null;
  reason?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

