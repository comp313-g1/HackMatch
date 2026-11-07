import type {
  ReportApiErrorResponse,
  ReportReceiptDto,
  SubmitReportPayload,
} from './reportTypes';

export type SubmitModerationReportResult =
  | { ok: true; data: ReportReceiptDto }
  | { ok: false; status: number; error: ReportApiErrorResponse };

export async function submitModerationReport(
  payload: SubmitReportPayload,
  authToken?: string
): Promise<SubmitModerationReportResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken && authToken.trim().length > 0) {
    headers.Authorization = authToken.startsWith('Bearer ')
      ? authToken
      : `Bearer ${authToken}`;
  }

  try {
    const response = await fetch('/api/reports', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (response.ok && body.data) {
      return {
        ok: true,
        data: body.data as ReportReceiptDto,
      };
    }

    const nestedError =
      body.error && typeof body.error === 'object'
        ? (body.error as Record<string, unknown>)
        : null;

    const code =
      (typeof nestedError?.code === 'string' ? nestedError.code : null) ||
      (typeof body.code === 'string' ? body.code : null) ||
      (response.status === 429 ? 'RATE_LIMITED' : 'REPORT_SUBMISSION_FAILED');

    const message =
      (typeof nestedError?.message === 'string' ? nestedError.message : null) ||
      (typeof body.error === 'string' ? body.error : null) ||
      (typeof body.message === 'string' ? body.message : null) ||
      'Unable to submit report right now. Please try again.';

    const fieldErrors =
      (nestedError?.fieldErrors &&
      typeof nestedError.fieldErrors === 'object'
        ? (nestedError.fieldErrors as Record<string, string>)
        : undefined) ||
      (body.errors && typeof body.errors === 'object'
        ? (body.errors as Record<string, string>)
        : undefined);

    const retryAfterSeconds =
      typeof nestedError?.retryAfterSeconds === 'number'
        ? nestedError.retryAfterSeconds
        : typeof body.retryAfterSeconds === 'number'
          ? body.retryAfterSeconds
          : undefined;

    return {
      ok: false,
      status: response.status,
      error: {
        code,
        message,
        fieldErrors,
        retryAfterSeconds,
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: {
        code: 'NETWORK_ERROR',
        message:
          'Network error while submitting report. Your entered details have been preserved.',
      },
    };
  }
}
