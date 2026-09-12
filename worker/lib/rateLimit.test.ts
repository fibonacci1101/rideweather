import { describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from './rateLimit';

function makeLimiter(result: { success: boolean } | Error): RateLimit {
  return {
    limit: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as RateLimit;
}

describe('checkRateLimit', () => {
  it('limiterがsuccess:trueを返せばtrueを返す', async () => {
    const limiter = makeLimiter({ success: true });
    expect(await checkRateLimit(limiter, '1.2.3.4')).toBe(true);
  });

  it('limiterがsuccess:falseを返せばfalseを返す(レート制限超過)', async () => {
    const limiter = makeLimiter({ success: false });
    expect(await checkRateLimit(limiter, '1.2.3.4')).toBe(false);
  });

  it('渡したipがそのままキーとして使われる', async () => {
    const limiter = makeLimiter({ success: true });
    await checkRateLimit(limiter, '203.0.113.5');
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.5' });
  });

  it('ip="unknown"でも通常通り呼び出せる(専用バケットとして扱われる)', async () => {
    const limiter = makeLimiter({ success: true });
    expect(await checkRateLimit(limiter, 'unknown')).toBe(true);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'unknown' });
  });

  it('limiter.limit()が例外を投げた場合はfail-closed(false)になる', async () => {
    const limiter = makeLimiter(new Error('binding unavailable'));
    expect(await checkRateLimit(limiter, '1.2.3.4')).toBe(false);
  });
});
