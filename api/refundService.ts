import { getServerSupabase } from './index';
import { getPaystackRefundClient, PaystackRefundClient } from './paystackRefund';

export interface ExecuteRefundResult {
  success: boolean;
  refundOperationId: string;
  bookingId?: string;
  status: string;
  paystackReference: string;
  paystackRefundId?: string;
  amountNGN: number;
  message: string;
  isIdempotent?: boolean;
  ledgerPosted?: boolean;
}

export interface ReconcileRefundResult {
  success: boolean;
  refundOperationId: string;
  priorStatus: string;
  newStatus: string;
  paystackReference: string;
  resolution: string;
  message: string;
  amountNGN?: number;
  ledgerPosted?: boolean;
}

/**
 * RefundService
 * Coordinates authoritative database authorization, non-blocking external Paystack dispatch,
 * and double-entry ledger settlement for refunds.
 *
 * ABSOLUTE INVARIANTS:
 * 1. NO Paystack HTTP request inside a PostgreSQL database transaction.
 * 2. Refund amount is derived strictly from trusted database state.
 * 3. Exactly one permanent reference: ARK-RFD-{refund_operation_id}.
 * 4. Network timeouts are classified as UNCERTAIN -> reconciliation_required.
 * 5. Completed refunds are terminal.
 * 6. Tier 1 issues strictly have zero financial refund.
 * 7. Tier 2 issues without approved compensation fail safely.
 * 8. Tier 3 issues only execute the explicitly authorized refund_awarded_ngn.
 */
export class RefundService {
  private client: PaystackRefundClient;

  constructor(client?: PaystackRefundClient) {
    this.client = client || getPaystackRefundClient();
  }

  /**
   * Executes a refund for an eligible damage deposit
   */
  public async executeDamageDepositRefund(depositId: string, adminReason?: string): Promise<ExecuteRefundResult> {
    const supabase = getServerSupabase();

    // 1. Fetch deposit to get booking_id
    const { data: deposit, error: depErr } = await supabase
      .from('damage_deposits')
      .select('id, booking_id, status, deposit_amount_ngn, retained_amount_ngn, refunded_amount_ngn')
      .eq('id', depositId)
      .maybeSingle();

    if (depErr || !deposit) {
      return {
        success: false,
        refundOperationId: '',
        status: 'not_found',
        paystackReference: '',
        amountNGN: 0,
        message: `Damage deposit ${depositId} not found`,
      };
    }

    return this.dispatchRefundFlow({
      bookingId: deposit.booking_id,
      refundCategory: 'damage_deposit',
      depositId: deposit.id,
      reason: adminReason || `Damage deposit refund for deposit ${depositId}`,
    });
  }

  /**
   * Executes a refund for an adjudicated booking issue
   */
  public async executeIssueRefund(issueId: string, adminReason?: string): Promise<ExecuteRefundResult> {
    const supabase = getServerSupabase();

    // 1. Fetch issue record to get booking_id and validate tier
    const { data: issue, error: issueErr } = await supabase
      .from('booking_issues')
      .select('id, booking_id, issue_tier, status, refund_awarded_ngn')
      .eq('id', issueId)
      .maybeSingle();

    if (issueErr || !issue) {
      return {
        success: false,
        refundOperationId: '',
        status: 'not_found',
        paystackReference: '',
        amountNGN: 0,
        message: `Booking issue ${issueId} not found`,
      };
    }

    // Strict Tier 1 guard
    if (issue.issue_tier === 'tier_1') {
      return {
        success: false,
        refundOperationId: '',
        bookingId: issue.booking_id,
        status: 'rejected_tier1',
        paystackReference: '',
        amountNGN: 0,
        message: 'Tier 1 issues do not authorize financial compensation or refunds.',
      };
    }

    // Tier 2 safe failure if unconfigured
    if (issue.issue_tier === 'tier_2' && (!issue.refund_awarded_ngn || issue.refund_awarded_ngn <= 0)) {
      return {
        success: false,
        refundOperationId: '',
        bookingId: issue.booking_id,
        status: 'policy_unconfigured',
        paystackReference: '',
        amountNGN: 0,
        message: 'Tier 2 compensation policy is unconfigured or zero for this issue; execution halted safely.',
      };
    }

    // Tier 3 only uses authorized amount
    if (!issue.refund_awarded_ngn || issue.refund_awarded_ngn <= 0) {
      return {
        success: false,
        refundOperationId: '',
        bookingId: issue.booking_id,
        status: 'no_authorized_amount',
        paystackReference: '',
        amountNGN: 0,
        message: 'Issue has no authorized refund amount (refund_awarded_ngn <= 0).',
      };
    }

    return this.dispatchRefundFlow({
      bookingId: issue.booking_id,
      refundCategory: 'guest_assurance_issue',
      issueId: issue.id,
      reason: adminReason || `Guest assurance compensation for Issue ${issueId}`,
    });
  }

  /**
   * Internal core 8-step refund dispatch coordinator
   */
  private async dispatchRefundFlow(params: {
    bookingId: string;
    refundCategory: string;
    depositId?: string;
    issueId?: string;
    reason: string;
  }): Promise<ExecuteRefundResult> {
    const supabase = getServerSupabase();

    // -------------------------------------------------------------------------
    // Step 1: Execute Authorization RPC
    // Canonical locks -> Validates trusted amounts -> Creates refund_operation in 'authorized' status
    // -------------------------------------------------------------------------
    const { data: initResult, error: initErr } = await supabase.rpc('initialize_refund_operation', {
      p_booking_id: params.bookingId,
      p_refund_category: params.refundCategory,
      p_deposit_id: params.depositId || null,
      p_issue_id: params.issueId || null,
      p_reason: params.reason,
    });

    if (initErr) {
      console.error('[RefundService] Initialization RPC failed:', initErr.message);
      return {
        success: false,
        refundOperationId: '',
        bookingId: params.bookingId,
        status: 'initialization_failed',
        paystackReference: '',
        amountNGN: 0,
        message: initErr.message,
      };
    }

    if (!initResult?.success) {
      return {
        success: false,
        refundOperationId: initResult?.refund_operation_id || '',
        bookingId: params.bookingId,
        status: initResult?.status || 'rejected',
        paystackReference: initResult?.paystack_reference || '',
        amountNGN: initResult?.amount_ngn || 0,
        message: initResult?.message || 'Refund initialization rejected by database constraints',
      };
    }

    // Idempotency: if already completed or active
    if (initResult.already_exists) {
      return {
        success: true,
        refundOperationId: initResult.refund_operation_id,
        bookingId: params.bookingId,
        status: initResult.status,
        paystackReference: initResult.paystack_reference,
        amountNGN: Number(initResult.amount_ngn),
        isIdempotent: true,
        message: initResult.message,
      };
    }

    const refundOpId = initResult.refund_operation_id;
    const paystackRef = initResult.paystack_reference;
    const amountNGN = Number(initResult.amount_ngn);
    const amountKobo = Math.round(amountNGN * 100);
    const txnRef = initResult.transaction_reference;

    // -------------------------------------------------------------------------
    // Step 2: Mark Operation as 'processing' (Separate DB transaction)
    // -------------------------------------------------------------------------
    const { error: markErr } = await supabase.rpc('mark_refund_processing', {
      p_refund_id: refundOpId,
    });

    if (markErr) {
      console.error('[RefundService] Mark processing failed:', markErr.message);
      return {
        success: false,
        refundOperationId: refundOpId,
        bookingId: params.bookingId,
        status: 'processing_mark_failed',
        paystackReference: paystackRef,
        amountNGN,
        message: markErr.message,
      };
    }

    // -------------------------------------------------------------------------
    // Step 3: Outbound Paystack Refund Request (OUTSIDE DATABASE TRANSACTION)
    // Absolute rule: No DB lock held during network I/O
    // -------------------------------------------------------------------------
    console.log(`[RefundService] Initiating Paystack refund: ref=${paystackRef}, amountKobo=${amountKobo}, txn=${txnRef}`);
    const refundResponse = await this.client.initiateRefund({
      transactionReferenceOrId: txnRef,
      amountKobo,
      reference: paystackRef,
      customerNote: params.reason,
      merchantNote: paystackRef,
      currency: 'NGN',
    });

    // -------------------------------------------------------------------------
    // Step 4: Persist Result in Separate Database Transaction
    // -------------------------------------------------------------------------
    // Case A: Confirmed Success
    if (refundResponse.type === 'SUCCESS') {
      console.log(`[RefundService] Refund confirmed by Paystack for ref: ${paystackRef}`);
      const { data: settleData, error: settleErr } = await supabase.rpc('settle_refund_success', {
        p_refund_id: refundOpId,
        p_paystack_refund_id: refundResponse.refundId || null,
        p_gateway_response: refundResponse.rawResponse || {},
      });

      if (settleErr) {
        console.error('[RefundService] Settlement RPC failed:', settleErr.message);
        return {
          success: false,
          refundOperationId: refundOpId,
          bookingId: params.bookingId,
          status: 'settlement_failed',
          paystackReference: paystackRef,
          amountNGN,
          message: settleErr.message,
        };
      }

      return {
        success: true,
        refundOperationId: refundOpId,
        bookingId: params.bookingId,
        status: 'completed',
        paystackReference: paystackRef,
        paystackRefundId: refundResponse.refundId,
        amountNGN,
        ledgerPosted: settleData?.ledger_posted || false,
        isIdempotent: settleData?.already_completed || false,
        message: 'Refund executed and settled successfully via Paystack.',
      };
    }

    // Case B: In-Flight / Queued Pending
    if (refundResponse.type === 'PENDING') {
      console.log(`[RefundService] Refund queued/pending for ref: ${paystackRef}`);
      if (refundResponse.refundId) {
        await supabase
          .from('refund_operations')
          .update({
            paystack_refund_id: refundResponse.refundId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', refundOpId);
      }

      return {
        success: true,
        refundOperationId: refundOpId,
        bookingId: params.bookingId,
        status: 'processing',
        paystackReference: paystackRef,
        paystackRefundId: refundResponse.refundId,
        amountNGN,
        message: 'Refund accepted by Paystack and queued for processing.',
      };
    }

    // Case C: Definitive Failure (HTTP 4xx)
    if (refundResponse.type === 'DEFINITIVE_FAILURE') {
      console.warn(`[RefundService] Definitive refund failure for ref ${paystackRef}: ${refundResponse.message}`);
      await supabase.rpc('record_refund_failure', {
        p_refund_id: refundOpId,
        p_failure_code: String(refundResponse.httpStatus || 'PAYSTACK_4XX'),
        p_failure_message: refundResponse.message || 'Refund rejected by payment gateway',
        p_gateway_response: refundResponse.rawResponse || {},
      });

      return {
        success: false,
        refundOperationId: refundOpId,
        bookingId: params.bookingId,
        status: 'failed',
        paystackReference: paystackRef,
        amountNGN,
        message: refundResponse.message || 'Refund rejected definitively by Paystack',
      };
    }

    // Case D: Uncertain Outcome (Timeout / 5xx) -> reconciliation_required
    console.warn(`[RefundService] Uncertain refund outcome for ref ${paystackRef}: ${refundResponse.message}`);
    await supabase.rpc('flag_refund_reconciliation', {
      p_refund_id: refundOpId,
      p_reason: refundResponse.message || 'Timeout or uncertain network response during refund call',
      p_gateway_response: refundResponse.rawResponse || {},
    });

    return {
      success: false,
      refundOperationId: refundOpId,
      bookingId: params.bookingId,
      status: 'reconciliation_required',
      paystackReference: paystackRef,
      amountNGN,
      message: 'Refund outcome uncertain (timeout/network error); flagged for reconciliation.',
    };
  }

  /**
   * Authoritative reconciliation of an uncertain refund against Paystack
   */
  public async reconcileRefund(refundId: string, adminReason: string): Promise<ReconcileRefundResult> {
    const supabase = getServerSupabase();

    // 1. Fetch current refund record
    const { data: refund, error } = await supabase
      .from('refund_operations')
      .select('id, status, paystack_reference, paystack_refund_id, amount_ngn')
      .eq('id', refundId)
      .maybeSingle();

    if (error || !refund) {
      throw new Error(`Refund operation ${refundId} not found: ${error?.message}`);
    }

    if (refund.status === 'completed') {
      return {
        success: true,
        refundOperationId: refundId,
        priorStatus: 'completed',
        newStatus: 'completed',
        paystackReference: refund.paystack_reference,
        resolution: 'already_completed',
        message: 'Refund operation is already in terminal completed state.',
        amountNGN: Number(refund.amount_ngn),
      };
    }

    // 2. Lock operation via RPC & audit reason
    const { error: prepErr } = await supabase.rpc('admin_reconcile_refund', {
      p_refund_id: refundId,
      p_reason: adminReason,
    });

    if (prepErr) {
      throw new Error(`Failed to initialize refund reconciliation: ${prepErr.message}`);
    }

    // 3. Query Paystack outside DB lock using permanent reference or refundId
    const queryIdentifier = refund.paystack_refund_id || refund.paystack_reference;
    console.log(`[RefundService] Reconciling refund with Paystack: identifier=${queryIdentifier}`);
    const verifyRes = await this.client.verifyRefund(queryIdentifier);

    // 4. Re-enter separate DB transaction to apply verified state
    if (verifyRes.status === 'success') {
      const { data: settleData, error: settleErr } = await supabase.rpc('settle_refund_success', {
        p_refund_id: refundId,
        p_paystack_refund_id: verifyRes.refundId || refund.paystack_refund_id || null,
        p_gateway_response: verifyRes.rawResponse || {},
      });

      if (settleErr) {
        throw new Error(`Settlement failed during reconciliation: ${settleErr.message}`);
      }

      return {
        success: true,
        refundOperationId: refundId,
        priorStatus: refund.status,
        newStatus: 'completed',
        paystackReference: refund.paystack_reference,
        resolution: 'reconciled_success',
        amountNGN: Number(refund.amount_ngn),
        ledgerPosted: settleData?.ledger_posted || false,
        message: 'Refund confirmed by Paystack and settled successfully.',
      };
    }

    if (verifyRes.status === 'failed' || verifyRes.status === 'not_found') {
      await supabase.rpc('record_refund_failure', {
        p_refund_id: refundId,
        p_failure_code: 'RECONCILED_FAILED',
        p_failure_message: verifyRes.message || 'Refund confirmed failed or not found during reconciliation',
        p_gateway_response: verifyRes.rawResponse || {},
      });

      return {
        success: true,
        refundOperationId: refundId,
        priorStatus: refund.status,
        newStatus: 'failed',
        paystackReference: refund.paystack_reference,
        resolution: 'reconciled_failed',
        amountNGN: Number(refund.amount_ngn),
        message: 'Refund confirmed failed by Paystack during reconciliation.',
      };
    }

    // Still uncertain / processing
    return {
      success: false,
      refundOperationId: refundId,
      priorStatus: refund.status,
      newStatus: 'reconciliation_required',
      paystackReference: refund.paystack_reference,
      resolution: 'still_uncertain',
      amountNGN: Number(refund.amount_ngn),
      message: `Paystack refund status remains ${verifyRes.status}; retained in reconciliation_required.`,
    };
  }

  /**
   * Safe retry for a failed or uncertain refund operation
   * Reuses the exact same permanent reference ARK-RFD-{refund_id}
   */
  public async safeRetryRefund(refundId: string, adminReason: string): Promise<ExecuteRefundResult> {
    const supabase = getServerSupabase();

    const { data: refund, error } = await supabase
      .from('refund_operations')
      .select('id, booking_id, status, amount_ngn, paystack_reference, payment_id')
      .eq('id', refundId)
      .maybeSingle();

    if (error || !refund) {
      return {
        success: false,
        refundOperationId: refundId,
        status: 'not_found',
        paystackReference: '',
        amountNGN: 0,
        message: `Refund operation ${refundId} not found`,
      };
    }

    if (refund.status === 'completed') {
      return {
        success: true,
        refundOperationId: refundId,
        status: 'completed',
        paystackReference: refund.paystack_reference,
        amountNGN: Number(refund.amount_ngn),
        isIdempotent: true,
        message: 'Refund operation is already completed; cannot retry.',
      };
    }

    // First, verify with Paystack to ensure no phantom refund succeeded
    const verifyRes = await this.client.verifyRefund(refund.paystack_reference);
    if (verifyRes.status === 'success') {
      const { data: settleData } = await supabase.rpc('settle_refund_success', {
        p_refund_id: refundId,
        p_paystack_refund_id: verifyRes.refundId || null,
        p_gateway_response: verifyRes.rawResponse || {},
      });

      return {
        success: true,
        refundOperationId: refundId,
        bookingId: refund.booking_id,
        status: 'completed',
        paystackReference: refund.paystack_reference,
        amountNGN: Number(refund.amount_ngn),
        ledgerPosted: settleData?.ledger_posted || false,
        message: 'Refund was already completed upstream; state synchronized.',
      };
    }

    // Mark processing
    await supabase.rpc('mark_refund_processing', { p_refund_id: refundId });

    // Lookup payment transaction reference
    const { data: payment } = await supabase
      .from('payments')
      .select('transaction_reference')
      .eq('id', refund.payment_id)
      .maybeSingle();

    const txnRef = payment?.transaction_reference;
    if (!txnRef) {
      return {
        success: false,
        refundOperationId: refundId,
        status: 'failed',
        paystackReference: refund.paystack_reference,
        amountNGN: Number(refund.amount_ngn),
        message: 'Missing original payment transaction reference for retry.',
      };
    }

    const amountKobo = Math.round(Number(refund.amount_ngn) * 100);

    // Call Paystack outside DB lock with exact same permanent reference
    const refundResponse = await this.client.initiateRefund({
      transactionReferenceOrId: txnRef,
      amountKobo,
      reference: refund.paystack_reference,
      customerNote: adminReason,
      merchantNote: refund.paystack_reference,
      currency: 'NGN',
    });

    if (refundResponse.type === 'SUCCESS') {
      const { data: settleData } = await supabase.rpc('settle_refund_success', {
        p_refund_id: refundId,
        p_paystack_refund_id: refundResponse.refundId || null,
        p_gateway_response: refundResponse.rawResponse || {},
      });

      return {
        success: true,
        refundOperationId: refundId,
        bookingId: refund.booking_id,
        status: 'completed',
        paystackReference: refund.paystack_reference,
        amountNGN: Number(refund.amount_ngn),
        ledgerPosted: settleData?.ledger_posted || false,
        message: 'Refund retry succeeded and settled.',
      };
    }

    if (refundResponse.type === 'DEFINITIVE_FAILURE') {
      await supabase.rpc('record_refund_failure', {
        p_refund_id: refundId,
        p_failure_code: String(refundResponse.httpStatus || 'RETRY_FAILED'),
        p_failure_message: refundResponse.message || 'Retry rejected by payment gateway',
        p_gateway_response: refundResponse.rawResponse || {},
      });

      return {
        success: false,
        refundOperationId: refundId,
        bookingId: refund.booking_id,
        status: 'failed',
        paystackReference: refund.paystack_reference,
        amountNGN: Number(refund.amount_ngn),
        message: refundResponse.message || 'Refund retry failed definitively.',
      };
    }

    // Uncertain
    await supabase.rpc('flag_refund_reconciliation', {
      p_refund_id: refundId,
      p_reason: refundResponse.message || 'Retry outcome uncertain',
      p_gateway_response: refundResponse.rawResponse || {},
    });

    return {
      success: false,
      refundOperationId: refundId,
      bookingId: refund.booking_id,
      status: 'reconciliation_required',
      paystackReference: refund.paystack_reference,
      amountNGN: Number(refund.amount_ngn),
      message: 'Refund retry outcome uncertain; flagged for reconciliation.',
    };
  }
}

let refundServiceInstance: RefundService | null = null;

export function getRefundService(): RefundService {
  if (!refundServiceInstance) {
    refundServiceInstance = new RefundService();
  }
  return refundServiceInstance;
}
