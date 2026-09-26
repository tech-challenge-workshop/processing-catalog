// The create route is proven in the production composition, over PostgreSQL.
delete process.env.LOCAL_INTEGRATION;

import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DATA_SOURCE } from '../src/infrastructure/persistence/data-source';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';

const configured = Boolean(process.env.DATABASE_HOST);
const describeIfDatabase = configured ? describe : describe.skip;

class SilentConnection {
  isConnected(): boolean {
    return true;
  }
  sendToQueue(): Promise<void> {
    return Promise.resolve();
  }
  getConsumeChannel() {
    return { consume: () => Promise.resolve({ consumerTag: 'x' }) };
  }
  onModuleInit(): void {}
  onModuleDestroy(): Promise<void> {
    return Promise.resolve();
  }
}

interface CreatedBody {
  processingRequestId: string;
  status: string;
  ownerUserId: string;
  sourceStorageKey: string;
  createdAt: string;
}

describeIfDatabase(
  'POST /processing-requests with an idempotency key (PostgreSQL)',
  () => {
    let app: INestApplication;
    let dataSource: DataSource;
    let http: () => ReturnType<typeof request>;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(RabbitMQConnection)
        .useValue(new SilentConnection())
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
      dataSource = app.get(DATA_SOURCE);
      http = () => request(app.getHttpServer() as import('http').Server);
    }, 30_000);

    afterAll(async () => {
      await app.close();
    }, 30_000);

    // The database outlives a run, so every test owns a fresh owner.
    const owner = (name: string) => `${name}-${randomUUID()}`;
    const create = (body: Record<string, unknown>) =>
      http().post('/processing-requests').send(body);

    const rows = async (ownerUserId: string): Promise<number> => {
      const r: { n: number }[] = await dataSource.query(
        'SELECT count(*)::int AS n FROM processing_request WHERE owner_user_id = $1',
        [ownerUserId],
      );
      return r[0].n;
    };

    const outboxEntries = async (ownerUserId: string): Promise<number> => {
      const r: { n: number }[] = await dataSource.query(
        `SELECT count(*)::int AS n FROM outbox
        WHERE pattern = 'VideoValidationRequested'
          AND payload->>'ownerUserId' = $1`,
        [ownerUserId],
      );
      return r[0].n;
    };

    it('answers 201 on an unused key, then 200 with the same body on a replay, writing once', async () => {
      const alice = owner('alice');
      const body = {
        ownerUserId: alice,
        sourceStorageKey: `sources/${alice}/a.mp4`,
        idempotencyKey: 'key-1',
      };

      const first = await create(body);
      const second = await create(body);

      expect(first.status).toBe(201);
      const created = first.body as CreatedBody;
      expect(Object.keys(created).sort()).toEqual([
        'createdAt',
        'ownerUserId',
        'processingRequestId',
        'sourceStorageKey',
        'status',
      ]);
      expect(created.processingRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(created.status).toBe('RECEIVED');
      expect(created.ownerUserId).toBe(alice);
      expect(created.sourceStorageKey).toBe(`sources/${alice}/a.mp4`);
      expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
      expect(second.status).toBe(200);
      expect(second.body).toStrictEqual(created);
      expect(await rows(alice)).toBe(1);
      expect(await outboxEntries(alice)).toBe(1);
    });

    it('answers 200 with the same body to a new key on a source the owner already has, writing once', async () => {
      const alice = owner('alice');
      const source = `sources/${alice}/a.mp4`;

      const first = await create({
        ownerUserId: alice,
        sourceStorageKey: source,
        idempotencyKey: 'key-1',
      });
      const second = await create({
        ownerUserId: alice,
        sourceStorageKey: source,
        idempotencyKey: 'key-2',
      });

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body).toStrictEqual(first.body);
      expect(await rows(alice)).toBe(1);
      expect(await outboxEntries(alice)).toBe(1);
    });

    it('answers 409 for the key bound to another source, and writes nothing', async () => {
      const alice = owner('alice');
      await create({
        ownerUserId: alice,
        sourceStorageKey: `sources/${alice}/a.mp4`,
        idempotencyKey: 'key-1',
      });

      const res = await create({
        ownerUserId: alice,
        sourceStorageKey: `sources/${alice}/b.mp4`,
        idempotencyKey: 'key-1',
      });

      expect(res.status).toBe(409);
      expect(res.body).toStrictEqual({
        message:
          'idempotencyKey is already used for a different sourceStorageKey',
        error: 'Conflict',
        statusCode: 409,
      });
      expect(await rows(alice)).toBe(1);
      expect(await outboxEntries(alice)).toBe(1);
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['blank', '   '],
    ])(
      'answers 400 for a %s idempotencyKey, and writes nothing',
      async (_label, idempotencyKey) => {
        const alice = owner('alice');

        const res = await create({
          ownerUserId: alice,
          sourceStorageKey: `sources/${alice}/a.mp4`,
          idempotencyKey,
        });

        expect(res.status).toBe(400);
        expect(res.body).toStrictEqual({
          message: 'idempotencyKey is required',
          error: 'Bad Request',
          statusCode: 400,
        });
        expect(await rows(alice)).toBe(0);
        expect(await outboxEntries(alice)).toBe(0);
      },
    );

    describe('malformed input', () => {
      type Field = 'ownerUserId' | 'sourceStorageKey' | 'idempotencyKey';
      const FIELDS: Field[] = [
        'ownerUserId',
        'sourceStorageKey',
        'idempotencyKey',
      ];

      // A fresh, valid body; the case under test replaces one field.
      const validBody = () => {
        const ownerUserId = owner('malformed');
        return {
          ownerUserId,
          sourceStorageKey: `sources/${ownerUserId}/a.mp4`,
          idempotencyKey: 'key-' + randomUUID(),
        };
      };

      // Counted by the valid owner and the valid source, so a write under
      // either is seen whichever field was replaced.
      const written = async (body: {
        ownerUserId: string;
        sourceStorageKey: string;
      }): Promise<{ rows: number; outbox: number }> => {
        const r: { n: number }[] = await dataSource.query(
          `SELECT count(*)::int AS n FROM processing_request
            WHERE owner_user_id = $1 OR source_storage_key = $2`,
          [body.ownerUserId, body.sourceStorageKey],
        );
        const o: { n: number }[] = await dataSource.query(
          `SELECT count(*)::int AS n FROM outbox
            WHERE pattern = 'VideoValidationRequested'
              AND (payload->>'ownerUserId' = $1
                   OR payload->>'sourceStorageKey' = $2)`,
          [body.ownerUserId, body.sourceStorageKey],
        );
        return { rows: r[0].n, outbox: o[0].n };
      };

      const badRequest = (message: string) => ({
        message,
        error: 'Bad Request',
        statusCode: 400,
      });

      it('answers 400 to a 256-character idempotencyKey, and writes nothing', async () => {
        const body = validBody();

        const res = await create({ ...body, idempotencyKey: 'k'.repeat(256) });

        expect(res.status).toBe(400);
        expect(res.body).toStrictEqual(
          badRequest('idempotencyKey must be at most 255 characters'),
        );
        expect(await written(body)).toEqual({ rows: 0, outbox: 0 });
      });

      it('accepts a 255-character idempotencyKey', async () => {
        const body = { ...validBody(), idempotencyKey: 'k'.repeat(255) };

        const res = await create(body);

        expect(res.status).toBe(201);
        expect(await written(body)).toEqual({ rows: 1, outbox: 1 });
      });

      it.each(
        FIELDS.flatMap((field) =>
          (
            [
              ['a number', 42],
              ['an array', ['a']],
              ['an object', { a: 'b' }],
              ['true', true],
            ] as [string, unknown][]
          ).map(([label, value]) => [field, label, value] as const),
        ),
      )(
        'answers 400 to %s as %s, and writes nothing',
        async (field, _label, value) => {
          const body = validBody();

          const res = await create({ ...body, [field]: value });

          expect(res.status).toBe(400);
          expect(res.body).toStrictEqual(
            badRequest(`${field} must be a string`),
          );
          expect(await written(body)).toEqual({ rows: 0, outbox: 0 });
        },
      );

      it.each(FIELDS)('accepts a numeric string as %s', async (field) => {
        const body = {
          ...validBody(),
          [field]: String(Date.now()) + String(Math.random()).slice(2),
        };

        const res = await create(body);

        expect(res.status).toBe(201);
        expect(await written(body)).toEqual({ rows: 1, outbox: 1 });
      });

      // null for every field; missing, empty and blank for the two fields the
      // S6 cases above do not already cover with their exact message.
      it.each([
        ...FIELDS.map((field) => [field, 'null', null] as const),
        ...(['ownerUserId', 'sourceStorageKey'] as const).flatMap((field) =>
          (
            [
              ['missing', undefined],
              ['empty', ''],
              ['blank', '   '],
            ] as const
          ).map(([label, value]) => [field, label, value] as const),
        ),
      ])(
        'answers 400 %s is required to a %s value, and writes nothing',
        async (field, _label, value) => {
          const body = validBody();

          const res = await create({ ...body, [field]: value });

          expect(res.status).toBe(400);
          expect(res.body).toStrictEqual(badRequest(`${field} is required`));
          expect(await written(body)).toEqual({ rows: 0, outbox: 0 });
        },
      );
    });

    it('answers two concurrent creates with one key as one 201 and one 200 carrying the same id', async () => {
      const alice = owner('alice');
      const body = {
        ownerUserId: alice,
        sourceStorageKey: `sources/${alice}/a.mp4`,
        idempotencyKey: 'key-1',
      };

      const responses = await Promise.all([create(body), create(body)]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      const [a, b] = responses.map(
        (r) => (r.body as CreatedBody).processingRequestId,
      );
      expect(a).toBe(b);
      expect(await rows(alice)).toBe(1);
      expect(await outboxEntries(alice)).toBe(1);
    });

    it('gives two owners using the same key string a 201 and a request each', async () => {
      const alice = owner('alice');
      const bob = owner('bob');

      const a = await create({
        ownerUserId: alice,
        sourceStorageKey: `sources/${alice}/a.mp4`,
        idempotencyKey: 'shared-key',
      });
      const b = await create({
        ownerUserId: bob,
        sourceStorageKey: `sources/${bob}/a.mp4`,
        idempotencyKey: 'shared-key',
      });

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect((a.body as CreatedBody).processingRequestId).not.toBe(
        (b.body as CreatedBody).processingRequestId,
      );
      expect(await rows(alice)).toBe(1);
      expect(await rows(bob)).toBe(1);
    });
  },
);
