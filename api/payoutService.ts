import { getServerSupabase } from './index';
import { getPaystackTransferClient, PaystackTransferClient } from './paystackTransfer';

export interface DispatchPayoutResult {
  success: boolean;
  payoutId: string;
  bookingId?: string;
  status: string;
  transferReference?: string;
  transferCode?: string;
  partnerAmountNGN?: number;
  message: string;
  isIdempotent?: boolean;
  ledgerPosted?: boolean;
}

export interface ReconcilePayoutResult {
  success: boolean;
  payoutId: string;
  priorStatus: string;
  newStatus: string;
  transferReference: string;
  resolution: string;
  message: string;
}

/**
 * PayoutService
 * Coordinates partner payout authorization, safe external dispatch, and reconciliation.
 *
 * ABSOLUTE RULES:
 * 1. NO Paystack HTTP request inside a PostgreSQL database transaction.
 * 2. Amount and recipient snapshot originate strictly from public.partner_payouts.
 * 3. Exactly one permanent transfer reference: ARK-TRF-{partner_payout_id}.
 * 4. Network timeouts are classified as UNCERTAIN -> reconciliation_required.
 * 5. Completed payouts are terminal.
 */
export class PayoutService {
  private client: PaystackTransferClient;

  constructor(client?: PaystackTransferClient) {
    this.client = client || getPaystackTransferClient();
  }

  /**
   * Authorizes and dispatches a single partner payout
   */
  public async dispatchPartnerPayout(payoutId: string): Promise<DispatchPayoutResult> {
    const supabase = getServerSupabase();

    // -------------------------------------------------------------------------
    // Step 1: Execute Authorization RPC
    // Atomic database transaction: validates all preconditions, checks Tier 3 disputes,
    // snapshots recipient data, sets status to 'processing', and commits.
    // -------------------------------------------------------------------------
    const { data: authResult, error: authError } = await supabase.rpc(
      'authorize_partner_payout',
      { p_payout_id: payoutId }
    );

    if (authError) {
      console.error(`[PayoutService] Authorization failed for payout ${payoutId}:`, authError.message);
      return {
        success: false,
        payoutId,
        status: 'authorization_failed',
        message: authError.message,
      };
    }

    if (!authResult?.success) {
      console.warn(`[PayoutService] Authorization rejected for payout ${payoutId}:`, authResult?.error || authResult?.reason);
      return {
        success: false,
        payoutId,
        status: authResult?.status || 'frozen_dispute',
        message: authResult?.error || authResult?.reason || 'Payout authorization failed',
      };
    }

    // -------------------------------------------------------------------------
    // Step 2: Extract Authoritative Dispatch Parameters
    // -------------------------------------------------------------------------
    const {
      booking_id: bookingId,
      booking_reference: bookingRef,
      partner_amount_ngn: amountNGN,
      paystack_transfer_reference: transferRef,
      recipient_snapshot: recipientSnap,
      reason: dispatchReason,
    } = authResult;

    const amountKobo = Math.round(Number(amountNGN) * 100);
    const recipientCode = recipientSnap?.recipient_code;

    // -------------------------------------------------------------------------
    // Step 3: Pre-Dispatch Safety Checks (Tier 3 & Cancellation Race)
    // -------------------------------------------------------------------------
    // Verify booking status has not been cancelled in the microsecond between auth and dispatch
    const { data: currentBooking } = await supabase
      .from('bookings')
      .select('booking_status')
      .eq('id', bookingId)
      .maybeSingle();

    if (currentBooking?.booking_status === 'cancelled') {
      console.warn(`[PayoutService] Booking ${bookingId} was cancelled before Paystack dispatch. Aborting.`);
      await supabase
        .from('partner_payouts')
        .update({
          status: 'cancelled',
          reconciliation_notes: 'Booking was cancelled prior to external dispatch',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutId);

      return {
        success: false,
        payoutId,
        bookingId,
        status: 'cancelled',
        message: 'Booking was cancelled prior to dispatch; transfer aborted.',
      };
    }

    // Verify no new Tier 3 disputes emerged
    const { data: activeTier3 } = await supabase
      .from('booking_issues')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('issue_tier', 'tier_3')
      .not('status', 'in', '("resolved_dismissed","resolved_compensated")')
      .limit(1);

    if (activeTier3 && activeTier3.length > 0) {
      console.warn(`[PayoutService] New Tier 3 dispute detected for booking ${bookingId}. Freezing payout.`);
      await supabase
        .from('partner_payouts')
        .update({
          status: 'frozen_dispute',
          reconciliation_notes: 'Frozen prior to external dispatch due to concurrent Tier 3 dispute',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payoutId);

      return {
        success: false,
        payoutId,
        bookingId,
        status: 'frozen_dispute',
        message: 'Tier 3 dispute emerged before dispatch; payout frozen.',
      };
    }

    // -------------------------------------------------------------------------
    // Step 4: External Paystack Transfer Request (OUTSIDE DATABASE TRANSACTION)
    // -------------------------------------------------------------------------
    console.log(`[PayoutService] Initiating Paystack transfer: ref=${transferRef}, amountKobo=${amountKobo}`);
    const transferResponse = await this.client.initiateTransfer({
      recipientCode,
      amountKobo,
      reference: transferRef,
      reason: dispatchReason || `TheArk Rooms Accommodation Payout - ${bookingRef}`,
      currency: 'NGN',
    });

    // -------------------------------------------------------------------------
    // Step 5: Result Classification & State Application
    // -------------------------------------------------------------------------
    // Case A: Immediate Confirmation (SUCCESS)
    if (transferResponse.type === 'SUCCESS') {
      console.log(`[PayoutService] Paystack transfer confirmed immediately for ref: ${transferRef}`);
      const { data: settleData, error: settleErr } = await supabase.rpc(
        'settle_partner_payout_transfer',
        {
          p_payout_id: payoutId,
          p_transfer_reference: transferRef,
          p_paystack_transfer_code: transferResponse.transferCode || null,
          p_paystack_response: transferResponse.rawResponse || {},
        }
      );

      if (settleErr) {
        console.error(`[PayoutService] Settlement RPC failed for payout ${payoutId}:`, settleErr.message);
        return {
          success: false,
          payoutId,
          bookingId,
          status: 'settlement_failed',
          transferReference: transferRef,
          message: settleErr.message,
        };
      }

      return {
        success: true,
        payoutId,
        bookingId,
        status: 'completed',
        transferReference: transferRef,
        transferCode: transferResponse.transferCode,
        partnerAmountNGN: amountNGN,
        ledgerPosted: settleData?.ledger_posted || false,
        isIdempotent: settleData?.already_completed || false,
        message: 'Partner payout transferred and settled successfully.',
      };
    }

    // Case B: Accepted and In-Flight (PENDING / PROCESSING / OTP)
    if (transferResponse.type === 'PENDING') {
      console.log(`[PayoutService] Transfer is processing asynchronously for ref: ${transferRef}`);
      if (transferResponse.transferCode) {
        await supabase
          .from('partner_payouts')
          .update({
            paystack_transfer_code: transferResponse.transferCode,
            updated_at: new Date().toISOString(),
          })
          .eq('id', payoutId);
      }

      return {
        success: true,
        payoutId,
        bookingId,
        status: 'processing',
        transferReference: transferRef,
        transferCode: transferResponse.transferCode,
        partnerAmountNGN: amountNGN,
        message: 'Transfer accepted by Paystack and is currently processing in flight.',
      };
    }

    // Case C: Definitive Failure (HTTP 4xx / Rejection)
    if (transferResponse.type === 'DEFINITIVE_FAILURE') {
      console.warn(`[PayoutService] Definitive transfer failure for ref ${transferRef}: ${transferResponse.message}`);
      await supabase.rpc('record_partner_payout_failure', {
        p_payout_id: payoutId,
        p_transfer_reference: transferRef,
        p_failure_reason: transferResponse.message || 'Paystack transfer rejected',
        p_paystack_response: transferResponse.rawResponse || {},
      });

      return {
        success: false,
        payoutId,
        bookingId,
        status: 'failed',
        transferReference: transferRef,
        message: transferResponse.message || 'Transfer failed definitively with Paystack',
      };
    }

    // Case D: Uncertain Outcome (Network Timeout, 5xx Server Error, Connection Reset)
    // CRITICAL: Must transition to reconciliation_required; never retry blindly!
    console.warn(`[PayoutService] Uncertain transfer outcome for ref ${transferRef}: ${transferResponse.message}`);
    await supabase.rpc('flag_partner_payout_reconciliation', {
      p_payout_id: payoutId,
      p_reason: transferResponse.message || 'Timeout or uncertain network response during transfer dispatch',
      p_paystack_response: transferResponse.rawResponse || {},
    });

    return {
      success: false,
      payoutId,
      bookingId,
      status: 'reconciliation_required',
      transferReference: transferRef,
      message: 'Transfer outcome uncertain (timeout/network error); flagged for reconciliation.',
    };
  }

  /**
   * Reconciles an existing payout against Paystack's authoritative verification endpoint
   */
  public async reconcilePartnerPayout(payoutId: string, adminReason?: string): Promise<ReconcilePayoutResult> {
    const supabase = getServerSupabase();

    // 1. Fetch current payout record
    const { data: payout, error } = await supabase
      .from('partner_payouts')
      .select('id, status, paystack_transfer_reference, paystack_transfer_code, partner_amount_ngn')
      .eq('id', payoutId)
      .maybeSingle();

    if (error || !payout) {
      throw new Error(`Partner payout ${payoutId} not found: ${error?.message}`);
    }

    if (payout.status === 'completed') {
      return {
        success: true,
        payoutId,
        priorStatus: 'completed',
        newStatus: 'completed',
        transferReference: payout.paystack_transfer_reference,
        resolution: 'already_completed',
        message: 'Payout is already in terminal completed state.',
      };
    }

    if (!payout.paystack_transfer_reference) {
      throw new Error(`Payout ${payoutId} does not have an assigned transfer reference.`);
    }

    // 2. Query Paystack Transfer Verification OUTSIDE database transaction
    console.log(`[PayoutService] Verifying transfer status with Paystack: ref=${payout.paystack_transfer_reference}`);
    const verifyResult = await this.client.verifyTransfer(payout.paystack_transfer_reference);

    // 3. Apply authoritative result in short database transaction
    const { data: reconcileResult, error: recError } = await supabase.rpc(
      'reconcile_partner_payout_status',
      {
        p_payout_id: payoutId,
        p_authoritative_status: verifyResult.status,
        p_notes: verifyResult.failureReason || verifyResult.message || adminReason || 'Reconciliation update',
        p_paystack_transfer_code: verifyResult.transferCode || payout.paystack_transfer_code || null,
        p_paystack_response: verifyResult.rawResponse || {},
      }
    );

    if (recError) {
      throw new Error(`Reconciliation RPC failed: ${recError.message}`);
    }

    return {
      success: true,
      payoutId,
      priorStatus: payout.status,
      newStatus: reconcileResult?.status || payout.status,
      transferReference: payout.paystack_transfer_reference,
      resolution: verifyResult.status,
      message: reconcileResult?.message || `Payout reconciled to status: ${verifyResult.status}`,
    };
  }

  /**
   * Watchdog function to detect stale payouts stuck in 'processing' > 30 minutes
   */
  public async checkStaleProcessingPayouts(): Promise<{ checked: number; flagged: number }> {
    const supabase = getServerSupabase();
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: stalePayouts, error } = await supabase
      .from('partner_payouts')
      .select('id, paystack_transfer_reference')
      .eq('status', 'processing')
      .lt('processing_started_at', thirtyMinsAgo);

    if (error || !stalePayouts) {
      console.error('[PayoutService] Error querying stale payouts:', error?.message);
      return { checked: 0, flagged: 0 };
    }

    let flagged = 0;
    for (const p of stalePayouts) {
      try {
        await this.reconcilePartnerPayout(p.id, 'Watchdog: stuck in processing > 30 minutes');
        flagged++;
      } catch (err: any) {
        console.error(`[PayoutService] Watchdog reconciliation failed for payout ${p.id}:`, err.message);
      }
    }

    return { checked: stalePayouts.length, flagged };
  }
}

let defaultService: PayoutService | null = null;

export function getPayoutService(): PayoutService {
  if (!defaultService) {
    defaultService = new PayoutService();
  }
  return defaultService;
}
