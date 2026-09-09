import dotenv from 'dotenv';

dotenv.config();

/**
 * Result classification types for Paystack refund operations
 */
export type RefundInitiateResultType =
  | 'SUCCESS'
  | 'PENDING'
  | 'DEFINITIVE_FAILURE'
  | 'UNCERTAIN';

export interface RefundInitiateResponse {
  type: RefundInitiateResultType;
  status: 'success' | 'pending' | 'processing' | 'failed' | 'reconciliation_required';
  reference: string;
  refundId?: string;
  amountKobo?: number;
  message?: string;
  httpStatus?: number;
  isTimeout?: boolean;
  rawResponse?: any;
}

export type RefundVerifyStatus =
  | 'success'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'not_found'
  | 'uncertain';

export interface RefundVerifyResponse {
  status: RefundVerifyStatus;
  reference: string;
  refundId?: string;
  amountKobo?: number;
  currency?: string;
  message?: string;
  failureReason?: string;
  httpStatus?: number;
  isTimeout?: boolean;
  rawResponse?: any;
}

export interface InitiateRefundParams {
  transactionReferenceOrId: string;
  amountKobo: number;
  reference: string; // Internal immutable reference: ARK-RFD-{id}
  customerNote?: string;
  merchantNote?: string;
  currency?: string;
}

/**
 * Server-only Paystack Refund Client
 * Enforces authoritative financial fields, timeout boundaries, and strict outcome classification.
 * PAYSTACK_SECRET_KEY is never logged or exposed.
 */
export class PaystackRefundClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(secretKey?: string, baseUrl = 'https://api.paystack.co', timeoutMs = 15000) {
    this.secretKey = (secretKey || process.env.PAYSTACK_SECRET_KEY || '').trim();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  public isConfigured(): boolean {
    return Boolean(this.secretKey && this.secretKey.length > 0);
  }

  /**
   * Initiates a refund via Paystack Refund API
   * POST /refund
   */
  public async initiateRefund(params: InitiateRefundParams): Promise<RefundInitiateResponse> {
    const {
      transactionReferenceOrId,
      amountKobo,
      reference,
      customerNote = 'TheArk Rooms reservation refund',
      merchantNote = reference,
      currency = 'NGN',
    } = params;

    // Strict input guards
    if (!transactionReferenceOrId || typeof transactionReferenceOrId !== 'string' || transactionReferenceOrId.trim().length === 0) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: 'Invalid or missing Paystack transaction identifier',
      };
    }

    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: `Refund amount must be a positive integer in kobo (received: ${amountKobo})`,
      };
    }

    if (!reference || !reference.startsWith('ARK-RFD-')) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: `Refund reference must start with 'ARK-RFD-' (received: ${reference})`,
      };
    }

    if (!this.isConfigured()) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: 'PAYSTACK_SECRET_KEY is not configured in environment',
      };
    }

    const payload = {
      transaction: transactionReferenceOrId.trim(),
      amount: amountKobo,
      currency,
      customer_note: customerNote,
      merchant_note: merchantNote,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/refund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let responseBody: any;
      try {
        responseBody = await response.json();
      } catch (err) {
        responseBody = { raw: 'Non-JSON response from Paystack' };
      }

      const httpStatus = response.status;

      // 1. Success or Queued (HTTP 200/201)
      if (httpStatus >= 200 && httpStatus < 300 && responseBody?.status === true) {
        const refundData = responseBody.data || {};
        const refundStatus = (refundData.status || '').toLowerCase();
        const refundId = String(refundData.id || refundData.refund_id || '');

        if (refundStatus === 'success' || refundStatus === 'processed') {
          return {
            type: 'SUCCESS',
            status: 'success',
            reference,
            refundId: refundId || undefined,
            amountKobo: refundData.amount || amountKobo,
            message: responseBody.message || 'Refund successfully processed by Paystack',
            httpStatus,
            rawResponse: responseBody,
          };
        }

        // Refund queued / pending
        return {
          type: 'PENDING',
          status: 'processing',
          reference,
          refundId: refundId || undefined,
          amountKobo: refundData.amount || amountKobo,
          message: responseBody.message || 'Refund accepted and is pending processing',
          httpStatus,
          rawResponse: responseBody,
        };
      }

      // 2. Client Errors (HTTP 4xx) -> DEFINITIVE FAILURE
      if (httpStatus >= 400 && httpStatus < 500) {
        return {
          type: 'DEFINITIVE_FAILURE',
          status: 'failed',
          reference,
          message: responseBody?.message || `Paystack refund rejected with HTTP ${httpStatus}`,
          httpStatus,
          rawResponse: responseBody,
        };
      }

      // 3. Server Errors (HTTP 5xx) -> UNCERTAIN OUTCOME
      return {
        type: 'UNCERTAIN',
        status: 'reconciliation_required',
        reference,
        message: responseBody?.message || `Paystack server error (HTTP ${httpStatus}); refund outcome uncertain`,
        httpStatus,
        rawResponse: responseBody,
      };
    } catch (networkError: any) {
      clearTimeout(timeoutId);

      const isTimeout = networkError?.name === 'AbortError' || networkError?.code === 'ETIMEDOUT';
      return {
        type: 'UNCERTAIN',
        status: 'reconciliation_required',
        reference,
        isTimeout,
        message: isTimeout
          ? `Paystack refund request timed out after ${this.timeoutMs}ms; outcome uncertain`
          : `Network error during Paystack refund dispatch: ${networkError?.message || 'unknown'}`,
        rawResponse: { error: networkError?.message, code: networkError?.code },
      };
    }
  }

  /**
   * Verifies the authoritative state of a refund with Paystack
   * GET /refund/:id
   */
  public async verifyRefund(refundReferenceOrId: string): Promise<RefundVerifyResponse> {
    if (!refundReferenceOrId || typeof refundReferenceOrId !== 'string' || refundReferenceOrId.trim().length === 0) {
      return {
        status: 'failed',
        reference: refundReferenceOrId,
        message: 'Invalid refund identifier provided for verification',
      };
    }

    if (!this.isConfigured()) {
      return {
        status: 'uncertain',
        reference: refundReferenceOrId,
        message: 'PAYSTACK_SECRET_KEY not configured',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/refund/${encodeURIComponent(refundReferenceOrId.trim())}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let body: any;
      try {
        body = await response.json();
      } catch (err) {
        body = { raw: 'Non-JSON response' };
      }

      const httpStatus = response.status;

      if (httpStatus === 404 || (httpStatus === 400 && body?.status === false)) {
        return {
          status: 'not_found',
          reference: refundReferenceOrId,
          message: body?.message || 'Refund record not found on Paystack',
          httpStatus,
          rawResponse: body,
        };
      }

      if (httpStatus >= 200 && httpStatus < 300 && body?.status === true) {
        const data = body.data || {};
        const rawStatus = (data.status || '').toLowerCase();
        const refundId = String(data.id || '');

        let classifiedStatus: RefundVerifyStatus = 'uncertain';
        if (rawStatus === 'success' || rawStatus === 'processed') {
          classifiedStatus = 'success';
        } else if (rawStatus === 'failed') {
          classifiedStatus = 'failed';
        } else if (rawStatus === 'pending' || rawStatus === 'processing') {
          classifiedStatus = 'processing';
        }

        return {
          status: classifiedStatus,
          reference: refundReferenceOrId,
          refundId: refundId || undefined,
          amountKobo: data.amount,
          currency: data.currency || 'NGN',
          message: body.message,
          failureReason: data.fully_deducted === false ? 'Refund deduction pending' : undefined,
          httpStatus,
          rawResponse: body,
        };
      }

      if (httpStatus >= 500) {
        return {
          status: 'uncertain',
          reference: refundReferenceOrId,
          message: `Paystack 5xx error (${httpStatus}) during refund verification`,
          httpStatus,
          rawResponse: body,
        };
      }

      return {
        status: 'failed',
        reference: refundReferenceOrId,
        message: body?.message || `Refund verification returned HTTP ${httpStatus}`,
        httpStatus,
        rawResponse: body,
      };
    } catch (networkErr: any) {
      clearTimeout(timeoutId);
      const isTimeout = networkErr?.name === 'AbortError';
      return {
        status: 'uncertain',
        reference: refundReferenceOrId,
        isTimeout,
        message: isTimeout
          ? `Refund verification timed out after ${this.timeoutMs}ms`
          : `Network error verifying refund: ${networkErr?.message}`,
        rawResponse: { error: networkErr?.message },
      };
    }
  }
}

let refundClientInstance: PaystackRefundClient | null = null;

export function getPaystackRefundClient(): PaystackRefundClient {
  if (!refundClientInstance) {
    refundClientInstance = new PaystackRefundClient();
  }
  return refundClientInstance;
}
