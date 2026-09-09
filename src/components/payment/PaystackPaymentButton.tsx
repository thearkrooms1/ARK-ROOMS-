import React, { useState } from 'react';
import { CreditCard, ShieldCheck, Loader2, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import { formatNGN } from '../../lib/currency';
import { initializePaystackPayment, verifyPaystackPayment, PaystackInitResponse } from '../../lib/paystack';
import { Booking } from '../../types/database';

interface PaystackPaymentButtonProps {
  bookingIdOrRef?: string;
  bookingId?: string;
  bookingReference?: string;
  totalAmountNGN?: number;
  amountNGN?: number;
  email?: string;
  customerName?: string;
  phone?: string;
  onSuccess?: (ref: string) => void;
  onError?: (err: any) => void;
  onPaymentSuccess?: (updatedBooking?: Booking) => void;
  className?: string;
  buttonText?: string;
  size?: 'sm' | 'md' | 'lg';
  callbackUrl?: string;
}

export const PaystackPaymentButton: React.FC<PaystackPaymentButtonProps> = ({
  bookingIdOrRef,
  bookingId,
  bookingReference,
  totalAmountNGN,
  amountNGN,
  email,
  customerName,
  phone,
  onSuccess,
  onError,
  onPaymentSuccess,
  className = '',
  buttonText,
  size = 'lg',
  callbackUrl,
}) => {
  const effectiveBookingIdOrRef = bookingIdOrRef || bookingId || '';
  const effectiveTotalAmount = totalAmountNGN || amountNGN || 0;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testModalData, setTestModalData] = useState<PaystackInitResponse | null>(null);
  const [verifyingTest, setVerifyingTest] = useState(false);

  const handlePayClick = async () => {
    try {
      setLoading(true);
      setError(null);

      // Construct robust callback URL with booking_id and booking_reference embedded in query string
      const baseCallbackUrl = callbackUrl || `${window.location.origin}/my-trips`;
      let targetCallbackUrl = baseCallbackUrl;
      try {
        const urlObj = new URL(baseCallbackUrl);
        if (effectiveBookingIdOrRef) urlObj.searchParams.set('booking_id', effectiveBookingIdOrRef);
        if (bookingReference) urlObj.searchParams.set('booking_reference', bookingReference);
        targetCallbackUrl = urlObj.toString();
      } catch (_) {
        targetCallbackUrl = baseCallbackUrl;
      }

      // Preserve last payment booking tracking in browser storage
      try {
        const trackingPayload = JSON.stringify({
          bookingId: effectiveBookingIdOrRef,
          bookingReference: bookingReference,
          timestamp: Date.now(),
        });
        sessionStorage.setItem('ark_last_payment_booking', trackingPayload);
        localStorage.setItem('ark_last_payment_booking', trackingPayload);
      } catch (_) {}

      console.log('[Paystack Checkout Initiate]', {
        bookingId: effectiveBookingIdOrRef,
        bookingReference,
        targetCallbackUrl,
      });

      const initResult = await initializePaystackPayment(effectiveBookingIdOrRef, targetCallbackUrl, bookingReference);

      if (initResult.test_mode) {
        // Show test payment simulation modal
        setTestModalData(initResult);
        setLoading(false);
        return;
      }

      if (initResult.authorization_url) {
        // Redirect directly to Paystack official hosted checkout
        window.location.href = initResult.authorization_url;
      } else {
        throw new Error('No authorization URL received from payment gateway.');
      }
    } catch (err: any) {
      console.error('[Paystack Payment Error]', err);
      setError(err.message || 'Unable to initiate Paystack payment. Please try again.');
      setLoading(false);
    }
  };

  const handleConfirmTestPayment = async () => {
    if (!testModalData) return;
    try {
      setVerifyingTest(true);
      setError(null);
      const verifyResult = await verifyPaystackPayment(
        testModalData.reference,
        testModalData.booking_id || bookingIdOrRef,
        testModalData.booking_reference || bookingReference
      );
      if (verifyResult.success) {
        setTestModalData(null);
        if (onPaymentSuccess) {
          onPaymentSuccess(verifyResult.booking);
        }
      } else {
        setError(verifyResult.message || 'Test payment verification failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Error verifying test payment.');
    } finally {
      setVerifyingTest(false);
    }
  };

  const sizeClasses = {
    sm: 'py-2 px-3 text-xs',
    md: 'py-2.5 px-4 text-xs sm:text-sm',
    lg: 'py-4 px-6 text-sm sm:text-base',
  }[size];

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2 animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold">Payment Error</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        id="paystack-checkout-button"
        onClick={handlePayClick}
        disabled={loading}
        className={`w-full inline-flex items-center justify-center gap-2.5 bg-[#0BA4DB] hover:bg-[#0991C2] active:scale-[0.99] text-white font-black tracking-wide uppercase rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed ${sizeClasses} ${className}`}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>Connecting to Paystack...</span>
          </>
        ) : (
          <>
            <CreditCard className="w-5 h-5 text-white" />
            <span>{buttonText || `Pay Now (${formatNGN(effectiveTotalAmount)})`}</span>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] bg-white/20 px-2 py-0.5 rounded font-mono font-bold">
              <ShieldCheck className="w-3 h-3" /> Paystack Secured
            </span>
          </>
        )}
      </button>

      {/* Test Mode Simulation Modal for local / preview testing */}
      {testModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#0BA4DB]/10 text-[#0BA4DB] flex items-center justify-center">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-[#0B1F3A]">Paystack Sandbox Payment</h3>
                  <span className="text-[10px] text-amber-700 font-bold uppercase">Test Environment Mode</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTestModalData(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xs p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Booking Reference</span>
                <span className="font-bold text-[#0B1F3A]">{testModalData.booking_reference || bookingIdOrRef}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Authoritative Amount (NGN)</span>
                <span className="font-black text-emerald-800 text-sm">{formatNGN(testModalData.amount_ngn || totalAmountNGN)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Generated Transaction Ref</span>
                <span className="font-mono text-[10px] text-slate-800 break-all">{testModalData.reference}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Customer Email</span>
                <span className="font-bold text-slate-800">{testModalData.email}</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] space-y-1">
              <p className="font-bold">Paystack Secret Key Configuration Notice:</p>
              <p>
                To enable live Paystack payment checkout, add <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">PAYSTACK_SECRET_KEY</code> to your environment variables. In test mode, clicking below verifies the transaction directly via the server API.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmTestPayment}
                disabled={verifyingTest}
                className="flex-1 py-3 px-4 bg-[#1E7A5E] hover:bg-[#155642] text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {verifyingTest ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Verifying with Server...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Simulate Successful Payment</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setTestModalData(null)}
                className="py-3 px-4 border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
