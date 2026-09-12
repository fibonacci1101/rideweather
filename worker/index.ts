import { Hono, type Context } from 'hono';
import route from './routes/route';
import weather from './routes/weather';

export type Env = {
  RWGPS_API_KEY: string;
  OWM_API_KEY: string;
  ROUTE_RATE_LIMITER: RateLimit;
  WEATHER_RATE_LIMITER: RateLimit;
};

const app = new Hono<{ Bindings: Env }>();

// public/_headers はWorkerが処理するレスポンス(/api/*)には適用されないため、ここで明示的に付与する。
// public/_headers と同じ内容を維持すること(食い違うとAPIだけ防御レベルが下がる)。
// Cache APIから返るレスポンスはheadersが不変(immutable)なため、直接setはせずコピーしてから新しいResponseを作る
function applySecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

app.use('*', async (c, next) => {
  await next();
  c.res = applySecurityHeaders(c.res);
});

// 認証なしで公開しているAPIプロキシが、雑なスクリプトから直接叩かれて
// RWGPS/OWMのAPI割当を無関係な用途で消費する「踏み台」利用の抑止策。
// Origin/Refererはヘッダー詐称で回避できるため主目的の防御ではなく、
// あくまで多層防御の1枚(判定不能な場合は正規ユーザーを誤って弾かないよう許可する)
function isSameOriginRequest(c: Context<{ Bindings: Env }>): boolean {
  const expectedOrigin = new URL(c.req.url).origin;

  const origin = c.req.header('origin');
  if (origin) return origin === expectedOrigin;

  const referer = c.req.header('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return true;
}

app.use('/api/*', async (c, next) => {
  if (!isSameOriginRequest(c)) {
    console.warn('[origin-check-failed]', {
      path: c.req.path,
      origin: c.req.header('origin'),
      referer: c.req.header('referer'),
    });
    return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});

// 下流ハンドラの未捕捉例外はミドルウェアチェーンを素通りしてHonoのデフォルト500になり、
// 上のミドルウェアを経由しないため、ここでも同じヘッダーを明示的に付与する
app.onError((err, c) => {
  console.error('[unhandled-error]', { message: err.message, path: c.req.path });
  return applySecurityHeaders(c.json({ error: 'internal server error' }, 500));
});

app.route('/api/route', route);
app.route('/api/weather', weather);

export default app;
