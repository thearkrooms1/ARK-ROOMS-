import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { getBookingById, deletePendingBooking, cancelBooking } from '../../lib/supabase';
import { Booking } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { PaystackPaymentButton } from '../../components/payment/PaystackPaymentButton';
import {
  Briefcase,
  Calendar,
  Building2,
  MapPin,
  Car,
  ChevronLeft,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Printer,
  Plane,
  CreditCard,
  User,
  Phone,
  Mail,
  Loader2,
  Trash2,
  XCircle,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';

export const TripDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const paidSuccess = searchParams.get('paid') === 'true';

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);

  // Action modal state
  const [actionModal, setActionModal] = useState<'delete' | 'cancel' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  const fetchTrip = () => {
    if (id) {
      getBookingById(id).then((data) => {
        setBooking(data);
        setLoading(false);
      });
    }
  };

  useEffect(() => {
    fetchTrip();
  }, [id]);

  const handlePrint = () => {
    try {
      window.focus();
      window.print();
    } catch (err) {
      console.error('[TripDetailPage] window.print error:', err);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.focus();
          window.parent.print();
        }
      } catch (parentErr) {
        console.warn('[TripDetailPage] parent print restricted:', parentErr);
      }
    }
  };

  const handleConfirmAction = async () => {
    if (!booking || !actionModal) return;
    setActionLoading(true);
    setActionError(null);

    try {
      if (actionModal === 'delete') {
        await deletePendingBooking(booking.id);
        navigate('/my-trips');
      } else {
        const res = await cancelBooking(booking.id);
        setActionModal(null);
        setActionSuccessNotice(
          res.message ||
            'Your reservation has been cancelled. Your payment record has been preserved. Refund processing will be handled according to the cancellation/refund policy.'
        );
        fetchTrip();
      }
    } catch (err: any) {
      console.error('[TripDetailPage] Action error:', err);
      setActionError(err.message || 'Unable to complete action.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <CustomerLayout>
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">Loading trip details...</p>
        </div>
      </CustomerLayout>
    );
  }

  if (!booking) {
    return (
      <CustomerLayout>
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
          <p className="text-lg font-bold text-slate-800">Trip record not found</p>
          <Link
            to="/my-trips"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0B1F3A] text-white font-bold text-xs uppercase"
          >
            <ChevronLeft className="w-4 h-4" /> Back to My Trips
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  const bookingStatus = String(booking.status || booking.booking_status || 'pending').toLowerCase();
  const paymentStatus = String(booking.payment_status || 'unpaid').toLowerCase();

  const isCancelled = bookingStatus === 'cancelled';
  const isPaid = paymentStatus === 'paid' || bookingStatus === 'confirmed';
  const isAwaitingPayment =
    !isCancelled &&
    !isPaid &&
    (paymentStatus === 'pending' ||
      paymentStatus === 'unpaid' ||
      bookingStatus === 'pending_payment' ||
      bookingStatus === 'pending');

  const displayAmount = booking.total_amount || booking.total_amount_ngn || 0;
  const guestFullName = booking.guest_name || `${booking.guest_first_name || ''} ${booking.guest_last_name || ''}`.trim() || booking.profile?.full_name || 'Guest Attendee';
  const guestEmail = booking.guest_email || booking.profile?.email || 'N/A';
  const guestPhone = booking.guest_phone || booking.customer_phone || booking.profile?.phone || 'N/A';

  return (
    <CustomerLayout>
      <div className="bg-[#0B1F3A] text-white py-8 px-4 sm:px-6 lg:px-8 print:hidden">
        <div className="max-w-4xl mx-auto space-y-3">
          <Link
            to="/my-trips"
            className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back to My Trips
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#C89B3C]">
                  {isCancelled ? 'Cancelled Reservation' : isPaid ? 'Confirmed Reservation' : 'Pending Reservation'}
                </span>
                <StatusBadge status={booking.status} />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-white">
                Booking #{booking.booking_reference}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handlePrint}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Print Voucher
              </button>

              {isAwaitingPayment && (
                <button
                  onClick={() => setActionModal('delete')}
                  className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 hover:text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                  title="Remove Pending Trip"
                >
                  <Trash2 className="w-4 h-4" /> Remove Trip
                </button>
              )}

              {!isCancelled && isPaid && (
                <button
                  onClick={() => setActionModal('cancel')}
                  className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 hover:text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                  title="Cancel Reservation"
                >
                  <XCircle className="w-4 h-4" /> Cancel Stay
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Screen-Only Main Container */}
      <div className="print:hidden max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        {actionSuccessNotice && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-950 flex items-center gap-3 animate-fadeIn">
            <CheckCircle2 className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <p className="font-extrabold text-sm">Reservation Cancelled</p>
              <p className="text-xs text-amber-900 leading-relaxed">
                {actionSuccessNotice}
              </p>
            </div>
          </div>
        )}

        {isCancelled && !actionSuccessNotice && (
          <div className="p-4 bg-slate-100 border border-slate-200 rounded-2xl text-slate-800 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-slate-500 shrink-0" />
            <div>
              <p className="font-extrabold text-sm">Cancelled Reservation</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                This reservation has been cancelled. Your payment record has been preserved. Refund processing will be handled according to the cancellation and refund policy.
              </p>
            </div>
          </div>
        )}

        {paidSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 flex items-center gap-3 animate-fadeIn">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <p className="font-extrabold text-sm">Payment Verified Successfully</p>
              <p className="text-xs text-emerald-800">
                Your reservation is confirmed. Your check-in pass and driver contact details have been registered.
              </p>
            </div>
          </div>
        )}

        {isAwaitingPayment && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 sm:p-8 space-y-4">
            <div className="flex items-start gap-3">
              <Clock className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-extrabold text-base text-[#0B1F3A]">Awaiting Payment</h3>
                <p className="text-xs text-amber-900 leading-relaxed">
                  To guarantee your room rate and schedule airport logistics, please complete payment with Paystack.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <PaystackPaymentButton
                bookingIdOrRef={booking.id}
                bookingReference={booking.booking_reference}
                totalAmountNGN={displayAmount}
                buttonText={`Pay Now with Paystack (${formatNGN(displayAmount)})`}
                onPaymentSuccess={fetchTrip}
              />
            </div>
          </div>
        )}

        {/* Primary Voucher Card */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-8">
          {/* Stay & Venue Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-100">
            <div className="space-y-3">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1E7A5E] block">
                Stay Location
              </span>
              <h3 className="text-xl font-bold text-[#0B1F3A]">{booking.property?.title || 'Verified Stay'}</h3>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                {booking.property?.address}, {booking.property?.city}
              </p>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <span className="font-bold text-slate-700 block">Room Category:</span>
                <span className="text-slate-600">{booking.room?.name || 'Standard Room'}</span>
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C89B3C] block">
                Event & Dates
              </span>
              <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200/60 space-y-2 text-xs">
                {booking.venue && (
                  <div className="space-y-0.5">
                    <span className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-[#1E7A5E]" />
                      {booking.venue.name}
                    </span>
                    <p className="text-[11px] text-emerald-800">
                      {booking.property?.distance_to_venue_km && booking.property?.distance_to_venue_km > 0
                        ? `${booking.property.distance_to_venue_km} km to event grounds`
                        : 'Close proximity to venue'}
                    </p>
                  </div>
                )}

                <div className="pt-2 border-t border-emerald-200/60 grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Check-In</span>
                    <span className="font-bold text-slate-900">{booking.check_in}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Check-Out</span>
                    <span className="font-bold text-slate-900">{booking.check_out}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Logistics Details */}
          {(booking.has_logistics || booking.logistics) && (
            <div className="p-5 bg-blue-50/60 rounded-2xl border border-blue-200 space-y-3">
              <div className="flex items-center gap-2 text-blue-900 font-bold text-sm">
                <Car className="w-5 h-5 text-blue-700" />
                <span>Airport Chauffeur Service Details</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Flight Number:</span>
                  <span className="font-bold text-slate-800">{booking.logistics?.flight_number || 'Registered'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Arrival Date:</span>
                  <span className="font-bold text-slate-800">{booking.logistics?.arrival_date || booking.check_in}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Arrival Time:</span>
                  <span className="font-bold text-slate-800">{booking.logistics?.arrival_time || '12:00'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Vehicle Category:</span>
                  <span className="font-bold text-slate-800">
                    {booking.logistics?.vehicle_preference || booking.logistics?.service_name || 'Executive Sedan'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Guest Info & Payment Ledger */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3 text-xs">
              <h4 className="font-extrabold text-[#0B1F3A] uppercase tracking-wider text-xs">Guest Information</h4>
              <div className="space-y-2 text-slate-700">
                <p className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" /> {guestFullName}
                </p>
                <p className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-400" /> {guestEmail}
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-400" /> {guestPhone}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <h4 className="font-extrabold text-[#0B1F3A] uppercase tracking-wider text-xs">Payment Information</h4>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment Gateway:</span>
                  <span className="font-bold text-slate-800">Paystack NGN</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Transaction Status:</span>
                  <StatusBadge status={booking.status} />
                </div>
                {booking.room_total_ngn ? (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Accommodation:</span>
                    <span className="font-semibold text-slate-800">{formatNGN(booking.room_total_ngn)}</span>
                  </div>
                ) : null}
                {booking.logistics_total_ngn ? (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Car Service / Chauffeur:</span>
                    <span className="font-semibold text-slate-800">{formatNGN(booking.logistics_total_ngn)}</span>
                  </div>
                ) : null}
                <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline font-bold">
                  <span className="text-[#0B1F3A]">Total Amount (NGN):</span>
                  <span className="text-base text-[#0B1F3A]">{formatNGN(displayAmount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200 space-y-5 animate-scaleUp">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  actionModal === 'delete' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {actionModal === 'delete' ? (
                  <Trash2 className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base sm:text-lg font-black text-[#0B1F3A]">
                  {actionModal === 'delete'
                    ? 'Remove Pending Trip Reservation?'
                    : 'Cancel Confirmed Reservation?'}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Ref: {booking.booking_reference}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-600 leading-relaxed space-y-2">
              {actionModal === 'delete' ? (
                <p>
                  Are you sure you want to remove this pending reservation for{' '}
                  <strong>{booking.property?.title || 'this stay'}</strong>? Your temporary room hold and unconfirmed logistics requests will be discarded.
                </p>
              ) : (
                <p>
                  Are you sure you want to cancel your confirmed stay at{' '}
                  <strong>{booking.property?.title || 'this property'}</strong>? Your booking will be updated to <strong>Cancelled</strong>. Payment and financial records are preserved for auditing and concierge refund processing.
                </p>
              )}
            </div>

            {actionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!actionLoading) {
                    setActionModal(null);
                    setActionError(null);
                  }
                }}
                disabled={actionLoading}
                className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                Keep Reservation
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className={`px-5 py-2.5 rounded-xl text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 cursor-pointer ${
                  actionModal === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {actionLoading
                    ? 'Processing...'
                    : actionModal === 'delete'
                    ? 'Yes, Remove Trip'
                    : 'Yes, Cancel Reservation'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* AUTHORITATIVE PRINTABLE VOUCHER (Clean A4/Letter Layout for @media print)  */}
      {/* ========================================================================= */}
      <div
        id="theark-printable-voucher"
        className="hidden print:block max-w-3xl mx-auto p-8 bg-white text-slate-900 font-sans"
      >
        {/* Document Header */}
        <div className="border-b-2 border-[#0B1F3A] pb-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-black text-[#0B1F3A] tracking-tight uppercase">
                THEARK <span className="text-[#1E7A5E]">ROOMS</span>
              </h1>
              <p className="text-xs font-bold uppercase tracking-widest text-[#C89B3C] mt-0.5">
                Official Reservation Voucher &amp; Check-in Pass
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Luxury Event Hospitality &amp; Airport Concierge Services
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Booking Reference
              </span>
              <span className="text-xl font-mono font-black text-[#0B1F3A]">
                #{booking.booking_reference}
              </span>
              <span className="text-[11px] text-slate-500 block mt-1">
                Issued: {new Date(booking.created_at || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
          </div>

          {/* Status Chips */}
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-100 text-xs">
            <span className="font-bold text-slate-500">Booking Status:</span>
            <span
              className={`px-3 py-0.5 rounded-full font-black text-[11px] uppercase tracking-wider ${
                isCancelled
                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                  : isPaid
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-100 text-amber-800 border border-amber-200'
              }`}
            >
              {bookingStatus.toUpperCase()}
            </span>

            <span className="font-bold text-slate-500 ml-4">Payment Status:</span>
            <span
              className={`px-3 py-0.5 rounded-full font-black text-[11px] uppercase tracking-wider ${
                paymentStatus === 'paid' || isPaid
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-100 text-amber-800 border border-amber-200'
              }`}
            >
              {paymentStatus === 'paid' || isPaid ? 'PAID (PAYSTACK NGN)' : paymentStatus.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Accommodation & Stay Details */}
        <div className="grid grid-cols-2 gap-6 pb-6 border-b border-slate-200 text-xs">
          <div className="space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1E7A5E] block">
              Property &amp; Accommodation
            </span>
            <h2 className="text-lg font-bold text-[#0B1F3A]">
              {booking.property?.title || 'Selected Hotel / Residence'}
            </h2>
            <p className="text-slate-600">
              {booking.property?.address}, {booking.property?.city}, {booking.property?.state || 'FCT'}
            </p>
            <div className="pt-2">
              <span className="text-slate-500 block">Room Category:</span>
              <span className="font-bold text-slate-800 text-sm">
                {booking.room?.name || 'Standard Executive Room'}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C89B3C] block">
              Stay Schedule &amp; Duration
            </span>
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Check-In</span>
                <span className="font-bold text-slate-900 text-sm">{booking.check_in}</span>
                <span className="text-[10px] text-slate-500 block">From 14:00</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Check-Out</span>
                <span className="font-bold text-slate-900 text-sm">{booking.check_out}</span>
                <span className="text-[10px] text-slate-500 block">Until 11:00</span>
              </div>
            </div>
            <div className="flex justify-between text-slate-600 px-1">
              <span>Duration: <strong className="text-slate-900">{booking.nights || 1} Night(s)</strong></span>
              <span>Guests: <strong className="text-slate-900">{booking.guests || 1} Guest(s)</strong></span>
            </div>
            {booking.venue && (
              <div className="pt-1 text-[11px] text-slate-600">
                <span className="font-bold text-slate-800">Event Ground: </span>
                <span>{booking.venue.name}</span>
                {booking.property?.distance_to_venue_km ? ` (${booking.property.distance_to_venue_km} km away)` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Guest & Chauffeur Services */}
        <div className="grid grid-cols-2 gap-6 py-6 border-b border-slate-200 text-xs">
          <div className="space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#0B1F3A] block">
              Guest Information
            </span>
            <p><span className="text-slate-500">Primary Guest:</span> <strong className="text-slate-900">{guestFullName}</strong></p>
            <p><span className="text-slate-500">Email:</span> <strong className="text-slate-900">{guestEmail}</strong></p>
            <p><span className="text-slate-500">Phone:</span> <strong className="text-slate-900">{guestPhone}</strong></p>
            {booking.special_requests && (
              <p className="pt-1"><span className="text-slate-500">Special Requests:</span> <span className="italic text-slate-700">{booking.special_requests}</span></p>
            )}
          </div>

          {(booking.has_logistics || booking.logistics) ? (
            <div className="space-y-2 p-3 bg-blue-50/70 rounded-xl border border-blue-200">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-900 block">
                Airport Chauffeur Transfer
              </span>
              <p><span className="text-slate-500">Flight:</span> <strong className="text-slate-900">{booking.logistics?.flight_number || 'Registered'}</strong></p>
              <p><span className="text-slate-500">Arrival:</span> <strong className="text-slate-900">{booking.logistics?.arrival_date || booking.check_in} at {booking.logistics?.arrival_time || '12:00'}</strong></p>
              <p><span className="text-slate-500">Vehicle:</span> <strong className="text-slate-900">{booking.logistics?.vehicle_preference || booking.logistics?.service_name || 'Executive Sedan'}</strong></p>
            </div>
          ) : (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 block">
                Airport Logistics
              </span>
              <p className="text-slate-500 text-[11px] mt-1">
                Standard room stay. No airport chauffeur requested.
              </p>
            </div>
          )}
        </div>

        {/* Financial Ledger */}
        <div className="py-6 border-b border-slate-200 text-xs">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#0B1F3A] block mb-3">
            Financial &amp; Payment Summary
          </span>
          <div className="space-y-1.5 max-w-sm ml-auto">
            {booking.room_total_ngn ? (
              <div className="flex justify-between text-slate-600">
                <span>Accommodation:</span>
                <span className="font-semibold text-slate-900">{formatNGN(booking.room_total_ngn)}</span>
              </div>
            ) : null}
            {booking.logistics_total_ngn ? (
              <div className="flex justify-between text-slate-600">
                <span>Airport Chauffeur:</span>
                <span className="font-semibold text-slate-900">{formatNGN(booking.logistics_total_ngn)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-slate-600">
              <span>Payment Gateway:</span>
              <span className="font-semibold text-slate-900">Paystack NGN (Authoritative)</span>
            </div>
            <div className="pt-2 border-t border-slate-300 flex justify-between text-sm font-black text-[#0B1F3A]">
              <span>Total Amount:</span>
              <span className="text-base">{formatNGN(displayAmount)}</span>
            </div>
          </div>
        </div>

        {/* Check-in Instructions Footer */}
        <div className="pt-6 text-[10px] text-slate-500 leading-relaxed space-y-1.5">
          <p className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
            Check-in Guidelines &amp; Concierge Instructions
          </p>
          <p>
            • Please present this official voucher and a valid government-issued photo ID upon check-in at the hotel reception.
          </p>
          <p>
            • Check-in time begins at 14:00. Early check-in or late check-out is subject to room availability and property policy.
          </p>
          <p>
            • 24/7 Guest Concierge Support: Email <strong>support@thearkrooms.com</strong> or phone +234 (0) 800-THE-ARK.
          </p>
        </div>
      </div>
    </CustomerLayout>
  );
};
