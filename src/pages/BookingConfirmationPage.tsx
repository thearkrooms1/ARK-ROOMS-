import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { getBookingById, deletePendingBooking } from '../lib/supabase';
import { PaystackPaymentButton } from '../components/payment/PaystackPaymentButton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Booking } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  CheckCircle2,
  Calendar,
  Building2,
  MapPin,
  Truck,
  Users,
  ShieldCheck,
  CreditCard,
  Printer,
  ArrowRight,
  AlertCircle,
  Clock,
  Loader2,
  Trash2,
} from 'lucide-react';

export const BookingConfirmationPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    setLoading(true);

    getBookingById(id)
      .then((b) => {
        if (isMounted) {
          if (b) {
            setBooking(b);
            if (b.status === 'confirmed' || b.payment_status === 'paid' || b.payment_status === 'successful') {
              setPaymentSuccess(true);
            }
          } else {
            setError('Booking could not be found.');
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Error loading booking.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  const handlePaymentSuccess = (ref: string) => {
    setPaymentSuccess(true);
    if (booking) {
      setBooking({
        ...booking,
        status: 'confirmed',
        payment_status: 'paid',
      });
    }
  };

  if (loading) {
    return (
      <CustomerLayout>
        <div className="max-w-3xl mx-auto px-4 py-24 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-700">Loading Reservation Information...</p>
        </div>
      </CustomerLayout>
    );
  }

  if (error || !booking) {
    return (
      <CustomerLayout>
        <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">Booking Record Not Found</h2>
          <p className="text-xs text-slate-500">{error || 'Unable to locate this reservation.'}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E7A5E] text-white font-bold text-xs"
          >
            Return to Homepage
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  const isPaid = paymentSuccess || booking.status === 'confirmed' || booking.payment_status === 'paid';

  return (
    <CustomerLayout>
      <div className="bg-[#101D1E] text-white py-12 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
            <CheckCircle2 className="w-4 h-4" />
            {isPaid ? 'Reservation Confirmed & Paid' : 'Reservation Created — Payment Pending'}
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-black text-white">
            Booking Reference: {booking.booking_reference}
          </h1>
          <p className="text-xs sm:text-sm text-slate-300">
            A confirmation voucher will be transmitted to{' '}
            <strong className="text-white">{booking.guest_email}</strong>
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        {/* Payment Action Banner (If Unpaid) */}
        {!isPaid && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 sm:p-8 space-y-5 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  Action Required
                </span>
                <h2 className="text-lg font-bold text-amber-950">
                  Complete Payment to Secure Room Allocation
                </h2>
                <p className="text-xs text-amber-800 mt-1">
                  Rooms are held temporarily for event attendees. Authorize your payment via Paystack to confirm.
                </p>
              </div>
              <span className="text-xl font-black text-amber-950">
                {formatNaira(booking.total_amount)}
              </span>
            </div>

            <div className="max-w-md">
              <PaystackPaymentButton
                bookingId={booking.id}
                bookingReference={booking.booking_reference}
                amountNGN={booking.total_amount}
                email={booking.guest_email}
                customerName={`${booking.guest_first_name} ${booking.guest_last_name}`}
                phone={booking.guest_phone}
                onSuccess={handlePaymentSuccess}
                onError={(err) => alert(err.message)}
              />
            </div>
          </div>
        )}

        {/* Voucher Card */}
        <div className="bg-white rounded-3xl border border-[#EAE3D2] overflow-hidden shadow-xl">
          {/* Voucher Header */}
          <div className="p-6 sm:p-8 bg-[#101D1E] text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#C89B3C]">
                Official Event Accommodation Voucher
              </span>
              <h3 className="text-xl font-serif font-black text-white mt-0.5">
                {booking.property?.title || 'Accommodation'}
              </h3>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-[#C89B3C]" />
                {booking.property?.address || booking.property?.city || 'Abuja, Nigeria'}
              </p>
            </div>
            <div className="text-right">
              <StatusBadge status={booking.status} />
              <p className="text-[11px] text-slate-400 mt-1.5">
                Ref: <span className="font-mono text-white font-bold">{booking.booking_reference}</span>
              </p>
            </div>
          </div>

          {/* Voucher Details Body */}
          <div className="p-6 sm:p-8 space-y-8">
            {/* Grid 1: Stay & Guests */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pb-6 border-b border-slate-100 text-xs">
              <div>
                <span className="text-slate-400 font-medium block">Lead Guest:</span>
                <span className="font-bold text-slate-900 text-sm">
                  {booking.guest_first_name} {booking.guest_last_name}
                </span>
                <span className="text-[11px] text-slate-500 block">{booking.guest_email}</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Check-In:</span>
                <span className="font-bold text-slate-900 text-sm">{booking.check_in}</span>
                <span className="text-[11px] text-slate-500 block">From 14:00</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Check-Out:</span>
                <span className="font-bold text-slate-900 text-sm">{booking.check_out}</span>
                <span className="text-[11px] text-slate-500 block">Until 11:00</span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Duration / Occupancy:</span>
                <span className="font-bold text-slate-900 text-sm">
                  {booking.nights} Nights • {booking.guests} Guests
                </span>
                <span className="text-[11px] text-emerald-700 font-semibold block">
                  {booking.room?.name || 'Standard Room'}
                </span>
              </div>
            </div>

            {/* Grid 2: Financial Breakdown */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Payment Accounting
              </h4>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Accommodation Subtotal ({booking.nights} Nights):</span>
                  <span className="font-bold text-slate-900">{formatNaira(booking.accommodation_subtotal)}</span>
                </div>
                {booking.logistics_subtotal > 0 && (
                  <div className="flex justify-between text-emerald-800">
                    <span>Coordinated Ground Logistics:</span>
                    <span className="font-bold">{formatNaira(booking.logistics_subtotal)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-200 text-sm">
                  <span className="font-bold text-slate-900">Total Charged:</span>
                  <span className="font-black text-[#1E7A5E]">{formatNaira(booking.total_amount)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Voucher Actions Footer */}
          <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-slate-900 text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print / Save Voucher
            </button>
            <Link
              to="/my-trips"
              className="px-5 py-2.5 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
            >
              <span>View In My Trips</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
