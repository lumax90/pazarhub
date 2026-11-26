export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** The exchange behind a provider error, kept for the error log; never shown to sellers as is. */
export interface ProviderExchange {
  request: string
  status?: number
  response?: string
}

export class ProviderError extends Error {
  detail?: ProviderExchange
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number,
    public readonly uncertain = false,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
