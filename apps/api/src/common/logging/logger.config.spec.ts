import { createServer, type IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import pinoHttp, { type Options } from 'pino-http';
import request from 'supertest';
import { parseEnv } from '../../config/env';
import { isHealthProbe, loggerOptions } from './logger.config';

const env = parseEnv({
  DATABASE_URL: 'postgresql://u:p@host/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  PLATFORM_JWT_SECRET: 'p'.repeat(48),
  PLATFORM_MFA_KEY: Buffer.alloc(32, 1).toString('base64'),
  NODE_ENV: 'production',
});

/** A tiny app logging through the real options, capturing every line. */
function appWithCapturedLogs() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  const log = pinoHttp(loggerOptions(env).pinoHttp as Options, sink);
  const app = createServer((req, res) => {
    log(req, res);
    req.resume(); // the body is drained, never read into the log
    req.on('end', () => res.end('{"ok":true}'));
  });
  return { app, lines };
}

describe('request logging (FIXES F6)', () => {
  it('recognises health probes only', () => {
    const probe = (url: string) => isHealthProbe({ url } as IncomingMessage);
    expect(probe('/api/v1/health')).toBe(true);
    expect(probe('/api/v1/health/ready')).toBe(true);
    expect(probe('/api/v1/health?x=1')).toBe(true);
    expect(probe('/api/v1/healthy')).toBe(false);
    expect(probe('/api/v1/products')).toBe(false);
  });

  it('writes nothing for health probes', async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app).get('/api/v1/health');
    await request(app).get('/api/v1/health/ready');
    expect(lines).toEqual([]);
  });

  it('logs normal requests without tokens or request bodies', async () => {
    const { app, lines } = appWithCapturedLogs();
    await request(app)
      .post('/api/v1/auth/login')
      .set('Authorization', 'Bearer secret-access-token')
      .set('Idempotency-Key', 'secret-key')
      .send({ identifier: '9876543210', password: 'Sup3r-Secret!' });
    expect(lines).toHaveLength(1);
    const text = lines[0]!;
    expect(text).toContain('/api/v1/auth/login');
    for (const secret of ['secret-access-token', 'secret-key', 'Sup3r-Secret!', '9876543210']) {
      expect(text).not.toContain(secret);
    }
  });
});
