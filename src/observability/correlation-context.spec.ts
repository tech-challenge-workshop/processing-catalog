import { CorrelationContext, parseCorrelationId } from './correlation-context';

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('CorrelationContext', () => {
  let context: CorrelationContext;

  beforeEach(() => {
    context = new CorrelationContext();
  });

  it('returns undefined outside a correlation scope', () => {
    expect(context.getCorrelationId()).toBeUndefined();
  });

  it('exposes the scoped id to getCorrelationId within the run', () => {
    context.runWithCorrelation('demo-123', () => {
      expect(context.getCorrelationId()).toBe('demo-123');
    });
  });

  it('isolates concurrent interleaved runs', async () => {
    const seen: Record<string, string | undefined> = {};
    const run = (id: string) =>
      context.runWithCorrelation(id, async () => {
        await delay(5);
        seen[id] = context.getCorrelationId();
      });

    await Promise.all([run('first'), run('second')]);

    expect(seen).toEqual({ first: 'first', second: 'second' });
  });

  it('returns the scoped id from getOrGenerateCorrelationId inside a run', () => {
    const id = context.runWithCorrelation('scoped-id', () =>
      context.getOrGenerateCorrelationId(),
    );

    expect(id).toBe('scoped-id');
  });

  it('generates a uuid from getOrGenerateCorrelationId outside a run', () => {
    const id = context.getOrGenerateCorrelationId();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('parseCorrelationId', () => {
  it('trims surrounding whitespace and accepts printable ascii', () => {
    expect(parseCorrelationId('  demo-123  ')).toBe('demo-123');
    expect(parseCorrelationId('a')).toBe('a');
  });

  it('accepts exactly 128 printable characters', () => {
    const id = 'x'.repeat(128);

    expect(parseCorrelationId(id)).toBe(id);
  });

  it('rejects blank and whitespace-only strings', () => {
    expect(parseCorrelationId('')).toBeNull();
    expect(parseCorrelationId('   ')).toBeNull();
  });

  it('rejects ids longer than 128 characters and control characters', () => {
    expect(parseCorrelationId('x'.repeat(129))).toBeNull();
    expect(parseCorrelationId('demo\n123')).toBeNull();
    expect(parseCorrelationId('demo\t123')).toBeNull();
  });

  it('rejects non-strings without coercion', () => {
    expect(parseCorrelationId(123)).toBeNull();
    expect(parseCorrelationId(null)).toBeNull();
    expect(parseCorrelationId(undefined)).toBeNull();
    expect(parseCorrelationId({ id: 'demo' })).toBeNull();
    expect(parseCorrelationId('123')).toBe('123');
  });
});
