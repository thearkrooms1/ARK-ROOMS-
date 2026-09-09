import React, { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { useAuth } from '../../lib/authContext';
import { getBookingsByUser, deletePendingBooking, cancelBooking } from '../../lib/supabase';
import { Booking } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { PaystackPaymentButton } from '../../components/payment/PaystackPaymentButton';
import { verifyPaystackPayment } from '../../lib/paystack';
import {
  Briefcase,
  Calendar,
  Building2,
  MapPin,
  Car,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Clock,
  ArrowRight,
  LogIn,
  Trash2,
  XCircle,
  CheckCircle2,
  X,
} from 'lucide-react';

interface ActionModalState {
  booking: Booking;
  type: 'delete' | 'cancel';
}

export const MyTripsPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // Paystack verification state & deduplication guards
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState<string | null>(null);
  const verifyingRef = useRef<string | null>(null);
  const verifiedRefs = useRef<Set<string>>(new Set());

  // Delete & Cancel Action Modal State
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const cleanPaystackQueryParams = () => {
    const newParams = new URLSearchParams(searchParams);
    const keysToRemove = [
      'reference',
      'trxref',
      'bookingId',
      'booking_id',
      'bookingRef',
      'booking_ref',
      'booking_reference',
    ];
    let hasKeys = false;
    for (const key of keysToRemove) {
      if (newParams.has(key)) {
        newParams.delete(key);
        hasKeys = true;
      }
    }
    if (hasKeys) {
      setSearchParams(newParams, { replace: true });
    }
  };

  const fetchTrips = async () => {
    if (user?.id) {
      setLoading(true);
      try {
        const data = await getBookingsByUser(user.id);
        setBookings(data);
        return data;
      } catch (err) {
        console.error('[MyTripsPage] Failed to fetch trips:', err);
        return [];
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(false);
      return [];
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      fetchTrips();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user, authLoading]);

  // Handle Paystack Return Verification
  useEffect(() => {
    const rawRef = searchParams.get('reference') || searchParams.get('trxref');
    const targetRef = (rawRef || '').trim();
    if (!targetRef) return;

    // Await user authentication resolution
    if (authLoading) return;

    if (!user) {
      setVerificationError(
        'Please sign in to verify your payment and confirm your reservation.'
      );
      return;
    }

    // Deduplication check: prevent duplicate verification across re-renders, effects, or StrictMode
    const sessionKey = `paystack_verified_${targetRef}`;
    if (
      verifiedRefs.current.has(targetRef) ||
      verifyingRef.current === targetRef ||
      sessionStorage.getItem(sessionKey) === 'done'
    ) {
      cleanPaystackQueryParams();
      return;
    }

    verifyingRef.current = targetRef;
    verifiedRefs.current.add(targetRef);
    setIsVerifyingPayment(true);
    setVerificationError(null);
    setVerificationSuccess(null);

    const bookingIdParam =
      searchParams.get('booking_id') || searchParams.get('bookingId') || undefined;
    const bookingRefParam =
      searchParams.get('booking_reference') ||
      searchParams.get('bookingRef') ||
      searchParams.get('booking_ref') ||
      undefined;
    const trxrefParam = searchParams.get('trxref') || undefined;

    (async () => {
      console.log('[MyTripsPage] Starting return verification for Paystack reference:', targetRef);
      try {
        const result = await verifyPaystackPayment(
          targetRef,
          bookingIdParam,
          bookingRefParam,
          trxrefParam
        );

        if (result.success) {
          try {
            sessionStorage.setItem(sessionKey, 'done');
          } catch (_) {}
          setVerificationSuccess(
            result.message || 'Payment verified and reservation confirmed successfully.'
          );
          setToastMessage('Payment confirmed! Your reservation is now active.');
        } else {
          setVerificationError(
            result.error ||
              result.message ||
              'Payment verification could not be completed. Your reservation remains pending.'
          );
        }
      } catch (err: any) {
        console.error('[MyTripsPage] Payment verification exception:', err);
        setVerificationError(
          err.message || 'An unexpected error occurred during payment verification.'
        );
      } finally {
        cleanPaystackQueryParams();
        setIsVerifyingPayment(false);
        verifyingRef.current = null;
        await fetchTrips();
      }
    })();
  }, [searchParams, user, authLoading]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleConfirmAction = async () => {
    if (!actionModal) return;
    const { booking, type } = actionModal;

    setActionLoading(true);
    setActionError(null);

    try {
      if (type === 'delete') {
        const result = await deletePendingBooking(booking.id);
        setToastMessage(result.message || 'Trip reservation removed successfully.');
      } else {
        const result = await cancelBooking(booking.id);
        setToastMessage(result.message || 'Reservation cancelled successfully.');
      }
      setActionModal(null);
      fetchTrips();
    } catch (err: any) {
      console.error('[MyTripsPage] Action error:', err);
      setActionError(err.message || 'Unable to complete action. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  if (authLoading || ((loading || isVerifyingPayment) && user && bookings.length === 0)) {
    return (
      <CustomerLayout>
        <div className="max-w-5xl mx-auto px-4 py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">
            {isVerifyingPayment
              ? 'Verifying payment with Paystack and confirming your trip reservation...'
              : 'Retrieving your event trips & bookings...'}
          </p>
        </div>
      </CustomerLayout>
    );
  }

  if (!user) {
    const rawRef = searchParams.get('reference') || searchParams.get('trxref');
    return (
      <CustomerLayout>
        <div className="max-w-md mx-auto px-4 py-20 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-[#0B1F3A]/5 border border-[#0B1F3A]/10 text-[#0B1F3A] flex items-center justify-center mx-auto">
            <Briefcase className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-[#0B1F3A]">Access Your Event Trips</h2>
            <p className="text-sm text-slate-600">
              Sign in to manage your upcoming event stays, chauffeur logistics, and secure payment receipts.
            </p>
            {rawRef && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 text-left">
                Payment completed for reference <span className="font-mono font-bold">{rawRef}</span>. Please sign in to verify your payment and confirm your reservation.
              </div>
            )}
          </div>
          <Link
            to={`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            className="w-full py-3.5 px-6 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4 text-[#C89B3C]" />
            Sign In to Account
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout>
      <div className="bg-[#0B1F3A] text-white py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#C89B3C]">
              Attendee Itinerary & Stays
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-white">My Event Trips</h1>
          </div>
          <Link
            to="/search"
            className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-[#C89B3C] text-slate-950 font-bold text-xs uppercase tracking-wider hover:bg-[#d6aa4a] transition-all shadow"
          >
            + Book New Stay
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        {/* Paystack Verification In-Progress Banner */}
        {isVerifyingPayment && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl text-blue-950 flex items-center gap-3 animate-fadeIn">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
            <div>
              <p className="font-bold text-xs sm:text-sm">Verifying Paystack Payment...</p>
              <p className="text-xs text-blue-700">
                Confirming your transaction with the payment gateway and securing your reservation.
              </p>
            </div>
          </div>
        )}

        {/* Verification Success Banner */}
        {verificationSuccess && !isVerifyingPayment && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 flex items-center justify-between gap-3 animate-fadeIn">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-bold text-xs sm:text-sm">Payment Verified</p>
                <p className="text-xs text-emerald-800">{verificationSuccess}</p>
              </div>
            </div>
            <button
              onClick={() => setVerificationSuccess(null)}
              className="p-1 text-emerald-700 hover:text-emerald-900 rounded-lg"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Verification Error Banner */}
        {verificationError && !isVerifyingPayment && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-950 flex items-center justify-between gap-3 animate-fadeIn">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <p className="font-bold text-xs sm:text-sm">Payment Verification Notice</p>
                <p className="text-xs text-rose-800">{verificationError}</p>
              </div>
            </div>
            <button
              onClick={() => setVerificationError(null)}
              className="p-1 text-rose-700 hover:text-rose-900 rounded-lg"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Toast Notification Banner */}
        {toastMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 flex items-center justify-between gap-3 animate-fadeIn">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <p className="font-bold text-xs sm:text-sm">{toastMessage}</p>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="p-1 text-emerald-700 hover:text-emerald-900 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {bookings.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center space-y-5 shadow-sm">
            <Briefcase className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="text-lg font-bold text-[#0B1F3A]">No Trips Booked Yet</h3>
              <p className="text-xs text-slate-500">
                You haven't made any event stay reservations. Find verified accommodation near your conference or summit today.
              </p>
            </div>
            <Link
              to="/search"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider shadow-md hover:bg-[#155642] transition-colors"
            >
              Explore Verified Event Stays
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((booking) => {
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

              return (
                <div
                  key={booking.id}
                  className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-xs text-[#0B1F3A] bg-slate-100 px-2.5 py-1 rounded-lg">
                        {booking.booking_reference}
                      </span>
                      <StatusBadge status={booking.status} />
                    </div>
                    <span className="text-xs text-slate-500">
                      Booked on {new Date(booking.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Stay Information */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">Property & Room</span>
                      <h4 className="font-bold text-[#0B1F3A] text-sm">{booking.property?.title || 'Verified Stay'}</h4>
                      <p className="text-xs text-slate-500">{booking.room?.name || 'Standard Room'}</p>
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {booking.property?.city || 'Lagos'}
                      </p>
                    </div>

                    {/* Venue & Logistics */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">Event & Dates</span>
                      <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#1E7A5E]" />
                        {booking.check_in} → {booking.check_out}
                      </p>
                      {booking.venue && (
                        <p className="text-xs text-emerald-800 font-medium flex items-center gap-1.5 mt-1">
                          <Building2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                          Near {booking.venue.name}
                        </p>
                      )}
                      {(booking.has_logistics || booking.logistics) && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-medium mt-1">
                          <Car className="w-3 h-3" /> Airport Pickup Included
                        </span>
                      )}
                    </div>

                    {/* Pricing & Actions */}
                    <div className="flex flex-col justify-between items-start md:items-end space-y-3">
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block md:text-right">
                          Total Amount (NGN)
                        </span>
                        <span className="text-lg font-black text-[#0B1F3A] block md:text-right">
                          {formatNGN(displayAmount)}
                        </span>
                        <span className="text-xs text-slate-500 block md:text-right mt-0.5">
                          Payment:{' '}
                          <span
                            className={`font-semibold capitalize ${
                              isPaid ? 'text-emerald-700 font-bold' : 'text-amber-700'
                            }`}
                          >
                            {booking.payment_status || 'unpaid'}
                          </span>
                        </span>
                      </div>

                      <div className="w-full sm:w-auto flex flex-wrap sm:flex-nowrap items-center gap-2">
                        {isAwaitingPayment && (
                          <div className="w-full sm:w-44">
                            <PaystackPaymentButton
                              bookingIdOrRef={booking.id}
                              bookingReference={booking.booking_reference}
                              totalAmountNGN={displayAmount}
                              size="sm"
                              buttonText="Complete Payment"
                              onPaymentSuccess={fetchTrips}
                            />
                          </div>
                        )}

                        <Link
                          to={`/trips/${booking.id}`}
                          className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1"
                        >
                          <span>Details</span> <ChevronRight className="w-3.5 h-3.5" />
                        </Link>

                        {/* Delete Pending Trip Action */}
                        {isAwaitingPayment && (
                          <button
                            onClick={() => setActionModal({ booking, type: 'delete' })}
                            className="px-3 py-2 rounded-xl text-rose-700 bg-rose-50 hover:bg-rose-100 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Remove Pending Trip"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}

                        {/* Cancel Confirmed Trip Action */}
                        {!isCancelled && isPaid && (
                          <button
                            onClick={() => setActionModal({ booking, type: 'cancel' })}
                            className="px-3 py-2 rounded-xl text-slate-600 hover:text-rose-700 hover:bg-rose-50 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Cancel Reservation"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        )}

                        {/* Remove already cancelled trip from view */}
                        {isCancelled && !isPaid && (
                          <button
                            onClick={() => setActionModal({ booking, type: 'delete' })}
                            className="px-3 py-2 rounded-xl text-slate-400 hover:text-rose-700 hover:bg-rose-50 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            title="Remove from Trips"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200 space-y-5 animate-scaleUp">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  actionModal.type === 'delete' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {actionModal.type === 'delete' ? (
                  <Trash2 className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base sm:text-lg font-black text-[#0B1F3A]">
                  {actionModal.type === 'delete'
                    ? 'Remove Pending Trip Reservation?'
                    : 'Cancel Confirmed Reservation?'}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Ref: {actionModal.booking.booking_reference}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-600 leading-relaxed space-y-2">
              {actionModal.type === 'delete' ? (
                <p>
                  Are you sure you want to remove this pending reservation for{' '}
                  <strong>{actionModal.booking.property?.title || 'this stay'}</strong>? Your temporary room hold and unconfirmed logistics requests will be discarded.
                </p>
              ) : (
                <p>
                  Are you sure you want to cancel your confirmed stay at{' '}
                  <strong>{actionModal.booking.property?.title || 'this property'}</strong>? Your booking will be updated to <strong>Cancelled</strong>. Payment and financial records are preserved for auditing and concierge refund processing.
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
                Keep Trip
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={actionLoading}
                className={`px-5 py-2.5 rounded-xl text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 cursor-pointer ${
                  actionModal.type === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {actionLoading
                    ? 'Processing...'
                    : actionModal.type === 'delete'
                    ? 'Yes, Remove Trip'
                    : 'Yes, Cancel Reservation'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </CustomerLayout>
  );
};
