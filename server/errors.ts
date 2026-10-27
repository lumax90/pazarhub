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

export class ProviderError extends Error {
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
