import { supabase } from './supabase';
import { Booking } from '../types/database';
import { clearAccommodationSearchState } from './searchContext';
import { formatNGN } from './currency';

export const formatNaira = formatNGN;


export interface PaystackInitResponse {
  status: string;
  authorization_url?: string;
  access_code?: string;
  reference: string;
  amount_ngn?: number;
  currency?: string;
  test_mode?: boolean;
  message?: string;
  booking_reference?: string;
  booking_id?: string;
  email?: string;
}

export interface PaystackVerifyResponse {
  success: boolean;
  status?: string;
  message: string;
  booking?: Booking;
  reference?: string;
  amount_paid_ngn?: number;
  test_mode?: boolean;
  error?: string;
}

/**
 * Initializes a secure Paystack payment on the server.
 * Reads the authoritative amount from the database and returns the authorization URL.
 */
export async function initializePaystackPayment(
  bookingIdOrRef: string,
  callbackUrl?: string,
  bookingReference?: string
): Promise<PaystackInitResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Authentication required. Please sign in to initialize payment.');
  }

  const trimmed = (bookingIdOrRef || '').trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);

  const payload: {
    booking_id?: string;
    booking_reference?: string;
    callback_url?: string;
  } = {
    callback_url: callbackUrl || window.location.origin + window.location.pathname,
  };

  if (isUuid) {
    payload.booking_id = trimmed;
  } else {
    payload.booking_reference = trimmed;
  }

  if (bookingReference && bookingReference.trim()) {
    payload.booking_reference = bookingReference.trim();
  }

  const res = await fetch('/api/paystack/initialize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let data: any;
  try {
    data = await res.json();
  } catch (_jsonErr) {
    throw new Error(`Payment service returned HTTP ${res.status}. Please check your connection or contact support.`);
  }

  if (!res.ok || !data) {
    throw new Error(data?.error || data?.message || 'Failed to initialize payment with Paystack.');
  }
  return data;
}

/**
 * Verifies a Paystack payment reference on the server.
 * Updates booking to paid & confirmed in Supabase upon successful verification.
 */
export async function verifyPaystackPayment(
  reference: string,
  bookingId?: string,
  bookingReference?: string,
  trxref?: string
): Promise<PaystackVerifyResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  let token = sessionData?.session?.access_token;
  if (!token) {
    const { data: refreshedSession } = await supabase.auth.getSession();
    token = refreshedSession?.session?.access_token;
  }

  let resolvedBookingId = bookingId;
  let resolvedBookingRef = bookingReference;
  const effectiveTrxref = trxref || reference;

  // Fallback to locally preserved booking info if not supplied
  if (!resolvedBookingId || !resolvedBookingRef) {
    try {
      const stored = sessionStorage.getItem('ark_last_payment_booking') || localStorage.getItem('ark_last_payment_booking');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!resolvedBookingId && parsed.bookingId) resolvedBookingId = parsed.bookingId;
        if (!resolvedBookingRef && parsed.bookingReference) resolvedBookingRef = parsed.bookingReference;
      }
    } catch (_) {}
  }

  console.log('[PAYSTACK VERIFY] Starting verification', {
    reference,
    trxref: effectiveTrxref,
    bookingId: resolvedBookingId,
    bookingReference: resolvedBookingRef,
  });

  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, 20000);

  try {
    console.log('[PAYSTACK VERIFY] Sending request to /api/paystack/verify');
    const response = await fetch('/api/paystack/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        reference,
        trxref: effectiveTrxref,
        booking_id: resolvedBookingId,
        booking_reference: resolvedBookingRef,
      }),
      signal: controller.signal,
    });

    console.log('[PAYSTACK VERIFY] Response received', {
      status: response.status,
      ok: response.ok,
    });

    const result = await response.json();
    console.log('[PAYSTACK VERIFY] Response body', result);

    if (!response.ok || !result.success) {
      return {
        success: false,
        message: result.error || result.message || 'Payment verification could not be completed.',
        error: result.error,
        status: result.status,
      };
    }

    // Clear preserved booking tracking and accommodation search context upon successful verification
    clearAccommodationSearchState();
    try {
      sessionStorage.removeItem('ark_last_payment_booking');
      localStorage.removeItem('ark_last_payment_booking');
    } catch (_) {}

    return result;
  } catch (error: any) {
    console.error('[PAYSTACK VERIFY] Verification failed', error);
    if (error.name === 'AbortError') {
      return {
        success: false,
        message: 'Paystack verification timed out. Please retry.',
        error: 'Paystack verification timed out',
      };
    }
    return {
      success: false,
      message: error.message || 'Network error during payment verification.',
      error: error.message,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
