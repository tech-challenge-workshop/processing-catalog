import { correlationContext } from '../../observability/correlation-context';
import { withMessageCorrelation } from './with-correlation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('withMessageCorrelation (OBS-19, OBS-20)', () => {
  const seenBy = async (content: string): Promise<string | undefined> => {
    let seen: string | undefined;
    await withMessageCorrelation(content, () => {
      seen = correlationContext.getCorrelationId();
      return Promise.resolve();
    });
    return seen;
  };

  it("sets the context from the message's correlationId before handling", async () => {
    expect(
      await seenBy(JSON.stringify({ eventId: 'e-1', correlationId: 'cat-1' })),
    ).toBe('cat-1');
  });

  it('reads the id inside a Nest data envelope, trimmed', async () => {
    expect(
      await seenBy(
        JSON.stringify({
          pattern: 'VideoAccepted',
          data: { eventId: 'e-1', correlationId: '  cat-2  ' },
        }),
      ),
    ).toBe('cat-2');
  });

  it('clears the context once the handler has settled', async () => {
    await withMessageCorrelation(
      JSON.stringify({ correlationId: 'cat-1' }),
      () => Promise.resolve(),
    );

    expect(correlationContext.getCorrelationId()).toBeUndefined();
  });

  it('clears the context when the handler throws, and rethrows', async () => {
    await expect(
      withMessageCorrelation(JSON.stringify({ correlationId: 'cat-1' }), () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    expect(correlationContext.getCorrelationId()).toBeUndefined();
  });

  it('generates a fresh id when the message has none, and still handles it', async () => {
    const handler = jest.fn(() => Promise.resolve());

    await withMessageCorrelation(JSON.stringify({ eventId: 'e-1' }), handler);
    const seen = await seenBy(JSON.stringify({ eventId: 'e-1' }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen).toMatch(UUID);
  });

  it.each<[string, unknown]>([
    ['a number', 123],
    ['an object', { id: 'cat-1' }],
    ['null', null],
    ['a blank string', '   '],
    ['129 characters', 'a'.repeat(129)],
    ['a non-printable character', 'cat\n1'],
  ])(
    'replaces %s with a generated id, never coercing it (L-010)',
    async (_label, correlationId) => {
      const seen = await seenBy(
        JSON.stringify({ eventId: 'e-1', correlationId }),
      );

      expect(seen).toMatch(UUID);
    },
  );

  it('generates an id for a body that is not JSON and still runs the handler, so it can be settled', async () => {
    const handler = jest.fn(() => Promise.resolve());

    await withMessageCorrelation('{not json', handler);
    const seen = await seenBy('{not json');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen).toMatch(UUID);
  });

  it('gives two messages without an id two different ids', async () => {
    const first = await seenBy('{}');
    const second = await seenBy('{}');

    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });
});
