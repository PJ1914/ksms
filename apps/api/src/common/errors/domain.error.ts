/**
 * A business-rule violation raised by framework-free domain code (conversion, pricing, tax, ...).
 * The global exception filter turns it into a 422 response with the same stable `code`.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
