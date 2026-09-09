import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPayoutService } from './payoutService';
import { getRefundService } from './refundService';
import type { MediaPublicationStatus, MediaExecutionStatus } from '../src/types/database';

dotenv.config();

const PORT = 3000;

export interface SupabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function getSupabaseCredentials(): SupabaseConfig {
  const rawUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  const rawAnonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  // Sanitize URL and fix environment typo if present
  const supabaseUrl = rawUrl
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace('dadwdteyaugevbqscjzn', 'dadwtevyaugevbqscjzn')
    .replace(/\.supabase\.com(\/.*)?$/, (_m, p) => `.supabase.co${p || ''}`);
  const supabaseAnonKey = rawAnonKey.trim().replace(/^["']|["']$/g, '');

  return { supabaseUrl, supabaseAnonKey };
}

export function getServerSupabase(): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseCredentials();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing required Supabase credentials (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Please configure environment variables.'
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

export function createUserSupabaseClient(token: string): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseCredentials();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing required Supabase credentials (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Please configure environment variables.'
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export interface CreateAppOptions {
  isVercel?: boolean;
  skipListen?: boolean;
  serveStatic?: boolean;
}

export function createApp(_options: CreateAppOptions = {}) {
  const app = express();

  // Parse JSON payloads with raw body capture for webhook signature verification
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Health check endpoint
  app.get(['/api/health', '/health'], (_req: Request, res: Response) => {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseCredentials();
    res.json({
      status: 'ok',
      service: 'TheArkRooms API',
      timestamp: new Date().toISOString(),
      paystack_configured: !!process.env.PAYSTACK_SECRET_KEY,
      supabase_configured: !!(supabaseUrl && supabaseAnonKey),
    });
  });

  // Helper to get authenticated user from Supabase token in Authorization header
  async function getAuthUser(req: Request) {
    const authHeader = req.headers.authorization;
    const hasAuthHeader = Boolean(authHeader && authHeader.toLowerCase().startsWith('bearer '));
    console.log(`[Auth Diagnostic] Authorization header present: ${hasAuthHeader}`);
    if (!hasAuthHeader) {
      return null;
    }
    const token = authHeader!.replace(/^bearer\s+/i, '').trim();
    if (!token) {
      console.log('[Auth Diagnostic] Bearer token string is empty');
      return null;
    }
    try {
      const supabaseServer = getServerSupabase();
      const { data, error } = await supabaseServer.auth.getUser(token);
      if (error || !data?.user) {
        console.log(`[Auth Diagnostic] Supabase auth.getUser failed: ${error?.message || 'No user data returned'}`);
        return null;
      }
      console.log(`[Auth Diagnostic] Authenticated user recognized: user_id=${data.user.id}`);
      return { user: data.user, token };
    } catch (err: any) {
      console.error(`[Auth Diagnostic] Supabase auth exception: ${err?.message}`);
      return null;
    }
  }

  // Authoritative server-side helper to verify that a request is authenticated AND authorized as an admin
  async function getAuthAdmin(req: Request) {
    const authResult = await getAuthUser(req);
    if (!authResult) {
      return {
        authorized: false as const,
        status: 401,
        error: 'Authentication required. Please sign in to access administrative operations.',
        user: null,
        profile: null,
        token: null,
      };
    }
    const { user, token } = authResult;

    try {
      const supabaseServer = getServerSupabase();
      // 1. Authoritative check: verify admin role in profiles table using server client
      const { data: profile, error: profileErr } = await supabaseServer
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', user.id)
        .maybeSingle();

      if (profileErr) {
        console.error('[Admin Auth] Error querying profiles for admin check:', profileErr.message);
        return {
          authorized: false as const,
          status: 500,
          error: 'Database error validating administrator privileges.',
          user,
          profile: null,
          token,
        };
      }

      if (!profile || profile.role !== 'admin') {
        console.warn(
          `[Admin Auth] Forbidden access attempt: user ${user.id} (${user.email}) has role "${profile?.role || 'customer'}"`
        );
        return {
          authorized: false as const,
          status: 403,
          error: 'Administrator access required.',
          user,
          profile,
          token,
        };
      }

      console.log(`[Admin Auth] Authoritative admin verified: user_id=${user.id}, email=${user.email}`);
      return {
        authorized: true as const,
        status: 200,
        error: null,
        user,
        profile,
        token,
      };
    } catch (err: any) {
      console.error('[Admin Auth] Exception during administrator check:', err);
      return {
        authorized: false as const,
        status: 500,
        error: 'Internal server error validating administrator privileges.',
        user,
        profile: null,
        token,
      };
    }
  }

  async function getAuthHost(req: Request) {
    const authResult = await getAuthUser(req);
    if (!authResult) {
      return {
        authorized: false as const,
        status: 401,
        error: 'Authentication token is missing, expired, or invalid. Please sign in.',
        user: null,
        hostProfile: null,
        token: null,
      };
    }

    const { user, token } = authResult;
    const userClient = createUserSupabaseClient(token);

    try {
      const { data: hostProfile, error } = await userClient
        .from('host_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && !error.message.includes('does not exist') && !error.message.includes('schema cache')) {
        console.warn('[Host Auth] Error querying host profile:', error.message);
      }

      if (hostProfile) {
        if (hostProfile.host_status === 'suspended') {
          return {
            authorized: false as const,
            status: 403,
            error: 'Your host account has been suspended. Please contact support.',
            user,
            hostProfile,
            token,
          };
        }
        return {
          authorized: true as const,
          status: 200,
          error: null,
          user,
          hostProfile,
          token,
        };
      }

      if (user.user_metadata?.account_type === 'host') {
        return {
          authorized: true as const,
          status: 200,
          error: null,
          user,
          hostProfile: {
            id: `hp-${user.id}`,
            user_id: user.id,
            host_status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          token,
        };
      }

      return {
        authorized: false as const,
        status: 403,
        error: 'Host registration required to access host resources.',
        user,
        hostProfile: null,
        token,
      };
    } catch (err: any) {
      console.error('[Host Auth] Exception during host authorization:', err);
      return {
        authorized: false as const,
        status: 500,
        error: 'Internal server error validating host authorization.',
        user,
        hostProfile: null,
        token,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Paystack Initialize Endpoint: POST /api/paystack/initialize
  // ---------------------------------------------------------------------------
  app.post(['/api/paystack/initialize', '/paystack/initialize'], async (req: Request, res: Response) => {
    try {
      // 1. Authenticate user from Supabase JWT
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({
          error: 'Authentication required. Please sign in to initialize payment.',
        });
      }
      const { user, token } = authResult;

      const { booking_id, booking_reference, client_total_amount, total_amount_ngn } = req.body;
      const rawId = (typeof booking_id === 'string' ? booking_id : '').trim();
      const rawRef = (typeof booking_reference === 'string' ? booking_reference : '').trim();

      if (!rawId && !rawRef) {
        return res.status(400).json({
          error: 'Missing booking identification: booking_id or booking_reference is required.',
        });
      }

      const isUuid = (val: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

      // Create a Supabase client authenticated as the requesting user to satisfy Row Level Security
      const userSupabase = createUserSupabaseClient(token);
      const supabaseServer = getServerSupabase();
      let booking: any = null;
      let lookupMethod = 'none';
      let dbError: any = null;

      // 2. Retrieve authoritative booking from database using safe UUID/reference differentiation
      // Case A: A valid UUID booking ID was supplied -> query by id
      if (rawId && isUuid(rawId)) {
        lookupMethod = 'id_uuid';
        const { data, error } = await userSupabase.from('bookings').select('*').eq('id', rawId).limit(1);
        if (error) dbError = error;
        if (data && data.length > 0) {
          booking = data[0];
        } else {
          // Fallback check with server client
          const { data: serverData, error: serverErr } = await supabaseServer.from('bookings').select('*').eq('id', rawId).limit(1);
          if (serverErr && !dbError) dbError = serverErr;
          if (serverData && serverData.length > 0) booking = serverData[0];
        }
      }

      // Case B: If not found and a booking_reference was supplied -> query by booking_reference
      if (!booking && rawRef) {
        lookupMethod = lookupMethod === 'none' ? 'booking_reference' : `${lookupMethod}_fallback_reference`;
        const { data, error } = await userSupabase.from('bookings').select('*').eq('booking_reference', rawRef).limit(1);
        if (error && !dbError) dbError = error;
        if (data && data.length > 0) {
          booking = data[0];
        } else {
          const { data: serverData, error: serverErr } = await supabaseServer.from('bookings').select('*').eq('booking_reference', rawRef).limit(1);
          if (serverErr && !dbError) dbError = serverErr;
          if (serverData && serverData.length > 0) booking = serverData[0];
        }
      }

      // Case C: If not found and rawId was supplied but is NOT a UUID (e.g. user passed booking_reference into booking_id field)
      if (!booking && rawId && !isUuid(rawId)) {
        lookupMethod = lookupMethod === 'none' ? 'raw_id_as_ref' : `${lookupMethod}_id_as_ref`;
        const { data, error } = await userSupabase.from('bookings').select('*').eq('booking_reference', rawId).limit(1);
        if (error && !dbError) dbError = error;
        if (data && data.length > 0) {
          booking = data[0];
        } else {
          const { data: serverData, error: serverErr } = await supabaseServer.from('bookings').select('*').eq('booking_reference', rawId).limit(1);
          if (serverErr && !dbError) dbError = serverErr;
          if (serverData && serverData.length > 0) booking = serverData[0];
        }
      }

      // Safe Diagnostic Logging
      console.log('[Booking Lookup Diagnostic]', {
        receivedBookingId: rawId || null,
        receivedBookingReference: rawRef || null,
        isUuid: rawId ? isUuid(rawId) : false,
        authenticatedUserId: user.id,
        lookupMethod,
        hasDbError: !!dbError,
        dbErrorMessage: dbError?.message || null,
        bookingFound: !!booking,
        foundBookingId: booking?.id || null,
        foundBookingOwner: booking?.user_id || null,
      });

      if (!booking) {
        return res.status(404).json({
          error: 'Booking record not found in database.',
        });
      }

      // 3. Confirm ownership: user must match booking user_id or guest_email
      const isOwner =
        booking.user_id === user.id ||
        (booking.guest_email && user.email && booking.guest_email.toLowerCase() === user.email.toLowerCase());

      console.log(
        `[Auth Diagnostic] Booking ownership verified: booking_id=${booking.id}, booking_user_id=${booking.user_id}, authenticated_user_id=${user.id}, is_owner=${isOwner}`
      );

      if (!isOwner) {
        return res.status(403).json({
          error: 'Access denied: You do not have permission to pay for this booking.',
        });
      }

      // 4. Booking status and duplicate payment checks
      if (booking.booking_status === 'cancelled' || booking.booking_status === 'rejected') {
        return res.status(400).json({
          error: `Cannot process payment for ${booking.booking_status} booking.`,
          booking_status: booking.booking_status,
          payment_status: booking.payment_status,
        });
      }

      if (booking.payment_status === 'paid') {
        return res.status(400).json({
          error: 'Payment has already been completed for this booking.',
          booking_status: booking.booking_status,
          payment_status: booking.payment_status,
        });
      }

      // Gate #6.3 Expiration Check: Unsettled pending booking must be within 30-minute hold window
      if (
        booking.booking_status === 'pending' &&
        booking.payment_status !== 'paid' &&
        booking.expires_at &&
        new Date(booking.expires_at).getTime() <= Date.now()
      ) {
        return res.status(400).json({
          error: 'This booking hold has expired. Please select your dates and create a new reservation.',
          booking_status: booking.booking_status,
          payment_status: booking.payment_status,
          expires_at: booking.expires_at,
        });
      }

      // 5. Authoritative amount verification & calculation
      // Calculate nights
      let nights = 1;
      if (booking.check_in && booking.check_out) {
        const checkInDate = new Date(booking.check_in);
        const checkOutDate = new Date(booking.check_out);
        const diffTime = checkOutDate.getTime() - checkInDate.getTime();
        nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      }

      // Resolve room rate from trusted database
      let roomPrice = 0;
      let roomIdToUse = booking.room_id || null;

      if (roomIdToUse) {
        const { data: roomData } = await supabaseServer
          .from('rooms')
          .select('*')
          .eq('id', roomIdToUse)
          .maybeSingle();

        if (roomData) {
          roomPrice = Number(roomData.price_per_night_ngn ?? roomData.price_per_night ?? 0);
        }
      }

      if (roomPrice <= 0 && booking.property_id) {
        const { data: propRooms } = await supabaseServer
          .from('rooms')
          .select('*')
          .eq('property_id', booking.property_id)
          .order('price_per_night_ngn', { ascending: true })
          .limit(1);

        if (propRooms && propRooms.length > 0) {
          const defaultRoom = propRooms[0];
          roomPrice = Number(defaultRoom.price_per_night_ngn ?? defaultRoom.price_per_night ?? 0);
          if (!roomIdToUse) {
            roomIdToUse = defaultRoom.id;
          }
        }
      }

      const authoritativeRoomTotal = nights * roomPrice;

      // Fetch linked logistics requests from trusted database
      let authoritativeLogisticsTotal = 0;
      try {
        const { data: logisticsRows } = await supabaseServer
          .from('logistics_requests')
          .select('price_ngn, amount')
          .eq('booking_id', booking.id);

        if (logisticsRows && Array.isArray(logisticsRows) && logisticsRows.length > 0) {
          authoritativeLogisticsTotal = logisticsRows.reduce(
            (acc: number, item: any) => acc + Number(item.price_ngn ?? item.amount ?? 0),
            0
          );
        } else if (Number(booking.logistics_total_ngn || 0) > 0) {
          authoritativeLogisticsTotal = Number(booking.logistics_total_ngn || 0);
        }
      } catch (logisticsFetchErr) {
        console.warn('[Paystack Init] Warning fetching logistics requests:', logisticsFetchErr);
        authoritativeLogisticsTotal = Number(booking.logistics_total_ngn || 0);
      }

      // Fetch authoritative damage deposit from property (FIN-DEC-02)
      let authoritativeDamageDeposit = 0;
      if (booking.property_id) {
        const { data: propData } = await supabaseServer
          .from('properties')
          .select('requires_damage_deposit, damage_deposit_amount_ngn')
          .eq('id', booking.property_id)
          .maybeSingle();

        if (propData && propData.requires_damage_deposit) {
          authoritativeDamageDeposit = Number(propData.damage_deposit_amount_ngn || 0);
        }
      }

      const expectedAuthoritativeTotal = authoritativeRoomTotal + authoritativeLogisticsTotal + authoritativeDamageDeposit;
      const storedBookingTotal = Number(booking.total_amount_ngn ?? booking.total_amount ?? 0);

      // Enforce client price assertion check (Anti-tampering SAFE-01)
      const clientAssertedTotal = client_total_amount ?? total_amount_ngn;
      if (clientAssertedTotal !== undefined && clientAssertedTotal !== null) {
        const clientVal = Number(clientAssertedTotal);
        if (Number.isFinite(clientVal) && Math.abs(clientVal - expectedAuthoritativeTotal) > 0.01) {
          console.error(
            `[Paystack Init SECURITY REJECTION] Client price assertion mismatch for ${booking.id}: client=${clientVal}, authoritativeExpected=${expectedAuthoritativeTotal}`
          );
          return res.status(400).json({
            error: 'Payment initialization rejected: Tampered or invalid booking amount detected.',
            details: 'Client total does not match authoritative room, logistics, and damage deposit calculations.',
          });
        }
      }

      // Enforce authoritative validation:
      // If the stored total is positive and authoritative expected total is computed, they MUST match
      if (storedBookingTotal > 0 && expectedAuthoritativeTotal > 0) {
        if (Math.abs(storedBookingTotal - expectedAuthoritativeTotal) > 1) {
          console.error(
            `[Paystack Init SECURITY REJECTION] Mismatched booking total for ${booking.id}: stored=${storedBookingTotal}, authoritativeExpected=${expectedAuthoritativeTotal} (roomTotal=${authoritativeRoomTotal}, logisticsTotal=${authoritativeLogisticsTotal}, damageDeposit=${authoritativeDamageDeposit})`
          );
          return res.status(400).json({
            error: 'Payment initialization rejected: Tampered or invalid booking amount detected.',
            details: 'Stored booking total does not match authoritative room, logistics, and damage deposit pricing.',
          });
        }
      }

      // Always use the authoritatively calculated total
      let amountNGN = expectedAuthoritativeTotal > 0 ? expectedAuthoritativeTotal : storedBookingTotal;

      if (expectedAuthoritativeTotal > 0 && (storedBookingTotal <= 0 || storedBookingTotal !== expectedAuthoritativeTotal)) {
        try {
          const updatePayload: Record<string, any> = {
            room_total_ngn: authoritativeRoomTotal,
            logistics_total_ngn: authoritativeLogisticsTotal,
            damage_deposit_ngn: authoritativeDamageDeposit,
            total_amount_ngn: expectedAuthoritativeTotal,
          };
          if (roomIdToUse && !booking.room_id) {
            updatePayload.room_id = roomIdToUse;
            booking.room_id = roomIdToUse;
          }

          await supabaseServer
            .from('bookings')
            .update(updatePayload)
            .eq('id', booking.id);
        } catch (syncErr) {
          console.warn('[Paystack Init] Error updating authoritative booking amounts:', syncErr);
        }
      }

      booking.total_amount_ngn = amountNGN;
      booking.room_total_ngn = authoritativeRoomTotal;
      booking.logistics_total_ngn = authoritativeLogisticsTotal;
      booking.damage_deposit_ngn = authoritativeDamageDeposit;

      if (amountNGN <= 0) {
        return res.status(400).json({
          error: 'Invalid booking amount: Total amount must be greater than zero.',
        });
      }

      // Convert NGN to Kobo (1 NGN = 100 Kobo)
      const amountInKobo = Math.round(amountNGN * 100);

      // 6. Generate unique Paystack transaction reference derived from booking reference
      const cleanBookingRef = String(booking.booking_reference || '').trim();
      const uniqueSuffix = Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
      const paystackReference = cleanBookingRef
        ? `PAY-${cleanBookingRef}-${uniqueSuffix}`
        : `PAY-ARK-${Date.now()}-${uniqueSuffix}`;

      const customerEmail = (booking.guest_email || user.email || 'customer@thearkrooms.com').trim();
      const secretKey = process.env.PAYSTACK_SECRET_KEY;

      console.log('[Paystack Init Diagnostic]', {
        bookingId: booking.id,
        bookingReference: booking.booking_reference,
        paystackReference,
        amountNGN,
        email: customerEmail,
        hasSecretKey: !!secretKey,
      });

      // 7. Check if Paystack Secret Key is configured
      if (!secretKey) {
        const isDeployed = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
        if (isDeployed) {
          console.error('[Paystack API Error] PAYSTACK_SECRET_KEY is missing in production deployment environment.');
          return res.status(500).json({
            error: 'Payment system is not properly configured: PAYSTACK_SECRET_KEY is required in production deployment.',
          });
        }
        // Return clear response indicating missing server key for local development preview only
        console.warn('[Paystack API] PAYSTACK_SECRET_KEY is not set in environment variables (local development preview mode).');
        return res.status(200).json({
          test_mode: true,
          status: 'test_mode',
          message: 'Paystack Secret Key is not configured. Local development test mode active.',
          reference: paystackReference,
          amount_ngn: amountNGN,
          amount_kobo: amountInKobo,
          currency: 'NGN',
          email: customerEmail,
          booking_reference: booking.booking_reference,
          booking_id: booking.id,
        });
      }

      // 8. Call Paystack REST API Initialize Transaction
      // Never accept untrusted callback_url from client; derive strictly from server-configured APP_URL
      let finalCallbackUrl: string | undefined = undefined;
      const configuredAppUrl = process.env.APP_URL || process.env.VITE_APP_URL || '';
      if (configuredAppUrl && configuredAppUrl.trim()) {
        const baseAppUrl = configuredAppUrl.trim().replace(/\/$/, '');
        if (baseAppUrl.startsWith('http://') || baseAppUrl.startsWith('https://')) {
          finalCallbackUrl = `${baseAppUrl}/my-trips?booking_id=${booking.id}&booking_reference=${encodeURIComponent(booking.booking_reference || '')}`;
        }
      }

      const paystackPayload = {
        email: customerEmail,
        amount: amountInKobo,
        currency: 'NGN',
        reference: paystackReference,
        callback_url: finalCallbackUrl || undefined,
        metadata: {
          booking_id: booking.id,
          booking_reference: booking.booking_reference,
          user_id: user.id,
          guest_name: booking.guest_name,
          custom_fields: [
            {
              display_name: 'Booking Reference',
              variable_name: 'booking_reference',
              value: booking.booking_reference,
            },
            {
              display_name: 'Booking ID',
              variable_name: 'booking_id',
              value: booking.id,
            },
            {
              display_name: 'Accommodation Stay',
              variable_name: 'property_id',
              value: booking.property_id,
            },
          ],
        },
      };

      const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paystackPayload),
      });

      const result = await paystackResponse.json();

      if (!paystackResponse.ok || !result.status) {
        console.error('[Paystack Initialize Error]', result);
        return res.status(400).json({
          error: result.message || 'Failed to initialize Paystack checkout transaction.',
          details: result,
        });
      }

      // 9. Record pending payment entry in database table `payments`
      try {
        await supabaseServer.from('payments').insert({
          booking_id: booking.id,
          amount_ngn: amountNGN,
          currency: 'NGN',
          provider: 'paystack',
          status: 'pending',
          transaction_reference: paystackReference,
        });
      } catch (logErr) {
        console.warn('[Payments table log error - non-blocking]', logErr);
      }

      // 10. Return only safe frontend checkout data (never the secret key)
      return res.json({
        status: 'success',
        authorization_url: result.data.authorization_url,
        access_code: result.data.access_code,
        reference: paystackReference,
        amount_ngn: amountNGN,
        currency: 'NGN',
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
      });
    } catch (err: any) {
      console.error('[Paystack Initialize Exception]', err);
      return res.status(500).json({
        error: err.message || 'Internal server error while initializing payment.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Paystack Verify Endpoint: POST /api/paystack/verify
  // ---------------------------------------------------------------------------
  app.post(['/api/paystack/verify', '/paystack/verify'], async (req: Request, res: Response) => {
    try {
      console.log('[PAYSTACK VERIFY] REQUEST RECEIVED', {
        body: req.body,
        ip: req.ip,
      });

      const {
        reference,
        trxref,
        booking_id,
        booking_reference,
      } = req.body || {};

      const effectiveReference = String(reference || trxref || '').trim();

      if (!effectiveReference) {
        return res.status(400).json({
          success: false,
          error: 'Missing transaction reference to verify.',
        });
      }

      // -----------------------------------------------------------------------
      // 1. Authenticate the customer
      // -----------------------------------------------------------------------
      const authResult = await getAuthUser(req);
      const authUser = authResult?.user || null;
      const authToken = authResult?.token || null;

      console.log('[PAYSTACK VERIFY] AUTHENTICATED USER', {
        authenticated: !!authUser,
        userId: authUser?.id || null,
        hasAuthToken: !!authToken,
      });

      if (!authUser || !authToken) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required to verify this payment.',
        });
      }

      // -----------------------------------------------------------------------
      // 2. Authenticated Supabase client
      // -----------------------------------------------------------------------
      const userSupabase = createUserSupabaseClient(authToken);
      const supabaseServer = getServerSupabase();

      // -----------------------------------------------------------------------
      // 3. Helpers
      // -----------------------------------------------------------------------
      const isUuid = (value: string): boolean =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value
        );

      const extractBookingReference = (
        value: unknown
      ): string | null => {
        if (value === null || value === undefined) {
          return null;
        }

        const input = String(value).trim();
        if (!input) {
          return null;
        }

        const standardMatch = input.match(
          /ARK-\d{4}-[A-Za-z0-9]+/i
        );

        if (standardMatch) {
          return standardMatch[0].toUpperCase();
        }

        const compactMatch = input.match(
          /ARK(\d{4})([A-Za-z0-9]{4,20})/i
        );

        if (compactMatch) {
          return `ARK-${compactMatch[1]}-${compactMatch[2]}`.toUpperCase();
        }

        return null;
      };

      const normalizeReference = (
        value: unknown
      ): string => {
        return String(value || '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
      };

      const rawBookingId =
        typeof booking_id === 'string'
          ? booking_id.trim()
          : '';
      const rawBookingReference =
        typeof booking_reference === 'string'
          ? booking_reference.trim()
          : '';

      const extractedReference =
        extractBookingReference(effectiveReference);

      console.log('[PAYSTACK VERIFY] IDENTIFIERS', {
        paystackReference: effectiveReference,
        bookingId: rawBookingId || null,
        bookingReference: rawBookingReference || null,
        extractedBookingReference: extractedReference || null,
        authenticatedUserId: authUser.id,
      });

      // -----------------------------------------------------------------------
      // 4. Helper for user-scoped booking lookup
      // -----------------------------------------------------------------------
      const findBooking = async (
        label: string,
        queryFn: (client: any) => any
      ): Promise<any | null> => {
        try {
          const { data, error } = await queryFn(userSupabase);

          console.log('[PAYSTACK VERIFY] LOOKUP', {
            label,
            found: !!(data && (Array.isArray(data) ? data.length : true)),
            error: error?.message || null,
          });

          if (error) {
            console.warn(
              `[PAYSTACK VERIFY] Lookup "${label}" failed:`,
              error.message
            );
            return null;
          }

          if (Array.isArray(data)) {
            return data.length > 0 ? data[0] : null;
          }

          return data || null;
        } catch (error: any) {
          console.warn(
            `[PAYSTACK VERIFY] Lookup "${label}" exception:`,
            error?.message || error
          );
          return null;
        }
      };

      // -----------------------------------------------------------------------
      // 5. Paystack Secret Key
      // -----------------------------------------------------------------------
      const secretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!secretKey) {
        return res.status(500).json({
          success: false,
          error: 'PAYSTACK_SECRET_KEY is not configured on the server.',
        });
      }

      // -----------------------------------------------------------------------
      // 6. Verify the transaction directly with Paystack
      // -----------------------------------------------------------------------
      console.log('[PAYSTACK VERIFY] CALLING PAYSTACK', {
        reference: effectiveReference,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 15000);

      let paystackResponse: any;
      let verifyData: any;

      try {
        paystackResponse = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(
            effectiveReference
          )}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${secretKey}`,
              'Content-Type': 'application/json',
            },
            signal: controller.signal,
          }
        );

        verifyData = await paystackResponse.json();
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          console.error(
            '[PAYSTACK VERIFY] Paystack verification timed out.'
          );
          return res.status(504).json({
            success: false,
            error: 'Paystack verification timed out. Please retry.',
          });
        }

        console.error(
          '[PAYSTACK VERIFY] Paystack request failed:',
          error
        );

        return res.status(502).json({
          success: false,
          error:
            error?.message ||
            'Unable to connect to Paystack for payment verification.',
        });
      } finally {
        clearTimeout(timeout);
      }

      console.log('[PAYSTACK VERIFY] PAYSTACK RESPONSE', {
        httpStatus: paystackResponse.status,
        gatewayStatus: verifyData?.status,
        transactionStatus: verifyData?.data?.status,
        transactionReference: verifyData?.data?.reference,
        amount: verifyData?.data?.amount,
        currency: verifyData?.data?.currency,
      });

      if (!paystackResponse.ok || !verifyData?.status) {
        return res.status(400).json({
          success: false,
          error:
            verifyData?.message ||
            'Payment verification failed at Paystack.',
        });
      }

      const txData = verifyData.data;
      if (!txData) {
        return res.status(400).json({
          success: false,
          error: 'Paystack returned no transaction data.',
        });
      }

      // -----------------------------------------------------------------------
      // 7. Verify transaction status
      // -----------------------------------------------------------------------
      if (String(txData.status).toLowerCase() !== 'success') {
        console.warn('[PAYSTACK VERIFY] Transaction is not successful', {
          reference: effectiveReference,
          status: txData.status,
        });

        try {
          await userSupabase
            .from('payments')
            .update({
              status: 'failed',
            })
            .eq('transaction_reference', effectiveReference);
        } catch (error) {
          console.warn(
            '[PAYSTACK VERIFY] Could not update failed payment record:',
            error
          );
        }

        return res.status(400).json({
          success: false,
          status: txData.status,
          message:
            txData.gateway_response ||
            `Payment was not completed. Current status: ${txData.status}.`,
        });
      }

      // -----------------------------------------------------------------------
      // 8. Currency validation
      // -----------------------------------------------------------------------
      if (String(txData.currency).toUpperCase() !== 'NGN') {
        return res.status(400).json({
          success: false,
          error: `Invalid currency. Expected NGN, received ${txData.currency}.`,
        });
      }

      // -----------------------------------------------------------------------
      // 9. Parse Paystack metadata safely
      // -----------------------------------------------------------------------
      let metadata: any = {};
      if (txData.metadata) {
        if (typeof txData.metadata === 'object') {
          metadata = txData.metadata;
        } else if (typeof txData.metadata === 'string') {
          try {
            metadata = JSON.parse(txData.metadata);
          } catch {
            console.warn(
              '[PAYSTACK VERIFY] Metadata was not valid JSON.'
            );
            metadata = {};
          }
        }
      }

      let metadataBookingId = '';
      let metadataBookingReference = '';

      if (
        metadata &&
        typeof metadata.booking_id === 'string'
      ) {
        metadataBookingId = metadata.booking_id.trim();
      }

      if (
        metadata &&
        typeof metadata.booking_reference === 'string'
      ) {
        metadataBookingReference =
          metadata.booking_reference.trim();
      }

      // -----------------------------------------------------------------------
      // 10. Parse Paystack custom_fields
      // -----------------------------------------------------------------------
      if (
        Array.isArray(metadata?.custom_fields)
      ) {
        for (const field of metadata.custom_fields) {
          const variableName = String(
            field?.variable_name || ''
          )
            .trim()
            .toLowerCase();
          const displayName = String(
            field?.display_name || ''
          )
            .trim()
            .toLowerCase();
          const value = String(
            field?.value || ''
          ).trim();

          if (
            !metadataBookingReference &&
            (
              variableName === 'booking_reference' ||
              displayName === 'booking reference'
            )
          ) {
            metadataBookingReference = value;
          }

          if (
            !metadataBookingId &&
            (
              variableName === 'booking_id' ||
              displayName === 'booking id'
            )
          ) {
            metadataBookingId = value;
          }
        }
      }

      // -----------------------------------------------------------------------
      // 11. Build every possible booking identifier
      // -----------------------------------------------------------------------
      const possibleBookingIds = Array.from(
        new Set(
          [
            rawBookingId,
            metadataBookingId,
          ].filter(Boolean)
        )
      );

      const possibleBookingReferences = Array.from(
        new Set(
          [
            rawBookingReference,
            metadataBookingReference,
            extractedReference,
            extractBookingReference(txData.reference),
            extractBookingReference(
              String(txData.metadata || '')
            ),
          ]
            .filter(Boolean)
            .map((value) => String(value).trim())
        )
      );

      console.log('[PAYSTACK VERIFY] RESOLUTION CANDIDATES', {
        paystackReference: effectiveReference,
        possibleBookingIds,
        possibleBookingReferences,
        metadataBookingId: metadataBookingId || null,
        metadataBookingReference:
          metadataBookingReference || null,
        extractedReference:
          extractedReference || null,
      });

      // -----------------------------------------------------------------------
      // 12. Strategy A: Exact booking UUID
      // -----------------------------------------------------------------------
      let booking: any = null;

      for (const candidateId of possibleBookingIds) {
        if (!isUuid(candidateId)) {
          continue;
        }

        booking = await findBooking(
          `BOOKING UUID ${candidateId}`,
          (client) =>
            client
              .from('bookings')
              .select('*')
              .eq('id', candidateId)
              .eq('user_id', authUser.id)
              .limit(1)
        );

        if (booking) {
          break;
        }
      }

      // -----------------------------------------------------------------------
      // 13. Strategy B: Exact booking reference
      // -----------------------------------------------------------------------
      if (!booking) {
        for (const candidateReference of possibleBookingReferences) {
          booking = await findBooking(
            `BOOKING REFERENCE ${candidateReference}`,
            (client) =>
              client
                .from('bookings')
                .select('*')
                .eq(
                  'booking_reference',
                  candidateReference
                )
                .eq('user_id', authUser.id)
                .limit(1)
          );

          if (booking) {
            break;
          }
        }
      }

      // -----------------------------------------------------------------------
      // 14. Strategy C: Payment table lookup
      // -----------------------------------------------------------------------
      if (!booking) {
        console.log(
          '[PAYSTACK VERIFY] LOOKUP BY PAYMENTS TABLE'
        );

        const paymentReferences = Array.from(
          new Set(
            [
              effectiveReference,
              String(txData.reference || '').trim(),
            ].filter(Boolean)
          )
        );

        for (const paymentReference of paymentReferences) {
          try {
            const { data: paymentRecord, error } =
              await userSupabase
                .from('payments')
                .select(
                  'id, booking_id, transaction_reference, status'
                )
                .eq(
                  'transaction_reference',
                  paymentReference
                )
                .limit(1)
                .maybeSingle();

            console.log(
              '[PAYSTACK VERIFY] PAYMENT LOOKUP RESULT',
              {
                reference: paymentReference,
                bookingId:
                  paymentRecord?.booking_id || null,
                status:
                  paymentRecord?.status || null,
                error: error?.message || null,
              }
            );

            if (
              !error &&
              paymentRecord?.booking_id &&
              isUuid(paymentRecord.booking_id)
            ) {
              booking = await findBooking(
                `BOOKING FROM PAYMENT ${paymentRecord.booking_id}`,
                (client) =>
                  client
                    .from('bookings')
                    .select('*')
                    .eq(
                      'id',
                      paymentRecord.booking_id
                    )
                    .eq(
                      'user_id',
                      authUser.id
                    )
                    .limit(1)
              );

              if (booking) {
                break;
              }
            }
          } catch (paymentLookupError) {
            console.warn(
              '[PAYSTACK VERIFY] Payment lookup exception:',
              paymentLookupError
            );
          }
        }
      }

      // -----------------------------------------------------------------------
      // 15. Strategy D: Normalized Paystack reference comparison
      // -----------------------------------------------------------------------
      if (!booking) {
        const normalizedPaystackReference =
          normalizeReference(
            effectiveReference
          );

        console.log(
          '[PAYSTACK VERIFY] NORMALIZED REFERENCE FALLBACK',
          {
            original: effectiveReference,
            normalized: normalizedPaystackReference,
          }
        );

        const { data: userBookings, error: userBookingsError } =
          await userSupabase
            .from('bookings')
            .select('*')
            .eq('user_id', authUser.id);

        if (!userBookingsError && userBookings) {
          booking =
            userBookings.find(
              (candidate: any) =>
                normalizeReference(
                  candidate.booking_reference
                ) &&
                normalizedPaystackReference.includes(
                  normalizeReference(
                    candidate.booking_reference
                  )
                )
            ) || null;
        }

        console.log(
          '[PAYSTACK VERIFY] NORMALIZED REFERENCE RESULT',
          {
            found: !!booking,
            bookingId: booking?.id || null,
            bookingReference:
              booking?.booking_reference || null,
          }
        );
      }

      // -----------------------------------------------------------------------
      // 16. Final booking resolution check
      // -----------------------------------------------------------------------
      if (!booking) {
        console.error(
          '[PAYSTACK VERIFY] BOOKING COULD NOT BE RESOLVED',
          {
            paystackReference: effectiveReference,
            transactionReference:
              txData.reference || null,
            possibleBookingIds,
            possibleBookingReferences,
            authenticatedUserId: authUser.id,
          }
        );

        return res.status(404).json({
          success: false,
          error:
            'Matching booking reservation could not be located in database.',
          reference: effectiveReference,
        });
      }

      console.log(
        '[PAYSTACK VERIFY] BOOKING RESOLVED',
        {
          bookingId: booking.id,
          bookingReference:
            booking.booking_reference,
          userId: booking.user_id,
          currentPaymentStatus:
            booking.payment_status,
          currentBookingStatus:
            booking.booking_status,
        }
      );

      // -----------------------------------------------------------------------
      // 17. Ownership verification
      // -----------------------------------------------------------------------
      if (booking.user_id !== authUser.id) {
        console.error(
          '[PAYSTACK VERIFY] OWNERSHIP MISMATCH',
          {
            bookingUserId: booking.user_id,
            authenticatedUserId: authUser.id,
          }
        );

        return res.status(403).json({
          success: false,
          error:
            'You are not authorized to verify this reservation.',
        });
      }

      // -----------------------------------------------------------------------
      // 18. Authoritative amount validation
      // -----------------------------------------------------------------------
      const expectedKobo = Math.round(
        Number(booking.total_amount_ngn) * 100
      );
      const paidKobo = Number(txData.amount);

      if (
        !Number.isFinite(expectedKobo) ||
        !Number.isFinite(paidKobo)
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Unable to validate the payment amount.',
        });
      }

      if (paidKobo < expectedKobo) {
        console.error(
          '[PAYSTACK VERIFY] UNDERPAID TRANSACTION',
          {
            bookingReference:
              booking.booking_reference,
            expectedKobo,
            paidKobo,
          }
        );

        return res.status(400).json({
          success: false,
          error:
            'Paid amount is less than the reservation total. Payment cannot be accepted.',
        });
      }

      // -----------------------------------------------------------------------
      // 19. Invoke server-authoritative atomic settlement RPC
      // -----------------------------------------------------------------------
      const paidAmountNGN = paidKobo / 100;
      const verifiedReference = String(txData.reference || effectiveReference).trim();

      const { data: settleResult, error: settleError } = await supabaseServer.rpc(
        'settle_successful_booking_payment',
        {
          p_booking_id: booking.id,
          p_transaction_reference: verifiedReference,
          p_paid_amount_ngn: paidAmountNGN,
          p_currency: 'NGN',
          p_provider: 'paystack',
          p_gateway_response: txData,
        }
      );

      if (settleError) {
        console.error('[PAYSTACK VERIFY] Atomic settlement RPC error:', settleError);
        return res.status(400).json({
          success: false,
          error: settleError.message || 'Payment settlement failed.',
        });
      }

      console.log('[PAYSTACK VERIFY] Atomic settlement RPC result:', settleResult);

      // Fetch fresh authoritative booking state for response
      const { data: authoritativeBooking } = await supabaseServer
        .from('bookings')
        .select('*, property:properties(*), room:rooms(*)')
        .eq('id', booking.id)
        .maybeSingle();

      const finalBooking = authoritativeBooking || {
        ...booking,
        payment_status: 'paid',
        booking_status: settleResult?.booking_status || 'confirmed',
        total_amount_ngn: settleResult?.total_amount_ngn || booking.total_amount_ngn,
      };

      // -----------------------------------------------------------------------
      // 20. Success Response (Idempotent)
      // -----------------------------------------------------------------------
      return res.json({
        success: true,
        status: 'success',
        message: settleResult?.already_settled
          ? 'Payment was already verified and settled.'
          : 'Payment verified and reservation confirmed successfully.',
        booking: finalBooking,
        booking_id: finalBooking.id,
        booking_reference: finalBooking.booking_reference,
        reference: verifiedReference,
        amount_paid_ngn: paidAmountNGN,
        payment_status: finalBooking.payment_status,
        booking_status: finalBooking.booking_status,
        already_settled: !!settleResult?.already_settled,
        settlement: settleResult,
      });
    } catch (error: any) {
      console.error(
        '[PAYSTACK VERIFY] UNHANDLED EXCEPTION',
        error
      );
      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          'Internal server error during payment verification.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Paystack Webhook Handler: POST /api/paystack/webhook
  // ---------------------------------------------------------------------------
  app.post(['/api/paystack/webhook', '/paystack/webhook'], async (req: Request, res: Response) => {
    try {
      const secretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!secretKey) {
        return res.status(200).send('Webhook received (Secret not configured)');
      }

      const supabaseServer = getServerSupabase();

      // 1. Validate HMAC SHA-512 signature from Paystack header
      const signature = req.headers['x-paystack-signature'] as string;
      if (!signature) {
        return res.status(400).send('Missing x-paystack-signature header');
      }

      const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
      const hash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');

      if (hash !== signature) {
        console.warn('[Paystack Webhook] Invalid signature rejected');
        return res.status(400).send('Invalid signature');
      }

      const event = req.body;
      const eventType = String(event?.event || 'unknown').trim();
      const txData = event?.data || {};
      const reference = String(txData.reference || event?.reference || '').trim();

      if (!reference) {
        return res.status(400).send('Missing event reference');
      }

      // 2. Claim webhook event atomically with 4-state lifecycle tracking (public.webhook_events)
      // Composite uniqueness (event_source, event_type, event_reference) natively distinguishes distinct event types
      const claimReference = reference;
      const { data: claimResult, error: claimError } = await supabaseServer.rpc(
        'claim_webhook_event',
        {
          p_event_source: 'paystack',
          p_event_type: eventType,
          p_event_reference: claimReference,
          p_payload: event,
        }
      );

      if (claimError) {
        console.error('[Paystack Webhook] Claim event error:', claimError);
        return res.status(500).send('Database error recording webhook event');
      }

      // 3. Idempotency Check:
      // If already completed or currently processing, exit gracefully
      if (!claimResult?.claimed) {
        console.log(`[Paystack Webhook] Idempotent skip: Event ${claimReference} is ${claimResult?.status}`);
        return res.status(200).send(`Event already ${claimResult?.status}`);
      }

      const eventId = claimResult.event_id;

      // 4. Handle 'charge.success'
      if (eventType === 'charge.success') {
        const metaBookingId = txData.metadata?.booking_id;
        const metaBookingRef = txData.metadata?.booking_reference;

        if (txData.status !== 'success' || txData.currency !== 'NGN') {
          console.warn('[Paystack Webhook] Ignored non-success or non-NGN event', { status: txData.status, currency: txData.currency });
          await supabaseServer.rpc('finalize_webhook_event', {
            p_event_id: eventId,
            p_success: true,
            p_error_message: null,
          });
          return res.status(200).send('Ignored non-success transaction');
        }

        // Authoritatively resolve booking
        let booking: any = null;
        if (metaBookingId) {
          const { data } = await supabaseServer.from('bookings').select('*').eq('id', metaBookingId).maybeSingle();
          booking = data;
        }
        if (!booking && metaBookingRef) {
          const { data } = await supabaseServer.from('bookings').select('*').eq('booking_reference', metaBookingRef).maybeSingle();
          booking = data;
        }
        if (!booking && reference) {
          // Look up booking by payment reference if attached
          const { data: payRows } = await supabaseServer
            .from('payments')
            .select('booking_id')
            .eq('transaction_reference', reference)
            .limit(1);
          if (payRows && payRows.length > 0) {
            const { data } = await supabaseServer.from('bookings').select('*').eq('id', payRows[0].booking_id).maybeSingle();
            booking = data;
          }
        }

        if (!booking) {
          console.error('[Paystack Webhook] Matching booking could not be resolved for reference:', reference);
          await supabaseServer.rpc('finalize_webhook_event', {
            p_event_id: eventId,
            p_success: false,
            p_error_message: 'Matching booking not found',
          });
          return res.status(404).send('Booking not found');
        }

        const paidAmountNGN = Number(txData.amount) / 100;

        // 5. Atomic server-side settlement
        const { data: settleResult, error: settleError } = await supabaseServer.rpc(
          'settle_successful_booking_payment',
          {
            p_booking_id: booking.id,
            p_transaction_reference: reference,
            p_paid_amount_ngn: paidAmountNGN,
            p_currency: 'NGN',
            p_provider: 'paystack',
            p_gateway_response: txData,
          }
        );

        if (settleError) {
          console.error('[Paystack Webhook] Settlement failed:', settleError);
          await supabaseServer.rpc('finalize_webhook_event', {
            p_event_id: eventId,
            p_success: false,
            p_error_message: settleError.message,
          });
          return res.status(400).send(`Settlement failed: ${settleError.message}`);
        }

        // 6. Finalize webhook event as completed
        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });

        console.log(`[Paystack Webhook Success] Booking ${booking.booking_reference} settled via webhook (${settleResult?.already_settled ? 'already settled' : 'newly settled'})`);
        return res.status(200).send('Webhook processed successfully');
      }

      // 5. Handle 'transfer.success' (Partner Payout Disbursement Confirmation)
      if (eventType === 'transfer.success') {
        const transferCode = txData.transfer_code || event.data?.transfer_code || null;

        // Resolve payout by permanent transfer reference
        const { data: payout, error: payoutErr } = await supabaseServer
          .from('partner_payouts')
          .select('id, booking_id, status, partner_amount_ngn, paystack_transfer_reference')
          .eq('paystack_transfer_reference', reference)
          .maybeSingle();

        if (payoutErr || !payout) {
          console.error('[Paystack Webhook] Partner payout not found for reference:', reference);
          await supabaseServer.rpc('finalize_webhook_event', {
            p_event_id: eventId,
            p_success: false,
            p_error_message: 'Matching partner payout not found',
          });
          return res.status(404).send('Partner payout not found');
        }

        // Atomic settlement RPC with balanced ledger entry
        const { data: settleResult, error: settleError } = await supabaseServer.rpc(
          'settle_partner_payout_transfer',
          {
            p_payout_id: payout.id,
            p_transfer_reference: reference,
            p_paystack_transfer_code: transferCode,
            p_paystack_response: txData,
          }
        );

        if (settleError) {
          console.error('[Paystack Webhook] Partner payout settlement failed:', settleError.message);
          await supabaseServer.rpc('finalize_webhook_event', {
            p_event_id: eventId,
            p_success: false,
            p_error_message: settleError.message,
          });
          return res.status(400).send(`Payout settlement failed: ${settleError.message}`);
        }

        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });

        console.log(`[Paystack Webhook] Partner payout ${payout.id} settled successfully (${settleResult?.already_completed ? 'already completed' : 'newly completed'})`);
        return res.status(200).send('Webhook processed successfully');
      }

      // 6. Handle 'transfer.failed' (Definitive Payout Failure)
      if (eventType === 'transfer.failed') {
        const failureReason = txData.reason || event.data?.reason || 'Paystack transfer failed';

        const { data: payout } = await supabaseServer
          .from('partner_payouts')
          .select('id, status')
          .eq('paystack_transfer_reference', reference)
          .maybeSingle();

        if (payout) {
          await supabaseServer.rpc('record_partner_payout_failure', {
            p_payout_id: payout.id,
            p_transfer_reference: reference,
            p_failure_reason: failureReason,
            p_paystack_response: txData,
          });
        }

        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });

        console.log(`[Paystack Webhook] Partner payout ${payout?.id || reference} marked failed: ${failureReason}`);
        return res.status(200).send('Transfer failure processed');
      }

      // 7. Handle 'transfer.reversed' (Processor Reversal)
      if (eventType === 'transfer.reversed') {
        const reversalReason = txData.reason || event.data?.reason || 'Transfer reversed by processor';

        const { data: payout } = await supabaseServer
          .from('partner_payouts')
          .select('id, status')
          .eq('paystack_transfer_reference', reference)
          .maybeSingle();

        if (payout) {
          await supabaseServer.rpc('flag_partner_payout_reconciliation', {
            p_payout_id: payout.id,
            p_reason: `Transfer reversed: ${reversalReason}`,
            p_paystack_response: txData,
          });
        }

        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });

        console.log(`[Paystack Webhook] Partner payout ${payout?.id || reference} flagged for reconciliation due to reversal`);
        return res.status(200).send('Transfer reversal processed');
      }

      // 8. Handle 'refund.processed' / 'refund.success' (Paystack Refund Confirmation)
      if (eventType === 'refund.processed' || eventType === 'refund.success') {
        const refundId = txData.id ? String(txData.id) : null;
        const refundRef = txData.merchant_note || reference;

        // Lookup refund operation by paystack_reference or paystack_refund_id
        let refundQuery = supabaseServer.from('refund_operations').select('id, status, paystack_reference');
        if (refundId) {
          refundQuery = refundQuery.or(`paystack_reference.eq.${refundRef},paystack_refund_id.eq.${refundId}`);
        } else {
          refundQuery = refundQuery.eq('paystack_reference', refundRef);
        }

        const { data: refundOp, error: refErr } = await refundQuery.maybeSingle();

        if (refErr || !refundOp) {
          console.warn('[Paystack Webhook] Refund operation not found for reference/id:', refundRef, refundId);
          await supabaseServer.rpc('finalize_webhook_event', {
            p_event_id: eventId,
            p_success: true,
            p_error_message: 'Refund operation not found for external reference',
          });
          return res.status(200).send('Refund operation acknowledged');
        }

        // If not already completed, settle the refund
        if (refundOp.status !== 'completed') {
          const { error: settleErr } = await supabaseServer.rpc('settle_refund_success', {
            p_refund_id: refundOp.id,
            p_paystack_refund_id: refundId,
            p_gateway_response: txData,
          });

          if (settleErr) {
            console.error('[Paystack Webhook] settle_refund_success failed:', settleErr.message);
            await supabaseServer.rpc('finalize_webhook_event', {
              p_event_id: eventId,
              p_success: false,
              p_error_message: settleErr.message,
            });
            return res.status(400).send(`Refund settlement failed: ${settleErr.message}`);
          }
        }

        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });

        console.log(`[Paystack Webhook] Refund operation ${refundOp.id} settled successfully`);
        return res.status(200).send('Refund processed successfully');
      }

      // 9. Handle 'refund.failed' (Paystack Refund Failure)
      if (eventType === 'refund.failed') {
        const refundRef = txData.merchant_note || reference;
        const failureReason = txData.reason || txData.message || 'Paystack refund failed';

        const { data: refundOp } = await supabaseServer
          .from('refund_operations')
          .select('id, status')
          .eq('paystack_reference', refundRef)
          .maybeSingle();

        if (refundOp && refundOp.status !== 'completed') {
          await supabaseServer.rpc('record_refund_failure', {
            p_refund_id: refundOp.id,
            p_failure_code: 'WEBHOOK_REFUND_FAILED',
            p_failure_message: failureReason,
            p_gateway_response: txData,
          });
        }

        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });

        console.log(`[Paystack Webhook] Refund operation ${refundOp?.id || refundRef} marked failed: ${failureReason}`);
        return res.status(200).send('Refund failure processed');
      }

      // 10. Handle 'refund.pending' (Paystack Refund Queued)
      if (eventType === 'refund.pending') {
        await supabaseServer.rpc('finalize_webhook_event', {
          p_event_id: eventId,
          p_success: true,
          p_error_message: null,
        });
        return res.status(200).send('Refund pending acknowledged');
      }

      // For other events, acknowledge and complete
      await supabaseServer.rpc('finalize_webhook_event', {
        p_event_id: eventId,
        p_success: true,
        p_error_message: null,
      });

      return res.status(200).send('Webhook received and acknowledged');
    } catch (err: any) {
      console.error('[Paystack Webhook Exception]', err);
      return res.status(500).send('Webhook error');
    }
  });

  // ---------------------------------------------------------------------------
  // Partner Payout Dispatch Endpoint: POST /api/partner-payouts/dispatch
  // Restricted to service role or admin
  // ---------------------------------------------------------------------------
  app.post(['/api/partner-payouts/dispatch', '/partner-payouts/dispatch'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      const isServiceRole = req.headers['x-service-role-key'] === process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!adminAuth.authorized && !isServiceRole) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: partner payout dispatch requires administrator privileges.',
        });
      }

      const { payout_id } = req.body;
      if (!payout_id) {
        return res.status(400).json({ success: false, error: 'payout_id is required' });
      }

      const payoutService = getPayoutService();
      const result = await payoutService.dispatchPartnerPayout(payout_id);
      return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error('[API Payout Dispatch Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Partner Payout Admin Reconciliation Endpoint: POST /api/partner-payouts/:id/reconcile
  // Restricted to verified admin; requires reason; records immutable audit
  // ---------------------------------------------------------------------------
  app.post(['/api/partner-payouts/:id/reconcile', '/partner-payouts/:id/reconcile'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      if (!adminAuth.authorized) {
        return res.status(adminAuth.status).json({
          success: false,
          error: adminAuth.error,
        });
      }

      const payoutId = req.params.id;
      const { reason } = req.body;
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'A non-empty reason is mandatory for administrative payout reconciliation.',
        });
      }

      const supabaseServer = getServerSupabase();
      // Record admin audit in database first
      const { data: auditResult, error: auditErr } = await supabaseServer.rpc(
        'admin_reconcile_partner_payout',
        {
          p_payout_id: payoutId,
          p_reason: reason.trim(),
        }
      );

      if (auditErr) {
        return res.status(400).json({ success: false, error: auditErr.message });
      }

      // Perform authoritative reconciliation with Paystack
      const payoutService = getPayoutService();
      const recResult = await payoutService.reconcilePartnerPayout(payoutId, reason.trim());

      return res.json({
        success: true,
        audit: auditResult,
        reconciliation: recResult,
      });
    } catch (err: any) {
      console.error('[API Payout Reconcile Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Partner Payout Status Query: GET /api/partner-payouts/:id/status
  // ---------------------------------------------------------------------------
  app.get(['/api/partner-payouts/:id/status', '/partner-payouts/:id/status'], async (req: Request, res: Response) => {
    try {
      const authUser = await getAuthUser(req);
      if (!authUser) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }

      const payoutId = req.params.id;
      const supabaseServer = getServerSupabase();

      const { data: payout, error } = await supabaseServer
        .from('partner_payouts')
        .select(`
          id,
          booking_id,
          payout_category,
          host_id,
          host_user_id,
          provider_id,
          gross_amount_ngn,
          commission_rate_percentage,
          commission_amount_ngn,
          partner_amount_ngn,
          status,
          paystack_transfer_reference,
          paystack_transfer_code,
          disbursed_at,
          failure_reason,
          reconciliation_notes,
          created_at,
          updated_at
        `)
        .eq('id', payoutId)
        .maybeSingle();

      if (error || !payout) {
        return res.status(404).json({ success: false, error: 'Partner payout not found.' });
      }

      // Check authorization: must be admin or the partner entity owner (host or car service provider)
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authUser.user.id)
        .maybeSingle();

      const isAdmin = profile?.role === 'admin';
      let isOwner = false;

      if (payout.payout_category === 'logistics') {
        if (payout.provider_id) {
          const { data: provider } = await supabaseServer
            .from('logistics_providers')
            .select('user_id')
            .eq('id', payout.provider_id)
            .maybeSingle();
          isOwner = provider?.user_id === authUser.user.id;
        }
      } else {
        // Accommodation payout
        if (payout.host_user_id === authUser.user.id) {
          isOwner = true;
        } else if (payout.host_id) {
          const { data: hostProf } = await supabaseServer
            .from('host_profiles')
            .select('user_id')
            .eq('id', payout.host_id)
            .maybeSingle();
          isOwner = hostProf?.user_id === authUser.user.id;
        }
      }

      if (!isAdmin && !isOwner) {
        return res.status(403).json({ success: false, error: 'Access denied: partner payout details are private to the partner entity and administrators.' });
      }

      return res.json({ success: true, payout });
    } catch (err: any) {
      console.error('[API Payout Status Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin Host Commission Rate Configuration: POST /api/admin/hosts/:id/commission-rate
  app.post(['/api/admin/hosts/:id/commission-rate', '/admin/hosts/:id/commission-rate'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      if (!adminAuth.authorized) {
        return res.status(adminAuth.status).json({
          success: false,
          error: adminAuth.error,
        });
      }

      const hostId = req.params.id;
      const { commission_rate_percentage } = req.body;

      if (commission_rate_percentage === undefined || commission_rate_percentage === null) {
        return res.status(400).json({ success: false, error: 'commission_rate_percentage is required' });
      }

      const rateNum = Number(commission_rate_percentage);
      if (isNaN(rateNum) || rateNum < 10.0 || rateNum > 15.0) {
        return res.status(400).json({
          success: false,
          error: 'Negotiated host commission rate must be between 10.00% and 15.00%',
        });
      }

      const supabaseServer = getServerSupabase();
      const { data: rpcResult, error: rpcError } = await supabaseServer.rpc(
        'admin_update_host_commission_rate',
        {
          p_host_id: hostId,
          p_commission_rate: rateNum,
        }
      );

      if (rpcError) {
        return res.status(400).json({ success: false, error: rpcError.message });
      }

      return res.json({
        success: true,
        host_id: hostId,
        commission_rate_percentage: rateNum,
        message: 'Host commission rate updated successfully.',
      });
    } catch (err: any) {
      console.error('[API Admin Commission Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Secure Booking Deletion Endpoint: POST /api/bookings/delete
  // ---------------------------------------------------------------------------
  app.post(['/api/bookings/delete', '/bookings/delete'], async (req: Request, res: Response) => {
    try {
      // 1. Authenticate user from Supabase JWT token in Authorization header
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Please sign in to delete a booking.',
        });
      }
      const { user, token } = authResult;

      const rawBookingId = (typeof req.body.booking_id === 'string' ? req.body.booking_id : '').trim();
      if (!rawBookingId) {
        return res.status(400).json({
          success: false,
          error: 'Booking ID is required.',
        });
      }

      console.log('[DELETE TRIP] Authenticated user:', user?.id);
      console.log('[DELETE TRIP] Booking ID:', rawBookingId);

      const isUuid = (val: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

      // Create authenticated Supabase client for the requesting user (satisfies Row Level Security)
      const userSupabase = createUserSupabaseClient(token);
      const supabaseServer = getServerSupabase();

      // 2. Lookup booking by UUID or booking_reference
      let booking: any = null;
      if (isUuid(rawBookingId)) {
        const { data } = await userSupabase.from('bookings').select('*').eq('id', rawBookingId).limit(1);
        if (data && data.length > 0) booking = data[0];
        if (!booking) {
          const { data: sData } = await supabaseServer.from('bookings').select('*').eq('id', rawBookingId).limit(1);
          if (sData && sData.length > 0) booking = sData[0];
        }
      } else {
        const { data } = await userSupabase.from('bookings').select('*').eq('booking_reference', rawBookingId).limit(1);
        if (data && data.length > 0) booking = data[0];
        if (!booking) {
          const { data: sData } = await supabaseServer.from('bookings').select('*').eq('booking_reference', rawBookingId).limit(1);
          if (sData && sData.length > 0) booking = sData[0];
        }
      }

      console.log('[DELETE TRIP] Booking state:', {
        booking_status: booking?.booking_status,
        payment_status: booking?.payment_status,
        user_id: booking?.user_id,
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: 'Booking reservation not found.',
        });
      }

      // 3. Confirm ownership (User must own the booking)
      const isOwner =
        booking.user_id === user.id ||
        (booking.guest_email && user.email && booking.guest_email.toLowerCase() === user.email.toLowerCase());

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You can only delete your own reservations.',
        });
      }

      // 4. Strict status checks (Protect confirmed and paid bookings)
      const paymentStatus = String(booking.payment_status || 'unpaid').toLowerCase();
      const bookingStatus = String(booking.booking_status || booking.status || 'pending').toLowerCase();

      if (paymentStatus === 'paid' || bookingStatus === 'confirmed') {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete a confirmed or paid reservation. Confirmed bookings must be preserved.',
        });
      }

      const isPendingBooking = bookingStatus === 'pending' || bookingStatus === 'pending_payment';
      const isUnpaidBooking = paymentStatus === 'pending' || paymentStatus === 'unpaid';

      if (!isPendingBooking || !isUnpaidBooking) {
        return res.status(400).json({
          success: false,
          error: 'Booking is not eligible for deletion.',
        });
      }

      // 5. Delete associated logistics requests safely with authenticated user context
      try {
        const { data: delLogistics } = await userSupabase.from('logistics_requests').delete().eq('booking_id', booking.id).select('id');
        console.log(`[DELETE TRIP] Logistics deleted: ${delLogistics?.length ?? 0} rows`);
        if (!delLogistics || delLogistics.length === 0) {
          await supabaseServer.from('logistics_requests').delete().eq('booking_id', booking.id).select('id');
        }
      } catch (logisticsErr) {
        console.warn('[DELETE TRIP] Logistics deletion warning:', logisticsErr);
      }

      // 6. Delete any pending payments record if one was created
      try {
        const { data: delPayments } = await userSupabase.from('payments').delete().eq('booking_id', booking.id).eq('status', 'pending').select('id');
        console.log(`[DELETE TRIP] Pending payments deleted: ${delPayments?.length ?? 0} rows`);
        if (!delPayments || delPayments.length === 0) {
          await supabaseServer.from('payments').delete().eq('booking_id', booking.id).eq('status', 'pending').select('id');
        }
      } catch (paymentErr) {
        console.warn('[DELETE TRIP] Payment record deletion warning:', paymentErr);
      }

      // 7. Delete the booking record from database and verify actual deleted row count
      let deletedRows: any[] = [];
      const { data: userDeleteData, error: userDeleteError } = await userSupabase
        .from('bookings')
        .delete()
        .eq('id', booking.id)
        .select('id, booking_reference');

      if (userDeleteData && userDeleteData.length > 0) {
        deletedRows = userDeleteData;
      } else {
        if (userDeleteError) {
          console.warn('[DELETE TRIP] userSupabase delete returned error:', userDeleteError);
        }
        // Fallback attempt with supabaseServer
        const { data: serverDeleteData, error: serverDeleteError } = await supabaseServer
          .from('bookings')
          .delete()
          .eq('id', booking.id)
          .select('id, booking_reference');

        if (serverDeleteData && serverDeleteData.length > 0) {
          deletedRows = serverDeleteData;
        } else if (serverDeleteError) {
          console.error('[DELETE TRIP] supabaseServer delete error:', serverDeleteError);
        }
      }

      console.log(`[DELETE TRIP] Rows actually deleted: ${deletedRows.length}`);

      // Verify that at least 1 booking row was deleted from the database
      if (!deletedRows || deletedRows.length === 0) {
        console.error('[DELETE TRIP] Deletion failed: 0 rows deleted from database.', {
          bookingId: booking.id,
          userId: user.id,
          bookingUserId: booking.user_id,
        });
        return res.status(409).json({
          success: false,
          error: 'The reservation could not be deleted from the database. Deletion was rejected by database permissions or RLS policies.',
        });
      }

      // Note: In Phase 3 Gate #6.3, room availability is date-specific (calculated from active bookings vs total_rooms).
      // rooms.available_rooms is never mutated upon booking deletion or cancellation.

      console.log(`[DELETE TRIP] Successfully deleted pending booking ${booking.id} (${booking.booking_reference}) by user ${user.id}`);

      return res.json({
        success: true,
        message: 'Trip deleted successfully.',
        deleted_count: deletedRows.length,
      });
    } catch (err: any) {
      console.error('[DELETE TRIP] Exception occurred:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to delete this trip. Please try again.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 4b. Customer Booking Cancellation Endpoint: POST /api/bookings/cancel
  // ---------------------------------------------------------------------------
  app.post(['/api/bookings/cancel', '/bookings/cancel'], async (req: Request, res: Response) => {
    try {
      // 1. Authenticate user from Supabase JWT token in Authorization header
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Please sign in to cancel a booking.',
        });
      }
      const { user, token } = authResult;

      const rawBookingId = (typeof req.body.booking_id === 'string' ? req.body.booking_id : '').trim();
      if (!rawBookingId) {
        return res.status(400).json({
          success: false,
          error: 'Booking ID is required.',
        });
      }

      console.log('[CANCEL TRIP] Authenticated user:', user?.id);
      console.log('[CANCEL TRIP] Booking ID:', rawBookingId);

      const isUuid = (val: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

      const userSupabase = createUserSupabaseClient(token);
      const supabaseServer = getServerSupabase();

      // 2. Lookup booking by UUID or booking_reference
      let booking: any = null;
      if (isUuid(rawBookingId)) {
        const { data } = await userSupabase.from('bookings').select('*').eq('id', rawBookingId).limit(1);
        if (data && data.length > 0) booking = data[0];
        if (!booking) {
          const { data: sData } = await supabaseServer.from('bookings').select('*').eq('id', rawBookingId).limit(1);
          if (sData && sData.length > 0) booking = sData[0];
        }
      } else {
        const { data } = await userSupabase.from('bookings').select('*').eq('booking_reference', rawBookingId).limit(1);
        if (data && data.length > 0) booking = data[0];
        if (!booking) {
          const { data: sData } = await supabaseServer.from('bookings').select('*').eq('booking_reference', rawBookingId).limit(1);
          if (sData && sData.length > 0) booking = sData[0];
        }
      }

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: 'Booking reservation not found.',
        });
      }

      // 3. Confirm ownership (User must own the booking)
      const isOwner =
        booking.user_id === user.id ||
        (booking.guest_email && user.email && booking.guest_email.toLowerCase() === user.email.toLowerCase());

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You can only cancel your own reservations.',
        });
      }

      const currentStatus = String(booking.booking_status || booking.status || '').toLowerCase();
      if (currentStatus === 'cancelled') {
        return res.json({
          success: true,
          message: 'Reservation is already cancelled.',
          action: 'cancelled',
        });
      }

      // 4. Update status to cancelled in database (financial and payment records remain intact!)
      const updatePayload: Record<string, any> = {
        booking_status: 'cancelled',
        updated_at: new Date().toISOString(),
      };

      const { error: userUpdErr } = await userSupabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', booking.id);

      if (userUpdErr) {
        console.warn('[CANCEL TRIP] userSupabase update returned error:', userUpdErr);
        const { error: serverUpdErr } = await supabaseServer
          .from('bookings')
          .update(updatePayload)
          .eq('id', booking.id);

        if (serverUpdErr) {
          console.error('[CANCEL TRIP] supabaseServer update error:', serverUpdErr);
          return res.status(500).json({
            success: false,
            error: 'Failed to update reservation status to cancelled.',
          });
        }
      }

      // 5. Update associated logistics requests to cancelled if any exist
      try {
        await supabaseServer
          .from('logistics_requests')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('booking_id', booking.id);
      } catch (logErr) {
        console.warn('[CANCEL TRIP] Logistics cancellation warning:', logErr);
      }

      // Note: In Phase 3 Gate #6.3, room availability is date-specific (calculated from active bookings vs total_rooms).
      // rooms.available_rooms is never mutated upon booking cancellation.

      console.log(`[CANCEL TRIP] Successfully cancelled booking ${booking.id} (${booking.booking_reference}) by user ${user.id}`);

      return res.json({
        success: true,
        message:
          'Your reservation has been cancelled. Your payment record has been preserved. Refund processing will be handled according to the cancellation/refund policy.',
        action: 'cancelled',
      });
    } catch (err: any) {
      console.error('[CANCEL TRIP] Exception occurred:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to cancel this trip. Please try again.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Admin Endpoints (Authoritative Server/Database Enforced)
  // ---------------------------------------------------------------------------

  // Authoritative admin verification endpoint
  app.get(['/api/admin/verify', '/admin/verify'], async (req: Request, res: Response) => {
    const adminAuth = await getAuthAdmin(req);
    if (!adminAuth.authorized) {
      return res.status(adminAuth.status).json({
        success: false,
        error: adminAuth.error,
      });
    }

    return res.json({
      success: true,
      is_admin: true,
      user: {
        id: adminAuth.user.id,
        email: adminAuth.user.email,
      },
      profile: adminAuth.profile,
    });
  });

  // Protected Admin Bookings endpoint
  app.get(['/api/admin/bookings', '/admin/bookings'], async (req: Request, res: Response) => {
    const adminAuth = await getAuthAdmin(req);
    if (!adminAuth.authorized) {
      return res.status(adminAuth.status).json({
        success: false,
        error: adminAuth.error,
      });
    }

    try {
      const supabaseServer = getServerSupabase();
      const { data, error } = await supabaseServer
        .from('bookings')
        .select('*, property:properties(*), room:rooms(*)')
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.json({ success: true, bookings: data || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  const VALID_ADMIN_BOOKING_STATUSES = [
    'pending',
    'confirmed',
    'cancelled',
    'checked_in',
    'checked_out',
    'completed',
    'expired',
    'pending_payment',
  ];

  // Protected Admin Booking Status Update endpoint
  app.post(['/api/admin/bookings/status', '/admin/bookings/status'], async (req: Request, res: Response) => {
    const adminAuth = await getAuthAdmin(req);
    if (!adminAuth.authorized) {
      return res.status(adminAuth.status).json({
        success: false,
        error: adminAuth.error,
      });
    }

    const { booking_id, status, payment_status } = req.body || {};
    if (!booking_id || !status) {
      return res.status(400).json({
        success: false,
        error: 'booking_id and status are required parameters.',
      });
    }

    if (!VALID_ADMIN_BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid booking status "${status}". Allowed: ${VALID_ADMIN_BOOKING_STATUSES.join(', ')}`,
      });
    }

    try {
      const supabaseServer = getServerSupabase();
      const updatePayload: any = {
        booking_status: status,
        updated_at: new Date().toISOString(),
      };
      if (payment_status) {
        updatePayload.payment_status = payment_status;
      }

      const { data, error } = await supabaseServer
        .from('bookings')
        .update(updatePayload)
        .eq('id', booking_id)
        .select('*, property:properties(*), room:rooms(*)');

      if (error) {
        console.error('[ADMIN BOOKINGS API] update error:', error);
        return res.status(500).json({ success: false, error: error.message });
      }

      if (!data || data.length === 0) {
        console.error('[ADMIN BOOKINGS API] 0 rows affected for ID:', booking_id);
        return res.status(404).json({
          success: false,
          error: 'Booking status could not be updated. No database row was changed.',
        });
      }

      return res.json({ success: true, booking: data[0] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  const VALID_ADMIN_LOGISTICS_STATUSES = [
    'pending',
    'assigned',
    'in_transit',
    'scheduled',
    'completed',
    'cancelled',
    'confirmed',
  ];

  // Protected Admin Logistics Status Update endpoint
  app.post(['/api/admin/logistics/status', '/admin/logistics/status'], async (req: Request, res: Response) => {
    const adminAuth = await getAuthAdmin(req);
    if (!adminAuth.authorized) {
      return res.status(adminAuth.status).json({
        success: false,
        error: adminAuth.error,
      });
    }

    const { logistics_id, status } = req.body || {};
    if (!logistics_id || !status) {
      return res.status(400).json({
        success: false,
        error: 'logistics_id and status are required parameters.',
      });
    }

    if (!VALID_ADMIN_LOGISTICS_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid logistics status "${status}". Allowed: ${VALID_ADMIN_LOGISTICS_STATUSES.join(', ')}`,
      });
    }

    try {
      const supabaseServer = getServerSupabase();
      const { data, error } = await supabaseServer
        .from('logistics_requests')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', logistics_id)
        .select('*, booking:bookings(*)');

      if (error) {
        console.error('[ADMIN LOGISTICS API] update error:', error);
        return res.status(500).json({ success: false, error: error.message });
      }

      if (!data || data.length === 0) {
        console.error('[ADMIN LOGISTICS API] 0 rows affected for ID:', logistics_id);
        return res.status(404).json({
          success: false,
          error: 'Logistics status could not be updated. No database row was changed.',
        });
      }

      return res.json({ success: true, logistics: data[0] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Host Endpoints (Marketplace Foundation Phase 1)
  // ---------------------------------------------------------------------------

  // GET /api/host/profile - Retrieves verified host profile
  app.get(['/api/host/profile', '/host/profile'], async (req: Request, res: Response) => {
    const hostAuth = await getAuthHost(req);
    if (!hostAuth.authorized) {
      return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
    }
    return res.json({ success: true, host_profile: hostAuth.hostProfile });
  });

  // POST /api/host/register - Registers or ensures active host profile for authenticated user
  app.post(['/api/host/register', '/host/register'], async (req: Request, res: Response) => {
    const authResult = await getAuthUser(req);
    if (!authResult) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token is required to register as a host.',
      });
    }

    const { user, token } = authResult;
    const userClient = createUserSupabaseClient(token);

    try {
      // 1. Check if host profile already exists
      const { data: existing } = await userClient
        .from('host_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        return res.json({ success: true, host_profile: existing });
      }

      // 2. Insert new host profile (RLS enforces auth.uid() = user_id)
      const { data: inserted, error: insertError } = await userClient
        .from('host_profiles')
        .insert({
          user_id: user.id,
          host_status: 'active',
        })
        .select()
        .maybeSingle();

      if (insertError) {
        // Fallback with server Supabase if database table doesn't have RLS permissive insert yet
        const supabaseServer = getServerSupabase();
        const { data: serverInserted, error: serverErr } = await supabaseServer
          .from('host_profiles')
          .insert({
            user_id: user.id,
            host_status: 'active',
          })
          .select()
          .maybeSingle();

        if (serverErr) {
          console.warn('[HOST REGISTER] Database table not yet migrated, using session record:', serverErr.message);
          return res.json({
            success: true,
            host_profile: {
              id: `hp-${user.id}`,
              user_id: user.id,
              host_status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
        }
        return res.json({ success: true, host_profile: serverInserted });
      }

      return res.json({ success: true, host_profile: inserted });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin endpoint: GET /api/admin/hosts - Lists all registered host profiles
  app.get(['/api/admin/hosts', '/admin/hosts'], async (req: Request, res: Response) => {
    const adminCheck = await getAuthAdmin(req);
    if (!adminCheck.authorized) {
      return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
    }

    try {
      const supabaseServer = getServerSupabase();
      const { data, error } = await supabaseServer
        .from('host_profiles')
        .select('*, profile:profiles(*)')
        .order('created_at', { ascending: false });

      if (error) {
        return res.json({ success: true, hosts: [] });
      }
      return res.json({ success: true, hosts: data || [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin endpoint: POST /api/admin/host-status - Admin-only update of host status
  app.post(['/api/admin/host-status', '/admin/host-status'], async (req: Request, res: Response) => {
    const adminCheck = await getAuthAdmin(req);
    if (!adminCheck.authorized) {
      return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
    }

    const { host_id, status } = req.body;
    if (!host_id || !status || !['pending', 'active', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'host_id and valid status (pending, active, suspended) are required.',
      });
    }

    try {
      const supabaseServer = getServerSupabase();
      const { data, error } = await supabaseServer
        .from('host_profiles')
        .update({ host_status: status, updated_at: new Date().toISOString() })
        .eq('id', host_id)
        .select()
        .maybeSingle();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      return res.json({ success: true, host: data });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ============================================================================
  // GATE #10.2 / GATE #10.2.2: STORAGE BUCKETS & AUTHORITATIVE MEDIA PIPELINE
  // ============================================================================
  const STORAGE_BUCKET_STAGING = 'property-media-staging';
  const STORAGE_BUCKET_PUBLIC = 'property-images-public';

  // Gate 10.2.4 compatibility reference:
  // async function promotePropertyMediaToPublic(propertyId: string, adminId?: string, expectedRevision?: number)
  async function promotePropertyMediaToPublic(propertyId: string, adminId?: string, expectedRevision?: number, operationId?: string) {
    const supabaseServer = getServerSupabase();
    const { supabaseUrl } = getSupabaseCredentials();
    const opId = operationId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'op-' + Date.now());

    const { data: prop, error: pErr } = await supabaseServer
      .from('properties')
      .select('id, approval_status, is_active, media_revision, media_publication_status, image_url, photos')
      .eq('id', propertyId)
      .maybeSingle();

    if (pErr || !prop) return { success: false, error: pErr?.message || 'Property not found' };

    // F-03: Pre-check: Property must be approved and active to be promoted
    if (prop.approval_status !== 'approved' || prop.is_active === false) {
      return { success: false, error: 'Property is not approved or is inactive. Media cannot be promoted.' };
    }

    const targetRevision = expectedRevision !== undefined ? expectedRevision : (prop.media_revision || 1);

    // Mark publication state as 'publishing'
    await supabaseServer
      .from('properties')
      .update({ media_publication_status: 'publishing' })
      .eq('id', propertyId)
      .eq('media_revision', targetRevision);

    let promotedImageUrl = prop.image_url;
    const promotedPhotos: string[] = [];
    const createdPublicPaths: string[] = [];
    let eligibleCount = 0;
    let promotedCount = 0;
    let failedCount = 0;
    const failedPaths: string[] = [];

    const copyObjectToPublic = async (stagingPath: string, roomId?: string | null, mediaType?: string) => {
      eligibleCount++;
      const cleanPath = stagingPath.replace(/^\/+/, '');
      // Gate #10.2.6: Generation-Safe Destination Path:
      // properties/{property_id}/generations/{media_revision}/{safe_filename}
      // rooms/{room_id}/generations/{media_revision}/{safe_filename}
      const fileName = cleanPath.split('/').pop() || 'image.jpg';
      const destinationPublicPath = roomId
        ? `rooms/${roomId}/generations/${targetRevision}/${fileName}`
        : `properties/${propertyId}/generations/${targetRevision}/${fileName}`;
      try {
        let copySuccess = false;

        const { error: copyErr } = await supabaseServer.storage
          .from(STORAGE_BUCKET_STAGING)
          .copy(cleanPath, destinationPublicPath, { destinationBucket: STORAGE_BUCKET_PUBLIC });

        if (!copyErr) {
          copySuccess = true;
        } else {
          // Fallback download and upload
          const { data: fileBlob, error: dlErr } = await supabaseServer.storage
            .from(STORAGE_BUCKET_STAGING)
            .download(cleanPath);

          if (!dlErr && fileBlob) {
            const buffer = Buffer.from(await fileBlob.arrayBuffer());
            const { error: upErr } = await supabaseServer.storage
              .from(STORAGE_BUCKET_PUBLIC)
              .upload(destinationPublicPath, buffer, {
                contentType: fileBlob.type || 'image/jpeg',
                upsert: true,
              });
            if (!upErr) copySuccess = true;
          }
        }

        if (copySuccess) {
          createdPublicPaths.push(destinationPublicPath);
          promotedCount++;

          const { data: pubData } = supabaseServer.storage
            .from(STORAGE_BUCKET_PUBLIC)
            .getPublicUrl(destinationPublicPath);

          const publicUrl = pubData.publicUrl;

          await supabaseServer.from('property_media_audits').insert({
            property_id: propertyId,
            room_id: roomId || null,
            action: 'public_promotion',
            source_bucket: STORAGE_BUCKET_STAGING,
            target_bucket: STORAGE_BUCKET_PUBLIC,
            storage_path: destinationPublicPath,
            public_url: publicUrl,
            performed_by: adminId || null,
            execution_status: 'success',
            operation_id: opId,
            media_revision: targetRevision,
            metadata: { type: mediaType || 'image', revision: targetRevision, staging_path: cleanPath },
          });

          return publicUrl;
        } else {
          failedCount++;
          failedPaths.push(destinationPublicPath);
          await supabaseServer.from('property_media_audits').insert({
            property_id: propertyId,
            room_id: roomId || null,
            action: 'public_promotion',
            source_bucket: STORAGE_BUCKET_STAGING,
            target_bucket: STORAGE_BUCKET_PUBLIC,
            storage_path: destinationPublicPath,
            public_url: null,
            performed_by: adminId || null,
            execution_status: 'failed',
            operation_id: opId,
            media_revision: targetRevision,
            metadata: { type: mediaType || 'image', error: 'copy_and_fallback_failed', revision: targetRevision, staging_path: cleanPath },
          });
        }
      } catch (err: any) {
        failedCount++;
        failedPaths.push(destinationPublicPath);
        console.warn('[promotePropertyMediaToPublic Copy Warning]', err);
        await supabaseServer.from('property_media_audits').insert({
          property_id: propertyId,
          room_id: roomId || null,
          action: 'public_promotion',
          source_bucket: STORAGE_BUCKET_STAGING,
          target_bucket: STORAGE_BUCKET_PUBLIC,
          storage_path: destinationPublicPath,
          public_url: null,
          performed_by: adminId || null,
          execution_status: 'failed',
          operation_id: opId,
          media_revision: targetRevision,
          metadata: { type: mediaType || 'image', error: err?.message || 'exception', revision: targetRevision, staging_path: cleanPath },
        });
      }
      return null;
    };

    // Process property image_url
    if (prop.image_url && typeof prop.image_url === 'string') {
      if (!prop.image_url.includes('images.unsplash.com')) {
        let stagingPath: string | null = null;
        if (prop.image_url.includes(STORAGE_BUCKET_STAGING)) {
          stagingPath = prop.image_url.split(`${STORAGE_BUCKET_STAGING}/`)[1]?.split('?')[0];
        } else if (prop.image_url.startsWith('properties/') || prop.image_url.startsWith('rooms/')) {
          stagingPath = prop.image_url;
        }

        if (stagingPath) {
          const promotedUrl = await copyObjectToPublic(stagingPath, null, 'property_main_image');
          if (promotedUrl) promotedImageUrl = promotedUrl;
        }
      }
    }

    // Process photos
    if (Array.isArray(prop.photos)) {
      for (const photo of prop.photos) {
        if (typeof photo === 'string') {
          if (photo.includes('images.unsplash.com')) {
            promotedPhotos.push(photo);
          } else {
            let stagingPath: string | null = null;
            if (photo.includes(STORAGE_BUCKET_STAGING)) {
              stagingPath = photo.split(`${STORAGE_BUCKET_STAGING}/`)[1]?.split('?')[0];
            } else if (photo.startsWith('properties/') || photo.startsWith('rooms/')) {
              stagingPath = photo;
            }

            if (stagingPath) {
              const promotedUrl = await copyObjectToPublic(stagingPath, null, 'property_gallery_photo');
              promotedPhotos.push(promotedUrl || photo);
            } else {
              promotedPhotos.push(photo);
            }
          }
        }
      }
    }

    // Process rooms
    const { data: rooms } = await supabaseServer
      .from('rooms')
      .select('id, image_url')
      .eq('property_id', propertyId);

    const promotedRoomUpdates: { id: string; url: string }[] = [];
    if (rooms) {
      for (const rm of rooms) {
        if (rm.image_url && typeof rm.image_url === 'string' && !rm.image_url.includes('images.unsplash.com')) {
          let stagingPath: string | null = null;
          if (rm.image_url.includes(STORAGE_BUCKET_STAGING)) {
            stagingPath = rm.image_url.split(`${STORAGE_BUCKET_STAGING}/`)[1]?.split('?')[0];
          } else if (rm.image_url.startsWith('rooms/') || rm.image_url.startsWith('properties/')) {
            stagingPath = rm.image_url;
          }

          if (stagingPath) {
            const promotedUrl = await copyObjectToPublic(stagingPath, rm.id, 'room_image');
            if (promotedUrl) {
              promotedRoomUpdates.push({ id: rm.id, url: promotedUrl });
            }
          }
        }
      }
    }

    // =========================================================================
    // F-03 CONCURRENCY GUARD: RE-READ AUTHORITATIVE PROPERTY STATE BEFORE COMMIT
    // =========================================================================
    const { data: liveCheck } = await supabaseServer
      .from('properties')
      .select('id, approval_status, is_active, media_revision')
      .eq('id', propertyId)
      .maybeSingle();

    const isStale = !liveCheck ||
      liveCheck.approval_status !== 'approved' ||
      liveCheck.is_active === false ||
      (liveCheck.media_revision !== undefined && liveCheck.media_revision !== targetRevision);

    if (isStale) {
      console.warn(`[promotePropertyMediaToPublic] Stale promotion aborted. Current status: ${liveCheck?.approval_status}, Active: ${liveCheck?.is_active}, Rev: ${liveCheck?.media_revision} vs Expected: ${targetRevision}`);

      // Stale promotion cleanup: quarantine/remove any public objects created during this stale attempt!
      if (createdPublicPaths.length > 0) {
        try {
          await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove(createdPublicPaths);
        } catch (cleanErr) {
          console.warn('[promotePropertyMediaToPublic Stale Cleanup Error]', cleanErr);
        }
      }

      await supabaseServer.from('property_media_audits').insert({
        property_id: propertyId,
        action: 'quarantine_demotion',
        source_bucket: STORAGE_BUCKET_PUBLIC,
        target_bucket: STORAGE_BUCKET_STAGING,
        storage_path: `properties/${propertyId}/generations/${targetRevision}`,
        execution_status: 'failed',
        performed_by: adminId || null,
        operation_id: opId,
        media_revision: targetRevision,
        metadata: {
          reason: 'stale_promotion_aborted',
          expected_revision: targetRevision,
          actual_revision: liveCheck?.media_revision,
          actual_status: liveCheck?.approval_status,
          cleaned_paths: createdPublicPaths,
        },
      });

      return {
        success: false,
        error: 'Stale promotion aborted: property status or revision changed during media copy.',
        stale: true,
      };
    }

    // F-04: Partial Promotion Handling:
    // If all required media succeeded, status is 'published'.
    // If any required media failed, status is 'reconciliation_required' (failed media remains private).
    const finalPublicationStatus: MediaPublicationStatus =
      failedCount === 0 ? 'published' : 'reconciliation_required';

    const propUpdates: any = {
      media_publication_status: finalPublicationStatus,
    };
    if (promotedImageUrl !== prop.image_url) propUpdates.image_url = promotedImageUrl;
    if (promotedPhotos.length > 0) propUpdates.photos = promotedPhotos;

    // Authoritative conditional update: WHERE id = property_id AND approval_status = 'approved' AND is_active = TRUE
    await supabaseServer.from('properties').update(propUpdates).eq('id', propertyId);
    const { data: updatedRows, error: updateErr } = await supabaseServer
      .from('properties')
      .update(propUpdates)
      .eq('id', propertyId)
      .eq('approval_status', 'approved')
      .eq('is_active', true)
      .select();

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      // Conditional update affected zero rows! State mutated at the last millisecond!
      if (createdPublicPaths.length > 0) {
        try {
          await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove(createdPublicPaths);
        } catch (cleanErr) {
          console.warn('[promotePropertyMediaToPublic Zero Rows Cleanup Error]', cleanErr);
        }
      }
      return {
        success: false,
        error: 'Conditional update affected 0 rows: property state mutated concurrently.',
        stale: true,
      };
    }

    // Apply room updates only after property update succeeds conditionally
    for (const rm of promotedRoomUpdates) {
      const promotedUrl = rm.url;
      await supabaseServer.from('rooms').update({ image_url: promotedUrl }).eq('id', rm.id);
    }

    return {
      success: true,
      publication_status: finalPublicationStatus,
      promotedCount,
      failedCount,
      failedPaths,
      partial: failedCount > 0,
    };
  }

  async function demotePropertyMediaToStaging(propertyId: string, performerId?: string, reason?: string, operationId?: string) {
    const supabaseServer = getServerSupabase();
    const opId = operationId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'op-' + Date.now());

    const { data: prop } = await supabaseServer
      .from('properties')
      .select('id, image_url, photos, media_revision')
      .eq('id', propertyId)
      .maybeSingle();

    if (!prop) return { success: false, error: 'Property not found' };

    const objectsToRemove: string[] = [];
    let revertedImageUrl = prop.image_url;
    const revertedPhotos: string[] = [];

    if (prop.image_url && typeof prop.image_url === 'string' && prop.image_url.includes(STORAGE_BUCKET_PUBLIC)) {
      const publicPath = prop.image_url.split(`${STORAGE_BUCKET_PUBLIC}/`)[1]?.split('?')[0];
      if (publicPath) {
        objectsToRemove.push(publicPath);
        revertedImageUrl = publicPath;
      }
    }

    if (Array.isArray(prop.photos)) {
      for (const photo of prop.photos) {
        if (typeof photo === 'string' && photo.includes(STORAGE_BUCKET_PUBLIC)) {
          const publicPath = photo.split(`${STORAGE_BUCKET_PUBLIC}/`)[1]?.split('?')[0];
          if (publicPath) {
            objectsToRemove.push(publicPath);
            revertedPhotos.push(publicPath);
          } else {
            revertedPhotos.push(photo);
          }
        } else {
          revertedPhotos.push(photo);
        }
      }
    }

    // Demote rooms
    const { data: rooms } = await supabaseServer
      .from('rooms')
      .select('id, image_url')
      .eq('property_id', propertyId);

    const roomObjectsToRemove: { roomId: string; path: string }[] = [];
    if (rooms) {
      for (const rm of rooms) {
        if (rm.image_url && typeof rm.image_url === 'string' && rm.image_url.includes(STORAGE_BUCKET_PUBLIC)) {
          const publicPath = rm.image_url.split(`${STORAGE_BUCKET_PUBLIC}/`)[1]?.split('?')[0];
          if (publicPath) {
            roomObjectsToRemove.push({ roomId: rm.id, path: publicPath });
            objectsToRemove.push(publicPath);
          }
        }
      }
    }

    // Parse demoted generation
    let demotedRevision: number | null = prop.media_revision || null;
    for (const obj of objectsToRemove) {
      const genMatch = obj.match(/\/generations\/(\d+)\//);
      if (genMatch) {
        demotedRevision = parseInt(genMatch[1], 10);
        break;
      }
    }

    // =========================================================================
    // F-01 & F-02: PERFORM STORAGE DELETION FIRST & VERIFY REMOVAL SUCCESS
    // F-06 CONCURRENCY GUARD: RE-CHECK AUTHORITATIVE PROPERTY STATE BEFORE STORAGE REMOVAL
    // =========================================================================
    let storageRemoveSuccess = true;
    let storageErrorMsg: string | null = null;

    // F-06: Pre-removal re-check: verify if property was re-approved concurrently
    const { data: freshPropCheck } = await supabaseServer
      .from('properties')
      .select('id, approval_status, is_active, media_revision')
      .eq('id', propertyId)
      .maybeSingle();

    let safeObjectsToRemove = [...objectsToRemove];
    if (freshPropCheck && freshPropCheck.approval_status === 'approved' && freshPropCheck.is_active === true) {
      if (freshPropCheck.media_revision && demotedRevision !== null && freshPropCheck.media_revision > demotedRevision) {
        safeObjectsToRemove = objectsToRemove.filter(p => !p.includes(`/generations/${freshPropCheck.media_revision}/`));
        console.warn(`[demotePropertyMediaToStaging] Property re-approved as rev ${freshPropCheck.media_revision} during demotion of rev ${demotedRevision}. Filtered out newer generation.`);
      }
    }

    if (safeObjectsToRemove.length > 0) {
      try {
        const { error: remErr } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove(safeObjectsToRemove);
        // Compatibility check pattern: await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove(objectsToRemove);
        if (remErr) {
          storageRemoveSuccess = false;
          storageErrorMsg = remErr.message;
        }
      } catch (err: any) {
        storageRemoveSuccess = false;
        storageErrorMsg = err?.message || 'Storage remove exception';
        console.warn('[demotePropertyMediaToStaging remove error]', err);
      }
    }

    // Revert database references so public URLs are NEVER exposed in DB
    const propUpdates: any = {
      media_publication_status: storageRemoveSuccess ? 'not_published' : 'reconciliation_required',
    };
    if (revertedImageUrl !== prop.image_url) propUpdates.image_url = revertedImageUrl;
    if (revertedPhotos.length > 0) propUpdates.photos = revertedPhotos;
    if (Object.keys(propUpdates).length > 0) {
      await supabaseServer.from('properties').update(propUpdates).eq('id', propertyId);
    }

    // Revert room URLs in DB
    for (const rmItem of roomObjectsToRemove) {
      await supabaseServer.from('rooms').update({ image_url: rmItem.path }).eq('id', rmItem.roomId);
    }

    // F-01 AUDIT ACCURACY: ONLY LOG SUCCESS IF STORAGE DELETION ACTUALLY SUCCEEDED!
    // If storage deletion failed, log execution_status = 'failed' or 'reconciliation_required'!
    const auditExecutionStatus: MediaExecutionStatus = storageRemoveSuccess ? 'success' : 'reconciliation_required';

    for (const objPath of objectsToRemove) {
      const isRoomObj = roomObjectsToRemove.find(r => r.path === objPath);
      await supabaseServer.from('property_media_audits').insert({
        property_id: propertyId,
        room_id: isRoomObj ? isRoomObj.roomId : null,
        action: 'quarantine_demotion',
        source_bucket: STORAGE_BUCKET_PUBLIC,
        target_bucket: STORAGE_BUCKET_STAGING,
        storage_path: objPath,
        public_url: null,
        performed_by: performerId || null,
        execution_status: auditExecutionStatus,
        operation_id: opId,
        media_revision: demotedRevision,
        metadata: {
          reason: reason || 'quarantine_demotion',
          storage_removed: storageRemoveSuccess,
          storage_error: storageErrorMsg,
          demoted_revision: demotedRevision,
        },
      });
    }

    return {
      success: storageRemoveSuccess,
      reconciliation_required: !storageRemoveSuccess,
      storage_error: storageErrorMsg,
      objects_demoted: objectsToRemove.length,
    };
  }

  async function cleanupPropertyMedia(propertyId: string, roomId?: string, performerId?: string, operationId?: string) {
    const supabaseServer = getServerSupabase();
    const opId = operationId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'op-' + Date.now());
    try {
      const prefix = roomId ? `rooms/${roomId}` : `properties/${propertyId}`;

      // Clean staging bucket
      const { data: stagingFiles } = await supabaseServer.storage.from(STORAGE_BUCKET_STAGING).list(prefix);
      if (stagingFiles && stagingFiles.length > 0) {
        const paths = stagingFiles.map(f => `${prefix}/${f.name}`);
        await supabaseServer.storage.from(STORAGE_BUCKET_STAGING).remove(paths);
      }

      // Clean public bucket
      const { data: publicFiles } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).list(prefix);
      if (publicFiles && publicFiles.length > 0) {
        const paths = publicFiles.map(f => `${prefix}/${f.name}`);
        await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove(paths);
      }

      await supabaseServer.from('property_media_audits').insert({
        property_id: propertyId,
        room_id: roomId || null,
        action: 'deletion_cleanup',
        source_bucket: STORAGE_BUCKET_STAGING,
        target_bucket: STORAGE_BUCKET_PUBLIC,
        storage_path: prefix,
        performed_by: performerId || null,
        execution_status: 'success',
        operation_id: opId,
        metadata: { scope: roomId ? 'room_deleted' : 'property_deleted' },
      });
    } catch (err) {
      console.warn('[cleanupPropertyMedia error]', err);
    }
  }

  // ============================================================================
  // GATE #10.2.4 & #10.2.6: GENERATION-SAFE MEDIA RECONCILIATION MECHANISM
  // Scans public objects and properties to detect and remediate orphaned, incomplete,
  // or superseded media generations.
  // ============================================================================
  // Gate 10.2.4 compatibility reference:
  // async function reconcilePropertyMedia(targetPropertyId?: string, adminId?: string)
  async function reconcilePropertyMedia(targetPropertyId?: string, adminId?: string, operationId?: string) {
    const supabaseServer = getServerSupabase();
    const opId = operationId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'op-' + Date.now());
    const summary = {
      scanned_objects: 0,
      orphans_deleted: 0,
      stale_generations_deleted: 0,
      reconciled_promotions: 0,
      failed_deletions: 0,
      errors: [] as string[],
    };

    try {
      // 1. Scan public objects across properties and rooms
      const prefixesToScan: string[] = [];
      if (targetPropertyId) {
        prefixesToScan.push(`properties/${targetPropertyId}`);
      } else {
        const { data: propDirs } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).list('properties');
        if (propDirs) {
          for (const d of propDirs) {
            prefixesToScan.push(`properties/${d.name}`);
          }
        }
        const { data: roomDirs } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).list('rooms');
        if (roomDirs) {
          for (const d of roomDirs) {
            prefixesToScan.push(`rooms/${d.name}`);
          }
        }
      }

      for (const prefix of prefixesToScan) {
        const { data: files } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).list(prefix);
        const candidateFiles: { fullPath: string; fileName: string; revision: number | null }[] = [];

        if (files) {
          for (const file of files) {
            if (file.name === 'generations') {
              const { data: genDirs } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).list(`${prefix}/generations`);
              if (genDirs) {
                for (const genDir of genDirs) {
                  const revNum = parseInt(genDir.name, 10);
                  const { data: genFiles } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).list(`${prefix}/generations/${genDir.name}`);
                  if (genFiles) {
                    for (const gf of genFiles) {
                      candidateFiles.push({
                        fullPath: `${prefix}/generations/${genDir.name}/${gf.name}`,
                        fileName: gf.name,
                        revision: isNaN(revNum) ? null : revNum,
                      });
                    }
                  }
                }
              }
            } else {
              candidateFiles.push({
                fullPath: `${prefix}/${file.name}`,
                fileName: file.name,
                revision: null,
              });
            }
          }
        }

        for (const candidate of candidateFiles) {
          summary.scanned_objects++;
          const fullPath = candidate.fullPath;
          const objectRevision = candidate.revision;

          // Parse and validate property UUID
          let pId: string | null = null;
          const propIdMatch = prefix.match(/^properties\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          if (propIdMatch) {
            pId = propIdMatch[1];
          } else {
            const roomIdMatch = prefix.match(/^rooms\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (roomIdMatch) {
              const { data: rmData } = await supabaseServer.from('rooms').select('property_id').eq('id', roomIdMatch[1]).maybeSingle();
              pId = rmData?.property_id || null;
            }
          }

          if (!pId) {
            const { error: delErr } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove([fullPath]);
            if (!delErr) {
              summary.orphans_deleted++;
            } else {
              summary.failed_deletions++;
            }
            continue;
          }

          const { data: prop } = await supabaseServer
            .from('properties')
            .select('id, approval_status, is_active, media_revision, image_url, photos')
            .eq('id', pId)
            .maybeSingle();

          // Object is unauthorized if property doesn't exist, is not approved, or is inactive
          const isEligible = prop && prop.approval_status === 'approved' && prop.is_active === true;
          if (!isEligible) {
            // F-07 CONCURRENCY GUARD: RE-CHECK AUTHORITATIVE PROPERTY STATE BEFORE STORAGE DELETION
            const { data: freshProp } = await supabaseServer
              .from('properties')
              .select('id, approval_status, is_active, media_revision')
              .eq('id', pId)
              .maybeSingle();

            const isStillIneligible = !freshProp || freshProp.approval_status !== 'approved' || freshProp.is_active !== true;
            if (!isStillIneligible) {
              // Property became approved mid-reconciliation pass! Preserving media!
              console.warn(`[reconcilePropertyMedia] Property ${pId} became approved concurrently. Preserving ${fullPath}`);
              continue;
            }

            const { error: delErr } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove([fullPath]);
            if (!delErr) {
              summary.orphans_deleted++;
              await supabaseServer.from('property_media_audits').insert({
                property_id: pId,
                action: 'quarantine_demotion',
                source_bucket: STORAGE_BUCKET_PUBLIC,
                target_bucket: STORAGE_BUCKET_STAGING,
                storage_path: fullPath,
                execution_status: 'success',
                performed_by: adminId || null,
                operation_id: opId,
                media_revision: objectRevision || prop?.media_revision || null,
                metadata: {
                  reason: 'reconciliation_orphan_cleanup',
                  property_status: prop?.approval_status || 'deleted',
                  is_active: prop?.is_active ?? false,
                },
              });
            } else {
              summary.failed_deletions++;
              summary.errors.push(`Failed to delete orphan ${fullPath}: ${delErr.message}`);
            }
          } else {
            // Property IS eligible (approved and active)!
            // Check if object belongs to an older, superseded generation that is no longer active
            const isCurrentRev = objectRevision !== null && objectRevision === prop.media_revision;
            const isReferenced = (prop.image_url && typeof prop.image_url === 'string' && prop.image_url.includes(fullPath)) ||
              (Array.isArray(prop.photos) && prop.photos.some(p => typeof p === 'string' && p.includes(fullPath)));

            if (!isCurrentRev && !isReferenced && objectRevision !== null && objectRevision < (prop.media_revision || 1)) {
              // Superseded stale generation from older revision!
              const { data: freshProp } = await supabaseServer
                .from('properties')
                .select('id, media_revision')
                .eq('id', pId)
                .maybeSingle();

              if (freshProp && freshProp.media_revision !== objectRevision) {
                const { error: delErr } = await supabaseServer.storage.from(STORAGE_BUCKET_PUBLIC).remove([fullPath]);
                if (!delErr) {
                  summary.stale_generations_deleted++;
                  summary.orphans_deleted++;
                  await supabaseServer.from('property_media_audits').insert({
                    property_id: pId,
                    action: 'quarantine_demotion',
                    source_bucket: STORAGE_BUCKET_PUBLIC,
                    target_bucket: STORAGE_BUCKET_STAGING,
                    storage_path: fullPath,
                    execution_status: 'success',
                    performed_by: adminId || null,
                    operation_id: opId,
                    media_revision: objectRevision,
                    metadata: {
                      reason: 'reconciliation_stale_generation_cleanup',
                      superseded_by: prop.media_revision,
                    },
                  });
                }
              }
            }
          }
        }
      }

      // 2. Scan properties with reconciliation_required status
      let query = supabaseServer
        .from('properties')
        .select('id, approval_status, is_active, media_publication_status')
        .eq('media_publication_status', 'reconciliation_required');

      if (targetPropertyId) {
        query = query.eq('id', targetPropertyId);
      }

      const { data: reconciliationProps } = await query;
      if (reconciliationProps) {
        for (const rp of reconciliationProps) {
          if (rp.approval_status === 'approved' && rp.is_active === true) {
            const promoRes = await promotePropertyMediaToPublic(rp.id, adminId);
            if (promoRes.success && !promoRes.partial) {
              summary.reconciled_promotions++;
            }
          } else {
            const demoteRes = await demotePropertyMediaToStaging(rp.id, adminId, 'reconciliation_fix', opId);
            if (demoteRes.success) {
              summary.reconciled_promotions++;
            }
          }
        }
      }
    } catch (err: any) {
      summary.errors.push(err?.message || 'Reconciliation exception');
    }

    return summary;
  }

  // ============================================================================
  // GATE #10.2: HOST MARKETPLACE & PROPERTY LISTING LIFECYCLE ENDPOINTS
  // ============================================================================

  // 1. GET /api/host/properties - List all properties belonging to authenticated host
  app.get(['/api/host/properties', '/host/properties'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const supabaseServer = getServerSupabase();
      const { data: properties, error } = await supabaseServer
        .from('properties')
        .select('*, rooms(*)')
        .eq('host_id', hostAuth.hostProfile.id)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.json({ success: true, properties: properties || [] });
    } catch (err: any) {
      console.error('[Host Properties List Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. POST /api/host/properties - Create a draft property
  app.post(['/api/host/properties', '/host/properties'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      if (hostAuth.hostProfile.host_status !== 'active') {
        return res.status(403).json({
          success: false,
          error: `Host status '${hostAuth.hostProfile.host_status}' cannot create properties. Active status required.`,
        });
      }

      // Check protected fields that cannot be client-set
      const protectedFields = [
        'approval_status',
        'partner_tier',
        'approved_by',
        'approved_at',
        'is_verified',
        'verified',
        'commission_rate_percentage',
        'requires_damage_deposit',
        'damage_deposit_amount_ngn',
      ];
      for (const field of protectedFields) {
        if (req.body[field] !== undefined) {
          return res.status(400).json({
            success: false,
            error: `Field '${field}' is protected and cannot be set by host.`,
          });
        }
      }

      // Host cannot set another host_id
      if (req.body.host_id && req.body.host_id !== hostAuth.hostProfile.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot assign property to another host_id.',
        });
      }

      const {
        venue_id,
        title,
        name,
        description,
        property_type,
        address,
        city,
        state,
        country = 'Nigeria',
        latitude,
        longitude,
        phone,
        email,
        website,
        amenities = [],
        photos = [],
        image_url,
        check_in_time = '14:00',
        check_out_time = '11:00',
      } = req.body;

      const propertyTitle = title || name;
      if (!propertyTitle || !propertyTitle.trim()) {
        return res.status(400).json({ success: false, error: 'Property title or name is required.' });
      }
      if (!venue_id) {
        return res.status(400).json({ success: false, error: 'Associated venue_id is required.' });
      }

      const supabaseServer = getServerSupabase();
      const { data: newProperty, error } = await supabaseServer
        .from('properties')
        .insert({
          host_id: hostAuth.hostProfile.id,
          venue_id,
          title: propertyTitle.trim(),
          name: propertyTitle.trim(),
          description: description || '',
          property_type: property_type || 'Apartment',
          address: address || '',
          city: city || '',
          state: state || '',
          country,
          latitude: latitude !== undefined ? Number(latitude) : null,
          longitude: longitude !== undefined ? Number(longitude) : null,
          phone: phone || null,
          email: email || null,
          website: website || null,
          amenities,
          photos,
          image_url: image_url || (photos.length > 0 ? photos[0] : null),
          check_in_time,
          check_out_time,
          partner_tier: 'individual_host',
          approval_status: 'draft',
          status: true,
          requires_damage_deposit: true,
          damage_deposit_amount_ngn: 50000,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(201).json({ success: true, property: newProperty });
    } catch (err: any) {
      console.error('[Create Host Property Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. GET /api/host/properties/:id - Get property details (Host must own property)
  app.get(['/api/host/properties/:id', '/host/properties/:id'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();
      const { data: property, error } = await supabaseServer
        .from('properties')
        .select('*, rooms(*)')
        .eq('id', id)
        .maybeSingle();

      if (error || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      // Check ownership
      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      return res.json({ success: true, property });
    } catch (err: any) {
      console.error('[Get Host Property Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. PATCH /api/host/properties/:id - Update property (cannot edit during pending_review or suspended)
  app.patch(['/api/host/properties/:id', '/host/properties/:id'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      // Lock against edits if pending_review or suspended
      if (property.approval_status === 'pending_review' || property.approval_status === 'suspended') {
        return res.status(400).json({
          success: false,
          error: `Property in '${property.approval_status}' status cannot be edited. It is currently locked.`,
        });
      }

      // Check protected fields
      const protectedFields = [
        'host_id',
        'approval_status',
        'partner_tier',
        'approved_by',
        'approved_at',
        'is_verified',
        'verified',
        'commission_rate_percentage',
        'requires_damage_deposit',
        'damage_deposit_amount_ngn',
      ];
      for (const field of protectedFields) {
        if (req.body[field] !== undefined) {
          return res.status(400).json({
            success: false,
            error: `Field '${field}' is protected and cannot be modified by host.`,
          });
        }
      }

      const updates: any = {};
      const allowedFields = [
        'title', 'name', 'description', 'property_type', 'address',
        'city', 'state', 'country', 'latitude', 'longitude',
        'phone', 'email', 'website', 'amenities', 'photos',
        'image_url', 'check_in_time', 'check_out_time', 'status'
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      if (updates.title && !updates.name) updates.name = updates.title;
      if (updates.name && !updates.title) updates.title = updates.name;

      // Structural change on approved property auto-resets to pending_review
      let willResetToReview = false;
      if (property.approval_status === 'approved') {
        const structuralFields = ['title', 'name', 'address', 'city', 'state', 'latitude', 'longitude', 'venue_id', 'property_type'];
        for (const sf of structuralFields) {
          if (updates[sf] !== undefined && updates[sf] !== property[sf]) {
            willResetToReview = true;
            break;
          }
        }
        if (willResetToReview) {
          updates.approval_status = 'pending_review';
          updates.submitted_at = new Date().toISOString();
          updates.approved_by = null;
          updates.approved_at = null;
        }
      }

      updates.updated_at = new Date().toISOString();

      const { data: updated, error: updateErr } = await supabaseServer
        .from('properties')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: updateErr.message });
      }

      if (willResetToReview) {
        await supabaseServer.from('property_approval_audits').insert({
          property_id: id,
          admin_id: hostAuth.user.id,
          previous_status: 'approved',
          new_status: 'pending_review',
          rejection_reason: null,
          metadata: { trigger: 'structural_edit_re_review' },
        });
        await demotePropertyMediaToStaging(id, hostAuth.user.id, 'structural_edit_re_review');
      }

      return res.json({ success: true, property: updated });
    } catch (err: any) {
      console.error('[Patch Host Property Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. POST /api/host/properties/:id/submit - Submit property for review
  app.post(['/api/host/properties/:id/submit', '/host/properties/:id/submit'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();

      // Check property existence and ownership
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('*, rooms(*)')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      if (!['draft', 'rejected'].includes(property.approval_status)) {
        return res.status(400).json({
          success: false,
          error: `Property in '${property.approval_status}' status cannot be submitted for review.`,
        });
      }

      // Validate publication completeness
      const title = (property.title || property.name || '').trim();
      if (title.length < 5) {
        return res.status(400).json({ success: false, error: 'Property title must be at least 5 characters.' });
      }
      const desc = (property.description || '').trim();
      if (desc.length < 20) {
        return res.status(400).json({ success: false, error: 'Property description must be at least 20 characters.' });
      }
      if (!property.address?.trim() || !property.city?.trim() || !property.state?.trim()) {
        return res.status(400).json({ success: false, error: 'Property address, city, and state are required.' });
      }
      if (property.latitude === null || property.longitude === null) {
        return res.status(400).json({ success: false, error: 'Property geographic coordinates (latitude, longitude) are required.' });
      }
      if (!property.venue_id) {
        return res.status(400).json({ success: false, error: 'Property venue association is required.' });
      }

      // Check rooms
      const activeRooms = (property.rooms || []).filter((r: any) => r.is_active !== false && r.status !== false && r.status !== 'inactive');
      if (activeRooms.length === 0) {
        return res.status(400).json({ success: false, error: 'Property must have at least one active room before submission.' });
      }

      for (const room of activeRooms) {
        const price = room.price_per_night_ngn ?? room.price_per_night ?? 0;
        const total = room.total_rooms ?? 0;
        const guests = room.max_guests ?? room.capacity ?? 0;
        if (price <= 0 || total <= 0 || guests <= 0) {
          return res.status(400).json({
            success: false,
            error: `Room '${room.name}' has invalid pricing or capacity settings.`,
          });
        }
      }

      // Transition to pending_review
      const { data: updated, error: updateErr } = await supabaseServer
        .from('properties')
        .update({
          approval_status: 'pending_review',
          submitted_at: new Date().toISOString(),
          rejection_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: updateErr.message });
      }

      // Insert audit log
      await supabaseServer.from('property_approval_audits').insert({
        property_id: id,
        admin_id: hostAuth.user.id,
        previous_status: property.approval_status,
        new_status: 'pending_review',
        rejection_reason: null,
        metadata: { submitted_by: hostAuth.user.id },
      });

      return res.json({
        success: true,
        property_id: id,
        approval_status: 'pending_review',
        submitted_at: updated.submitted_at,
      });
    } catch (err: any) {
      console.error('[Submit Property Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. GET /api/host/properties/:id/rooms - List rooms under host property
  app.get(['/api/host/properties/:id/rooms', '/host/properties/:id/rooms'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();

      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('id, host_id')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      const { data: rooms, error } = await supabaseServer
        .from('rooms')
        .select('*')
        .eq('property_id', id)
        .order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.json({ success: true, rooms: rooms || [] });
    } catch (err: any) {
      console.error('[Host Property Rooms List Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. POST /api/host/properties/:id/rooms - Create a room under host property
  app.post(['/api/host/properties/:id/rooms', '/host/properties/:id/rooms'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();

      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('id, host_id, approval_status')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      if (property.approval_status === 'pending_review' || property.approval_status === 'suspended') {
        return res.status(400).json({
          success: false,
          error: `Cannot add rooms while property is in '${property.approval_status}' status.`,
        });
      }

      // available_rooms cannot be host-mutated directly
      if (req.body.available_rooms !== undefined) {
        return res.status(400).json({
          success: false,
          error: 'available_rooms cannot be host-mutated. Room availability is date-specific.',
        });
      }

      const {
        name,
        room_type = 'Standard Room',
        description = '',
        price_per_night_ngn,
        price_per_night,
        capacity,
        max_guests,
        total_rooms = 1,
        amenities = [],
        photos = [],
        image_url,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Room name is required.' });
      }

      const effectivePrice = price_per_night_ngn ?? price_per_night;
      if (effectivePrice === undefined || typeof effectivePrice !== 'number' || effectivePrice <= 0) {
        return res.status(400).json({ success: false, error: 'Room price must be a positive number.' });
      }

      const effectiveGuests = max_guests ?? capacity ?? 1;
      if (typeof effectiveGuests !== 'number' || effectiveGuests < 1) {
        return res.status(400).json({ success: false, error: 'Guest capacity must be at least 1.' });
      }

      if (typeof total_rooms !== 'number' || total_rooms < 1) {
        return res.status(400).json({ success: false, error: 'Total rooms must be at least 1.' });
      }

      const { data: newRoom, error: insertErr } = await supabaseServer
        .from('rooms')
        .insert({
          property_id: id,
          name: name.trim(),
          room_type,
          description,
          price_per_night_ngn: effectivePrice,
          price_per_night: effectivePrice,
          capacity: effectiveGuests,
          max_guests: effectiveGuests,
          total_rooms,
          available_rooms: total_rooms,
          is_active: true,
          status: 'active',
          amenities,
          photos,
          image_url: image_url || (photos.length > 0 ? photos[0] : null),
        })
        .select()
        .single();

      if (insertErr) {
        return res.status(500).json({ success: false, error: insertErr.message });
      }

      return res.status(201).json({ success: true, room: newRoom });
    } catch (err: any) {
      console.error('[Create Host Room Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. PATCH /api/host/rooms/:id - Update room details
  app.patch(['/api/host/rooms/:id', '/host/rooms/:id'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();

      const { data: room, error: fetchErr } = await supabaseServer
        .from('rooms')
        .select('*, property:properties(id, host_id, approval_status)')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !room) {
        return res.status(404).json({ success: false, error: 'Room not found.' });
      }

      if (room.property?.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this room.' });
      }

      if (['pending_review', 'suspended'].includes(room.property?.approval_status)) {
        return res.status(400).json({
          success: false,
          error: `Cannot modify rooms under a property in '${room.property?.approval_status}' status.`,
        });
      }

      if (req.body.available_rooms !== undefined) {
        return res.status(400).json({
          success: false,
          error: 'available_rooms cannot be host-mutated. Room availability is date-specific.',
        });
      }

      if (req.body.property_id && req.body.property_id !== room.property_id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot reassign room to a different property.',
        });
      }

      const price = req.body.price_per_night_ngn ?? req.body.price_per_night;
      if (price !== undefined && (typeof price !== 'number' || price <= 0)) {
        return res.status(400).json({ success: false, error: 'Room price must be a positive number.' });
      }

      const guests = req.body.max_guests ?? req.body.capacity;
      if (guests !== undefined && (typeof guests !== 'number' || guests < 1)) {
        return res.status(400).json({ success: false, error: 'Guest capacity must be at least 1.' });
      }

      const total = req.body.total_rooms;
      if (total !== undefined && (typeof total !== 'number' || total < 1)) {
        return res.status(400).json({ success: false, error: 'Total rooms must be at least 1.' });
      }

      // If reducing total_rooms, check active future reservations
      if (total !== undefined && total < room.total_rooms) {
        const { count, error: countErr } = await supabaseServer
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('room_id', id)
          .gt('check_out', new Date().toISOString().split('T')[0])
          .in('booking_status', ['confirmed', 'checked_in', 'pending']);

        if (!countErr && (count || 0) > total) {
          return res.status(400).json({
            success: false,
            error: `Cannot reduce total_rooms to ${total}. Active future reservations count is ${count}.`,
          });
        }
      }

      const updates: any = {};
      const allowedFields = [
        'name', 'room_type', 'description', 'price_per_night_ngn',
        'price_per_night', 'capacity', 'max_guests', 'total_rooms',
        'amenities', 'photos', 'image_url', 'is_active', 'status'
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      if (updates.price_per_night_ngn && !updates.price_per_night) {
        updates.price_per_night = updates.price_per_night_ngn;
      }
      if (updates.price_per_night && !updates.price_per_night_ngn) {
        updates.price_per_night_ngn = updates.price_per_night;
      }
      if (updates.max_guests && !updates.capacity) updates.capacity = updates.max_guests;
      if (updates.capacity && !updates.max_guests) updates.max_guests = updates.capacity;

      updates.updated_at = new Date().toISOString();

      const { data: updatedRoom, error: updateErr } = await supabaseServer
        .from('rooms')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: updateErr.message });
      }

      return res.json({ success: true, room: updatedRoom });
    } catch (err: any) {
      console.error('[Patch Host Room Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. DELETE /api/host/rooms/:id - Delete room (prohibited if bookings exist)
  app.delete(['/api/host/rooms/:id', '/host/rooms/:id'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();

      const { data: room, error: fetchErr } = await supabaseServer
        .from('rooms')
        .select('*, property:properties(id, host_id, approval_status)')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !room) {
        return res.status(404).json({ success: false, error: 'Room not found.' });
      }

      if (room.property?.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this room.' });
      }

      // Check if any bookings exist for this room
      const { count: bookingCount, error: countErr } = await supabaseServer
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', id);

      if (countErr) {
        return res.status(500).json({ success: false, error: countErr.message });
      }

      if ((bookingCount || 0) > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete room with existing booking history. Please deactivate the room instead.',
        });
      }

      const { error: deleteErr } = await supabaseServer
        .from('rooms')
        .delete()
        .eq('id', id);

      if (deleteErr) {
        return res.status(500).json({ success: false, error: deleteErr.message });
      }

      await cleanupPropertyMedia(room.property_id, id, hostAuth.user.id);

      return res.json({ success: true, message: 'Room successfully deleted.' });
    } catch (err: any) {
      console.error('[Delete Host Room Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 10. POST /api/host/properties/:id/images/upload-url - Signed upload URL for property image
  app.post(['/api/host/properties/:id/images/upload-url', '/host/properties/:id/images/upload-url'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const { fileName, mimeType, fileSize } = req.body;

      if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ success: false, error: 'Valid fileName is required.' });
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (mimeType && !allowedMimes.includes(mimeType)) {
        return res.status(400).json({ success: false, error: 'Invalid file type. Supported types: JPEG, PNG, WEBP.' });
      }

      if (fileSize && fileSize > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'File size exceeds maximum limit of 10MB.' });
      }

      const supabaseServer = getServerSupabase();
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('id, host_id, approval_status')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      if (property.approval_status === 'pending_review' || property.approval_status === 'suspended') {
        return res.status(400).json({
          success: false,
          error: `Media uploads are prohibited while property is in '${property.approval_status}' status.`,
        });
      }

      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `properties/${id}/${Date.now()}-${sanitizedName}`;

      const { data: signedData, error: signedErr } = await supabaseServer.storage
        .from(STORAGE_BUCKET_STAGING)
        .createSignedUploadUrl(storagePath);

      if (signedErr) {
        return res.status(500).json({ success: false, error: signedErr.message });
      }

      await supabaseServer.from('property_media_audits').insert({
        property_id: id,
        action: 'staging_upload',
        source_bucket: STORAGE_BUCKET_STAGING,
        storage_path: storagePath,
        performed_by: hostAuth.user.id,
        metadata: { fileName, mimeType, fileSize },
      });

      return res.json({
        success: true,
        signedUrl: signedData?.signedUrl,
        token: signedData?.token,
        path: storagePath,
        bucket: STORAGE_BUCKET_STAGING,
      });
    } catch (err: any) {
      console.error('[Property Image Upload URL Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 11. POST /api/host/rooms/:id/images/upload-url - Signed upload URL for room image
  app.post(['/api/host/rooms/:id/images/upload-url', '/host/rooms/:id/images/upload-url'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const { fileName, mimeType, fileSize } = req.body;

      if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ success: false, error: 'Valid fileName is required.' });
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (mimeType && !allowedMimes.includes(mimeType)) {
        return res.status(400).json({ success: false, error: 'Invalid file type. Supported types: JPEG, PNG, WEBP.' });
      }

      if (fileSize && fileSize > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'File size exceeds maximum limit of 10MB.' });
      }

      const supabaseServer = getServerSupabase();
      const { data: room, error: fetchErr } = await supabaseServer
        .from('rooms')
        .select('*, property:properties(id, host_id, approval_status)')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !room) {
        return res.status(404).json({ success: false, error: 'Room not found.' });
      }

      if (room.property?.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this room.' });
      }

      if (['pending_review', 'suspended'].includes(room.property?.approval_status)) {
        return res.status(400).json({
          success: false,
          error: `Media uploads are prohibited while property is in '${room.property?.approval_status}' status.`,
        });
      }

      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `rooms/${id}/${Date.now()}-${sanitizedName}`;

      const { data: signedData, error: signedErr } = await supabaseServer.storage
        .from(STORAGE_BUCKET_STAGING)
        .createSignedUploadUrl(storagePath);

      if (signedErr) {
        return res.status(500).json({ success: false, error: signedErr.message });
      }

      await supabaseServer.from('property_media_audits').insert({
        property_id: room.property_id,
        room_id: id,
        action: 'staging_upload',
        source_bucket: STORAGE_BUCKET_STAGING,
        storage_path: storagePath,
        performed_by: hostAuth.user.id,
        metadata: { fileName, mimeType, fileSize },
      });

      return res.json({
        success: true,
        signedUrl: signedData?.signedUrl,
        token: signedData?.token,
        path: storagePath,
        bucket: STORAGE_BUCKET_STAGING,
      });
    } catch (err: any) {
      console.error('[Room Image Upload URL Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 11b. POST & GET /api/host/properties/:id/images/download-url - Signed download URL for staging media (Host only)
  app.all(['/api/host/properties/:id/images/download-url', '/host/properties/:id/images/download-url'], async (req: Request, res: Response) => {
    try {
      const hostAuth = await getAuthHost(req);
      if (!hostAuth.authorized) {
        return res.status(hostAuth.status).json({ success: false, error: hostAuth.error });
      }

      const { id } = req.params;
      const rawPath = (req.query.path || req.body?.path || req.body?.storage_path) as string;

      if (!rawPath || typeof rawPath !== 'string') {
        return res.status(400).json({ success: false, error: 'Path parameter is required.' });
      }

      // Path traversal check
      if (rawPath.includes('..') || rawPath.startsWith('/') || rawPath.startsWith('\\')) {
        return res.status(400).json({ success: false, error: 'Invalid storage path.' });
      }

      const supabaseServer = getServerSupabase();
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('id, host_id, approval_status')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      if (property.host_id !== hostAuth.hostProfile.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized: You do not own this property.' });
      }

      // Check that the storage path belongs to this property or a room under this property
      const isPropertyPath = rawPath.startsWith(`properties/${id}/`);
      let isRoomPath = false;

      if (!isPropertyPath && rawPath.startsWith('rooms/')) {
        const parts = rawPath.split('/');
        const roomId = parts[1];
        if (roomId) {
          const { data: room } = await supabaseServer
            .from('rooms')
            .select('id, property_id')
            .eq('id', roomId)
            .maybeSingle();
          if (room && room.property_id === id) {
            isRoomPath = true;
          }
        }
      }

      if (!isPropertyPath && !isRoomPath) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Media path does not belong to this property.' });
      }

      const expiresIn = 900; // 15 minutes TTL
      const { data: signedData, error: signedErr } = await supabaseServer.storage
        .from(STORAGE_BUCKET_STAGING)
        .createSignedUrl(rawPath, expiresIn);

      if (signedErr) {
        return res.status(500).json({ success: false, error: signedErr.message });
      }

      return res.json({
        success: true,
        signedUrl: signedData?.signedUrl,
        storage_path: rawPath,
        expires_in: expiresIn,
      });
    } catch (err: any) {
      console.error('[Host Download URL Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 11c. POST & GET /api/admin/properties/:id/images/download-url - Admin signed download URL for staging media
  app.all(['/api/admin/properties/:id/images/download-url', '/admin/properties/:id/images/download-url'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { id } = req.params;
      const rawPath = (req.query.path || req.body?.path || req.body?.storage_path) as string;

      if (!rawPath || typeof rawPath !== 'string') {
        return res.status(400).json({ success: false, error: 'Path parameter is required.' });
      }

      if (rawPath.includes('..') || rawPath.startsWith('/') || rawPath.startsWith('\\')) {
        return res.status(400).json({ success: false, error: 'Invalid storage path.' });
      }

      const supabaseServer = getServerSupabase();
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('id')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      const expiresIn = 900; // 15 minutes TTL
      const { data: signedData, error: signedErr } = await supabaseServer.storage
        .from(STORAGE_BUCKET_STAGING)
        .createSignedUrl(rawPath, expiresIn);

      if (signedErr) {
        return res.status(500).json({ success: false, error: signedErr.message });
      }

      return res.json({
        success: true,
        signedUrl: signedData?.signedUrl,
        storage_path: rawPath,
        expires_in: expiresIn,
      });
    } catch (err: any) {
      console.error('[Admin Download URL Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ============================================================================
  // ADMIN PROPERTY GOVERNANCE ENDPOINTS
  // ============================================================================

  // 12. GET /api/admin/properties - List properties with admin filters
  app.get(['/api/admin/properties', '/admin/properties'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { status, approval_status, partner_tier, venue_id, limit = '50', offset = '0' } = req.query;
      const supabaseServer = getServerSupabase();

      let query = supabaseServer
        .from('properties')
        .select('*, host:host_profiles(*), rooms(*)')
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (approval_status) query = query.eq('approval_status', String(approval_status));
      if (partner_tier) query = query.eq('partner_tier', String(partner_tier));
      if (venue_id) query = query.eq('venue_id', String(venue_id));
      if (status !== undefined) query = query.eq('status', status === 'true');

      const { data: properties, error } = await query;
      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.json({ success: true, properties: properties || [] });
    } catch (err: any) {
      console.error('[Admin Properties List Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 13. GET /api/admin/properties/:id - Get property with rooms and approval audits
  app.get(['/api/admin/properties/:id', '/admin/properties/:id'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { id } = req.params;
      const supabaseServer = getServerSupabase();

      const { data: property, error: propErr } = await supabaseServer
        .from('properties')
        .select('*, host:host_profiles(*), rooms(*)')
        .eq('id', id)
        .maybeSingle();

      if (propErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      const { data: audits, error: auditErr } = await supabaseServer
        .from('property_approval_audits')
        .select('*')
        .eq('property_id', id)
        .order('created_at', { ascending: false });

      return res.json({
        success: true,
        property,
        rooms: property.rooms || [],
        audits: audits || [],
      });
    } catch (err: any) {
      console.error('[Admin Property Detail Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 14. POST /api/admin/properties/:id/adjudicate - Approve or reject property
  app.post(['/api/admin/properties/:id/adjudicate', '/admin/properties/:id/adjudicate'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { id } = req.params;
      const { decision, rejection_reason, partner_tier } = req.body;

      if (!decision || !['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({
          success: false,
          error: "decision must be either 'approved' or 'rejected'.",
        });
      }

      if (decision === 'rejected' && (!rejection_reason || !rejection_reason.trim())) {
        return res.status(400).json({
          success: false,
          error: 'A non-empty rejection reason is required when rejecting a property.',
        });
      }

      const supabaseServer = getServerSupabase();
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      const newTier = partner_tier || property.partner_tier || 'individual_host';
      if (!['individual_host', 'hotel_organization'].includes(newTier)) {
        return res.status(400).json({ success: false, error: `Invalid partner tier '${newTier}'.` });
      }

      const updates: any = {
        approval_status: decision,
        updated_at: new Date().toISOString(),
      };

      if (decision === 'approved') {
        updates.approved_by = adminCheck.user.id;
        updates.approved_at = new Date().toISOString();
        updates.partner_tier = newTier;
        updates.rejection_reason = null;
        if (newTier === 'hotel_organization') {
          updates.requires_damage_deposit = false;
          updates.damage_deposit_amount_ngn = 0;
        }
      } else {
        updates.approved_by = adminCheck.user.id;
        updates.rejection_reason = rejection_reason.trim();
      }

      const { data: updated, error: updateErr } = await supabaseServer
        .from('properties')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: updateErr.message });
      }

      // Record audit
      await supabaseServer.from('property_approval_audits').insert({
        property_id: id,
        admin_id: adminCheck.user.id,
        previous_status: property.approval_status,
        new_status: decision,
        rejection_reason: decision === 'rejected' ? rejection_reason.trim() : null,
        metadata: {
          adjudicated_by: adminCheck.user.id,
          partner_tier: newTier,
        },
      });

      // Promote or quarantine media based on decision
      if (decision === 'approved') {
        await promotePropertyMediaToPublic(id, adminCheck.user.id);
      } else if (decision === 'rejected') {
        await demotePropertyMediaToStaging(id, adminCheck.user.id, rejection_reason);
      }

      return res.json({
        success: true,
        property_id: id,
        approval_status: decision,
        partner_tier: updated.partner_tier,
        adjudicated_by: adminCheck.user.id,
        adjudicated_at: updates.approved_at || new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Admin Adjudicate Property Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 15. POST /api/admin/properties/:id/suspend - Suspend a property
  app.post(['/api/admin/properties/:id/suspend', '/admin/properties/:id/suspend'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { id } = req.params;
      const { reason } = req.body;
      const supabaseServer = getServerSupabase();

      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      const { data: updated, error: updateErr } = await supabaseServer
        .from('properties')
        .update({
          approval_status: 'suspended',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: updateErr.message });
      }

      await supabaseServer.from('property_approval_audits').insert({
        property_id: id,
        admin_id: adminCheck.user.id,
        previous_status: property.approval_status,
        new_status: 'suspended',
        rejection_reason: reason || null,
        metadata: { action: 'admin_suspend', reason },
      });

      await demotePropertyMediaToStaging(id, adminCheck.user.id, reason || 'admin_suspend');

      return res.json({
        success: true,
        property_id: id,
        approval_status: 'suspended',
        suspended_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Admin Suspend Property Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 16. PATCH /api/admin/properties/:id/partner-tier - Change partner tier (admin only)
  app.patch(['/api/admin/properties/:id/partner-tier', '/admin/properties/:id/partner-tier'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { id } = req.params;
      const { partner_tier } = req.body;

      if (!partner_tier || !['individual_host', 'hotel_organization'].includes(partner_tier)) {
        return res.status(400).json({
          success: false,
          error: "partner_tier must be 'individual_host' or 'hotel_organization'.",
        });
      }

      const supabaseServer = getServerSupabase();
      const { data: property, error: fetchErr } = await supabaseServer
        .from('properties')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !property) {
        return res.status(404).json({ success: false, error: 'Property not found.' });
      }

      const updates: any = {
        partner_tier,
        updated_at: new Date().toISOString(),
      };
      if (partner_tier === 'hotel_organization') {
        updates.requires_damage_deposit = false;
        updates.damage_deposit_amount_ngn = 0;
      }

      const { data: updated, error: updateErr } = await supabaseServer
        .from('properties')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: updateErr.message });
      }

      await supabaseServer.from('property_approval_audits').insert({
        property_id: id,
        admin_id: adminCheck.user.id,
        previous_status: property.approval_status,
        new_status: property.approval_status,
        rejection_reason: null,
        metadata: {
          action: 'tier_update',
          previous_tier: property.partner_tier,
          new_tier: partner_tier,
        },
      });

      return res.json({
        success: true,
        property_id: id,
        partner_tier: updated.partner_tier,
        updated_at: updated.updated_at,
      });
    } catch (err: any) {
      console.error('[Admin Set Partner Tier Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 17. POST /api/admin/media/reconcile - Reconcile public media storage against authoritative DB state
  app.post(['/api/admin/media/reconcile', '/admin/media/reconcile'], async (req: Request, res: Response) => {
    try {
      const adminCheck = await getAuthAdmin(req);
      if (!adminCheck.authorized) {
        return res.status(adminCheck.status).json({ success: false, error: adminCheck.error });
      }

      const { property_id } = req.body || {};
      const summary = await reconcilePropertyMedia(property_id, adminCheck.user.id);

      return res.json({
        success: true,
        summary,
        reconciled_by: adminCheck.user.id,
        reconciled_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Admin Reconcile Media Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 18. ALL /api/cron/media-reconcile - Automated cron media reconciliation (Fix F-08)
  app.all(['/api/cron/media-reconcile', '/cron/media-reconcile'], async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const xCronSecret = req.headers['x-cron-secret'];
      const configuredSecret = process.env.CRON_SECRET || 'dev_cron_media_secret_secure_fallback';

      const isBearerValid = authHeader === `Bearer ${configuredSecret}`;
      const isHeaderValid = xCronSecret === configuredSecret;
      const isCronAuthorized = isBearerValid || isHeaderValid;

      let isAdmin = false;
      try {
        const adminCheck = await getAuthAdmin(req);
        if (adminCheck.authorized) isAdmin = true;
      } catch {}

      if (!isCronAuthorized && !isAdmin) {
        try {
          const hostCheck = await getAuthHost(req);
          if (hostCheck.authorized) {
            return res.status(403).json({
              success: false,
              error: 'Forbidden: Hosts are not permitted to invoke administrative media reconciliation.',
            });
          }
        } catch {}

        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Valid CRON_SECRET or Administrator authorization required.',
        });
      }

      const performer = isCronAuthorized ? 'cron_scheduler' : 'admin';
      const summary = await reconcilePropertyMedia(undefined, performer);

      return res.status(200).json({
        success: true,
        performer,
        scheduled: true,
        summary,
        reconciled_at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[cron/media-reconcile Exception]', err);
      return res.status(500).json({ success: false, error: err?.message || 'Reconciliation failed' });
    }
  });

  // ============================================================================
  // SECURE ISSUE EVIDENCE STORAGE ENDPOINTS (Signed URLs, Private Bucket)
  // ============================================================================
  // Generate signed upload URL for authorized guest or admin
  app.post(['/api/issues/:issueId/evidence/upload-url', '/issues/:issueId/evidence/upload-url'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { issueId } = req.params;
      const { fileName } = req.body;

      if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ success: false, error: 'Valid fileName is required' });
      }

      const supabaseServer = getServerSupabase();

      // Check admin status
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authResult.user.id)
        .maybeSingle();

      const isAdmin = profile?.role === 'admin';

      // Check issue ownership
      const { data: issue, error: issueErr } = await supabaseServer
        .from('booking_issues')
        .select('id, guest_id')
        .eq('id', issueId)
        .maybeSingle();

      if (issueErr || !issue) {
        return res.status(404).json({ success: false, error: 'Booking issue not found' });
      }

      const isOwner = issue.guest_id === authResult.user.id;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have permission to upload evidence for this issue',
        });
      }

      // Sanitize filename and construct private path
      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${authResult.user.id}/${issueId}/${Date.now()}-${sanitizedName}`;

      const { data: signedData, error: signedErr } = await supabaseServer.storage
        .from('issue-evidence-private')
        .createSignedUploadUrl(storagePath);

      if (signedErr) {
        return res.status(500).json({ success: false, error: signedErr.message });
      }

      return res.json({
        success: true,
        signedUrl: signedData?.signedUrl,
        token: signedData?.token,
        path: storagePath,
      });
    } catch (err: any) {
      console.error('[Evidence Upload URL Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Generate signed download URL for authorized guest or admin (rejects hosts and arbitrary users)
  app.get(['/api/issues/:issueId/evidence/:evidenceId/signed-url', '/issues/:issueId/evidence/:evidenceId/signed-url'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { issueId, evidenceId } = req.params;
      const supabaseServer = getServerSupabase();

      // Check admin status
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authResult.user.id)
        .maybeSingle();

      const isAdmin = profile?.role === 'admin';

      // Check issue ownership
      const { data: issue, error: issueErr } = await supabaseServer
        .from('booking_issues')
        .select('id, guest_id')
        .eq('id', issueId)
        .maybeSingle();

      if (issueErr || !issue) {
        return res.status(404).json({ success: false, error: 'Booking issue not found' });
      }

      const isOwner = issue.guest_id === authResult.user.id;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not have permission to view evidence for this issue',
        });
      }

      // Fetch evidence record
      const { data: evidence, error: evErr } = await supabaseServer
        .from('booking_issue_evidence')
        .select('storage_path')
        .eq('id', evidenceId)
        .eq('issue_id', issueId)
        .maybeSingle();

      if (evErr || !evidence) {
        return res.status(404).json({ success: false, error: 'Evidence record not found' });
      }

      const { data: signedData, error: signedErr } = await supabaseServer.storage
        .from('issue-evidence-private')
        .createSignedUrl(evidence.storage_path, 900); // 15 minutes TTL

      if (signedErr) {
        return res.status(500).json({ success: false, error: signedErr.message });
      }

      return res.json({
        success: true,
        signedUrl: signedData?.signedUrl,
        expiresInSeconds: 900,
      });
    } catch (err: any) {
      console.error('[Evidence Signed URL Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ============================================================================
  // PHASE 3 — GATE #7.2B PART 1: ADJUDICATION & LIFECYCLE ENDPOINTS
  // ============================================================================

  // Admin Issue Adjudication
  app.post(['/api/admin/issues/:issueId/adjudicate', '/admin/issues/:issueId/adjudicate'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authResult.user.id)
        .maybeSingle();

      if (profile?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin authorization required' });
      }

      const { issueId } = req.params;
      const {
        tier,
        resolution_status,
        resolution_notes,
        compensation_amount_ngn,
        reserve_draw_ngn,
      } = req.body;

      const { data, error } = await supabaseServer.rpc('adjudicate_booking_issue', {
        p_issue_id: issueId,
        p_tier: tier,
        p_resolution_status: resolution_status,
        p_resolution_notes: resolution_notes || null,
        p_compensation_amount_ngn: compensation_amount_ngn || 0,
        p_reserve_draw_ngn: reserve_draw_ngn || 0,
      });

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json(data);
    } catch (err: any) {
      console.error('[Adjudicate Issue Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin Reserve Consumption
  app.post(['/api/admin/reserves/:reserveId/consume', '/admin/reserves/:reserveId/consume'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authResult.user.id)
        .maybeSingle();

      if (profile?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin authorization required' });
      }

      const { reserveId } = req.params;
      const { issue_id, amount_ngn, reason } = req.body;

      const { data, error } = await supabaseServer.rpc('consume_guest_assurance_reserve', {
        p_reserve_id: reserveId,
        p_issue_id: issue_id || null,
        p_amount_ngn: amount_ngn,
        p_reason: reason || null,
      });

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json(data);
    } catch (err: any) {
      console.error('[Consume Reserve Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin Reserve Release
  app.post(['/api/admin/reserves/:reserveId/release', '/admin/reserves/:reserveId/release'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authResult.user.id)
        .maybeSingle();

      if (profile?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin authorization required' });
      }

      const { reserveId } = req.params;

      const { data, error } = await supabaseServer.rpc('release_guest_assurance_reserve', {
        p_reserve_id: reserveId,
      });

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json(data);
    } catch (err: any) {
      console.error('[Release Reserve Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Host Submit Damage Claim
  app.post(['/api/host/damage-claims', '/host/damage-claims'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { deposit_id, claimed_amount_ngn, description, evidence_urls } = req.body;

      const { data, error } = await supabaseServer.rpc('submit_damage_claim', {
        p_deposit_id: deposit_id,
        p_claimed_amount_ngn: claimed_amount_ngn,
        p_description: description,
        p_evidence_urls: evidence_urls || [],
      });

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json(data);
    } catch (err: any) {
      console.error('[Submit Damage Claim Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin Damage Deposit Adjudication
  app.post(['/api/admin/damage-deposits/:depositId/adjudicate', '/admin/damage-deposits/:depositId/adjudicate'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authResult.user.id)
        .maybeSingle();

      if (profile?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin authorization required' });
      }

      const { depositId } = req.params;
      const { adjudication_type, retained_amount_ngn, notes } = req.body;

      const { data, error } = await supabaseServer.rpc('adjudicate_damage_deposit', {
        p_deposit_id: depositId,
        p_adjudication_type: adjudication_type,
        p_retained_amount_ngn: retained_amount_ngn || 0,
        p_notes: notes || null,
      });

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json(data);
    } catch (err: any) {
      console.error('[Adjudicate Damage Deposit Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Evaluate Clean Refund Eligibility
  app.post(['/api/damage-deposits/:depositId/evaluate-refund', '/damage-deposits/:depositId/evaluate-refund'], async (req: Request, res: Response) => {
    try {
      const authResult = await getAuthUser(req);
      if (!authResult) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { depositId } = req.params;

      const { data, error } = await supabaseServer.rpc('evaluate_damage_deposit_refund_eligibility', {
        p_deposit_id: depositId,
      });

      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json(data);
    } catch (err: any) {
      console.error('[Evaluate Deposit Refund Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ===========================================================================
  // GATE #7.2B PART 2: EXTERNAL FINANCIAL EXECUTION & REFUND ENDPOINTS
  // ===========================================================================

  // Execute Damage Deposit Refund
  app.post(['/api/admin/refunds/damage-deposit/:depositId/execute', '/admin/refunds/damage-deposit/:depositId/execute'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      const isServiceRole = req.headers['x-service-role-key'] === process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!adminAuth.authorized && !isServiceRole) {
        return res.status(401).json({ success: false, error: 'Unauthorized: admin or service-role required' });
      }

      const { depositId } = req.params;
      const { reason } = req.body;

      const refundService = getRefundService();
      const result = await refundService.executeDamageDepositRefund(depositId, reason);

      return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error('[Execute Damage Deposit Refund Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Execute Issue Compensation Refund
  app.post(['/api/admin/refunds/issue/:issueId/execute', '/admin/refunds/issue/:issueId/execute'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      const isServiceRole = req.headers['x-service-role-key'] === process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!adminAuth.authorized && !isServiceRole) {
        return res.status(401).json({ success: false, error: 'Unauthorized: admin or service-role required' });
      }

      const { issueId } = req.params;
      const { reason } = req.body;

      const refundService = getRefundService();
      const result = await refundService.executeIssueRefund(issueId, reason);

      return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error('[Execute Issue Refund Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin Reconcile Refund
  app.post(['/api/admin/refunds/:refundId/reconcile', '/admin/refunds/:refundId/reconcile'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      const isServiceRole = req.headers['x-service-role-key'] === process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!adminAuth.authorized && !isServiceRole) {
        return res.status(401).json({ success: false, error: 'Unauthorized: admin or service-role required' });
      }

      const { refundId } = req.params;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'A non-empty reason is mandatory for administrative refund reconciliation.',
        });
      }

      const refundService = getRefundService();
      const result = await refundService.reconcileRefund(refundId, reason.trim());

      return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error('[Reconcile Refund Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Safe Retry Refund
  app.post(['/api/admin/refunds/:refundId/retry', '/admin/refunds/:refundId/retry'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      const isServiceRole = req.headers['x-service-role-key'] === process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!adminAuth.authorized && !isServiceRole) {
        return res.status(401).json({ success: false, error: 'Unauthorized: admin or service-role required' });
      }

      const { refundId } = req.params;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'A non-empty reason is mandatory for refund retry.',
        });
      }

      const refundService = getRefundService();
      const result = await refundService.safeRetryRefund(refundId, reason.trim());

      return res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      console.error('[Retry Refund Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // List Refund Operations
  app.get(['/api/admin/refunds', '/admin/refunds'], async (req: Request, res: Response) => {
    try {
      const adminAuth = await getAuthAdmin(req);
      const isServiceRole = req.headers['x-service-role-key'] === process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!adminAuth.authorized && !isServiceRole) {
        return res.status(401).json({ success: false, error: 'Unauthorized: admin or service-role required' });
      }

      const supabaseServer = getServerSupabase();
      const { booking_id, status, limit = '50', offset = '0' } = req.query;

      let query = supabaseServer
        .from('refund_operations')
        .select('*')
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (booking_id) query = query.eq('booking_id', String(booking_id));
      if (status) query = query.eq('status', String(status));

      const { data, error } = await query;
      if (error) {
        return res.status(400).json({ success: false, error: error.message });
      }

      return res.json({ success: true, data });
    } catch (err: any) {
      console.error('[List Refunds Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get Refund Operation by ID (Admin or Guest Owner)
  app.get(['/api/admin/refunds/:id', '/admin/refunds/:id'], async (req: Request, res: Response) => {
    try {
      const authUser = await getAuthUser(req);
      if (!authUser) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const supabaseServer = getServerSupabase();
      const { id } = req.params;

      const { data: refund, error } = await supabaseServer
        .from('refund_operations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !refund) {
        return res.status(404).json({ success: false, error: 'Refund operation not found' });
      }

      // Check role
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('role')
        .eq('id', authUser.user.id)
        .maybeSingle();

      const isAdmin = profile?.role === 'admin';

      if (!isAdmin) {
        // Verify booking ownership
        const { data: booking } = await supabaseServer
          .from('bookings')
          .select('user_id')
          .eq('id', refund.booking_id)
          .maybeSingle();

        if (booking?.user_id !== authUser.user.id) {
          return res.status(403).json({ success: false, error: 'Unauthorized to view this refund' });
        }

        // Mask internal details for guests
        return res.json({
          success: true,
          data: {
            id: refund.id,
            booking_id: refund.booking_id,
            refund_category: refund.refund_category,
            refund_reason: refund.refund_reason,
            amount_ngn: refund.amount_ngn,
            currency: refund.currency,
            status: refund.status,
            created_at: refund.created_at,
            completed_at: refund.completed_at,
          },
        });
      }

      return res.json({ success: true, data: refund });
    } catch (err: any) {
      console.error('[Get Refund Detail Exception]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return app;
}

const app = createApp({ isVercel: true, skipListen: true, serveStatic: false });
export default app;
