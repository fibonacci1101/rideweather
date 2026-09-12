/**
 * IPごとのレート制限をチェックする。呼び出し側はキャッシュミス時(=上流API実呼び出し時)
 * のみ呼ぶこと。キャッシュヒットまで一律に制限すると乱用防止の意図に対して過剰に厳しくなるため。
 * @returns true: リクエスト許可 / false: レート制限超過(またはbinding障害時のfail-closed)
 */
export async function checkRateLimit(limiter: RateLimit, ip: string): Promise<boolean> {
  if (ip === 'unknown') {
    // 本番のCloudflareエッジでは通常発生しない(cf-connecting-ipが必ず付与される)ため、
    // 発生時は複数リクエストが同一バケットを共有してしまう兆候として記録しておく
    console.warn('[rate-limit-unknown-ip]');
  }
  try {
    const { success } = await limiter.limit({ key: ip });
    return success;
  } catch (err) {
    // binding障害時は fail-closed(拒否)にする。無料枠の乱用防止という本来の目的を優先するため
    console.error('[rate-limit-error]', { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
