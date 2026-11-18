import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from '../errors/app.exception';
import { DomainError } from '../errors/domain.error';

/** What a caller gets back for each kind of failure. */
function run(exception: unknown) {
  const sent: {
    status?: number;
    body?: { error: { code: string; message: string; details?: unknown } };
  } = {};
  const res = {
    status(s: number) {
      sent.status = s;
      return this;
    },
    json(b: never) {
      sent.body = b;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1', headers: {} }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return sent;
}

describe('AllExceptionsFilter', () => {
  it('a business-rule error is 422 with its own code and details', () => {
    const r = run(
      new DomainError('CREDIT_LIMIT_EXCEEDED', 'Over the limit', { available: '50.00' }),
    );
    expect(r.status).toBe(422);
    expect(r.body!.error).toMatchObject({
      code: 'CREDIT_LIMIT_EXCEEDED',
      details: { available: '50.00' },
      correlationId: 'req-1',
    });
  });

  it('an application error keeps its status and code', () => {
    const r = run(new AppException('SALE_NOT_FOUND', 'Sale not found', 404));
    expect([r.status, r.body!.error.code]).toEqual([404, 'SALE_NOT_FOUND']);
  });

  it('a plain HTTP error is given a standard code', () => {
    expect(run(new HttpException('no', 403)).body!.error.code).toBe('FORBIDDEN');
  });

  it('a duplicate value is 409', () => {
    expect(run({ code: 'P2002' }).status).toBe(409);
  });

  it.each(['P2028', 'P2024'])(
    'a database that is too slow (%s) is a clear, retryable 503, never a mystery 500',
    (code) => {
      const r = run({ code });
      expect(r.status).toBe(503);
      expect(r.body!.error.code).toBe('SERVER_TOO_SLOW');
      expect(r.body!.error.message).toMatch(/Nothing was saved/);
    },
  );

  it('anything unexpected is a 500 that leaks nothing', () => {
    const r = run(new Error('relation "secret_table" does not exist'));
    expect(r.status).toBe(500);
    expect(r.body!.error.message).toBe('Something went wrong on our side');
    expect(JSON.stringify(r.body)).not.toContain('secret_table');
  });
});
