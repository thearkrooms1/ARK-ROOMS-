import dotenv from 'dotenv';

dotenv.config();

/**
 * Result classification types for Paystack transfer operations
 */
export type TransferInitiateResultType =
  | 'SUCCESS'
  | 'PENDING'
  | 'DEFINITIVE_FAILURE'
  | 'UNCERTAIN';

export interface TransferInitiateResponse {
  type: TransferInitiateResultType;
  status: 'success' | 'pending' | 'processing' | 'failed' | 'reconciliation_required';
  reference: string;
  transferCode?: string;
  amountKobo?: number;
  message?: string;
  httpStatus?: number;
  isTimeout?: boolean;
  rawResponse?: any;
}

export type TransferVerifyStatus =
  | 'success'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'reversed'
  | 'not_found'
  | 'uncertain';

export interface TransferVerifyResponse {
  status: TransferVerifyStatus;
  reference: string;
  transferCode?: string;
  amountKobo?: number;
  currency?: string;
  message?: string;
  failureReason?: string;
  httpStatus?: number;
  isTimeout?: boolean;
  rawResponse?: any;
}

export interface InitiateTransferParams {
  recipientCode: string;
  amountKobo: number;
  reference: string;
  reason: string;
  currency?: string;
}

/**
 * Server-only Paystack Transfer Client
 * Enforces authoritative financial fields and strict error classification.
 * PAYSTACK_SECRET_KEY is never logged or exposed.
 */
export class PaystackTransferClient {
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
   * Initiates a single partner payout transfer via Paystack Transfer API
   * POST /transfer
   */
  public async initiateTransfer(params: InitiateTransferParams): Promise<TransferInitiateResponse> {
    const { recipientCode, amountKobo, reference, reason, currency = 'NGN' } = params;

    // Strict input guards
    if (!recipientCode || typeof recipientCode !== 'string' || recipientCode.trim().length === 0) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: 'Invalid or missing Paystack recipient code',
      };
    }

    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: `Transfer amount must be a positive integer in kobo (received: ${amountKobo})`,
      };
    }

    if (!reference || typeof reference !== 'string' || reference.trim().length === 0) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: 'Permanent transfer reference is required',
      };
    }

    if (currency !== 'NGN') {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: `Currency must be NGN (received: ${currency})`,
      };
    }

    if (!this.isConfigured()) {
      return {
        type: 'DEFINITIVE_FAILURE',
        status: 'failed',
        reference,
        message: 'PAYSTACK_SECRET_KEY is not configured on server',
      };
    }

    const payload = {
      source: 'balance',
      amount: amountKobo,
      recipient: recipientCode.trim(),
      reference: reference.trim(),
      currency: 'NGN',
      reason: reason.trim().slice(0, 100),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      let data: any = null;
      try {
        data = await response.json();
      } catch (jsonErr: any) {
        // Response received from server but malformed JSON: Treat as UNCERTAIN
        console.error('[Paystack Transfer] Failed to parse JSON response:', jsonErr.message);
        return {
          type: 'UNCERTAIN',
          status: 'reconciliation_required',
          reference,
          message: 'Received non-JSON response from Paystack',
          httpStatus: response.status,
        };
      }

      // Handle HTTP 5xx: Uncertain server outcome
      if (response.status >= 500) {
        console.warn(`[Paystack Transfer] 5xx Server Error (${response.status}) from Paystack for ref: ${reference}`);
        return {
          type: 'UNCERTAIN',
          status: 'reconciliation_required',
          reference,
          message: `Paystack server error (HTTP ${response.status})`,
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      // Handle HTTP 4xx or Paystack business error
      if (response.status >= 400 || !data?.status) {
        console.warn(`[Paystack Transfer] 4xx/Rejection (${response.status}) for ref: ${reference}: ${data?.message}`);
        return {
          type: 'DEFINITIVE_FAILURE',
          status: 'failed',
          reference,
          message: data?.message || `Paystack request rejected with HTTP ${response.status}`,
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      // Success or Pending transfer response from Paystack
      const txData = data.data || {};
      const returnedStatus = String(txData.status || '').toLowerCase().trim();
      const transferCode = txData.transfer_code || undefined;

      if (returnedStatus === 'success') {
        return {
          type: 'SUCCESS',
          status: 'success',
          reference,
          transferCode,
          amountKobo: txData.amount,
          message: data.message || 'Transfer completed successfully',
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      // 'pending', 'processing', 'otp'
      return {
        type: 'PENDING',
        status: 'pending',
        reference,
        transferCode,
        amountKobo: txData.amount,
        message: data.message || 'Transfer accepted and is processing',
        httpStatus: response.status,
        rawResponse: data,
      };
    } catch (err: any) {
      clearTimeout(timer);

      const isAbort = err.name === 'AbortError' || err.code === 'ABORT_ERR';
      console.warn(`[Paystack Transfer] Network error/timeout for ref ${reference}: ${err.message}`);

      // Rule 6: A network timeout is NOT a transfer failure -> MUST be classified as UNCERTAIN
      return {
        type: 'UNCERTAIN',
        status: 'reconciliation_required',
        reference,
        message: isAbort ? 'Network timeout waiting for Paystack' : `Network error: ${err.message}`,
        isTimeout: isAbort,
      };
    }
  }

  /**
   * Verifies an existing transfer by permanent transfer reference
   * GET /transfer/verify/{reference}
   */
  public async verifyTransfer(reference: string): Promise<TransferVerifyResponse> {
    if (!reference || typeof reference !== 'string' || reference.trim().length === 0) {
      return {
        status: 'failed',
        reference: '',
        message: 'Permanent transfer reference is required for verification',
      };
    }

    if (!this.isConfigured()) {
      return {
        status: 'failed',
        reference,
        message: 'PAYSTACK_SECRET_KEY is not configured on server',
      };
    }

    const cleanRef = reference.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/transfer/verify/${encodeURIComponent(cleanRef)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      let data: any = null;
      try {
        data = await response.json();
      } catch (jsonErr: any) {
        return {
          status: 'uncertain',
          reference: cleanRef,
          message: 'Received non-JSON response from Paystack verification endpoint',
          httpStatus: response.status,
        };
      }

      if (response.status === 404 || (!data?.status && String(data?.message || '').toLowerCase().includes('not found'))) {
        return {
          status: 'not_found',
          reference: cleanRef,
          message: data?.message || 'Transfer reference not found on Paystack',
          httpStatus: 404,
          rawResponse: data,
        };
      }

      if (response.status >= 500) {
        return {
          status: 'uncertain',
          reference: cleanRef,
          message: `Paystack verification server error (HTTP ${response.status})`,
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      if (!response.ok || !data?.status) {
        return {
          status: 'failed',
          reference: cleanRef,
          message: data?.message || `Paystack verification error (HTTP ${response.status})`,
          failureReason: data?.message,
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      const txData = data.data || {};
      const returnedStatus = String(txData.status || '').toLowerCase().trim();

      if (returnedStatus === 'success') {
        return {
          status: 'success',
          reference: cleanRef,
          transferCode: txData.transfer_code,
          amountKobo: txData.amount,
          currency: txData.currency,
          message: 'Transfer verified successfully',
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      if (returnedStatus === 'failed') {
        return {
          status: 'failed',
          reference: cleanRef,
          transferCode: txData.transfer_code,
          failureReason: txData.reason || data.message || 'Transfer failed',
          message: 'Transfer marked failed by processor',
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      if (returnedStatus === 'reversed') {
        return {
          status: 'reversed',
          reference: cleanRef,
          transferCode: txData.transfer_code,
          failureReason: txData.reason || 'Transfer reversed by processor',
          message: 'Transfer was reversed by processor',
          httpStatus: response.status,
          rawResponse: data,
        };
      }

      // 'pending', 'processing', 'otp'
      return {
        status: 'pending',
        reference: cleanRef,
        transferCode: txData.transfer_code,
        amountKobo: txData.amount,
        currency: txData.currency,
        message: 'Transfer is pending processing with Paystack',
        httpStatus: response.status,
        rawResponse: data,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError' || err.code === 'ABORT_ERR';
      return {
        status: 'uncertain',
        reference: cleanRef,
        message: isAbort ? 'Verification network timeout' : `Network error: ${err.message}`,
        isTimeout: isAbort,
      };
    }
  }
}

let defaultClient: PaystackTransferClient | null = null;

export function getPaystackTransferClient(): PaystackTransferClient {
  if (!defaultClient) {
    defaultClient = new PaystackTransferClient();
  }
  return defaultClient;
}
