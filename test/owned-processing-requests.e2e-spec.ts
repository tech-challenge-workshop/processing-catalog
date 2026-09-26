// The owned routes must not depend on the local-only flag: prove them in the
// production composition, with the flag unset before AppModule is loaded.
delete process.env.LOCAL_INTEGRATION;

import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  ProcessingRequest,
  acceptProcessingRequest,
  completeProcessingRequest,
  createProcessingRequest,
  failProcessingRequest,
} from '../src/domain/processing-request';
import type { ProcessingRequestRepository } from '../src/domain/processing-request.repository';
import { TypeOrmProcessingRequestRepository } from '../src/infrastructure/persistence/typeorm-processing-request.repository';
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

interface OwnedItemBody {
  processingRequestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

interface OwnedPageBody {
  items: OwnedItemBody[];
  page: number;
  pageSize: number;
  total: number;
}

const NOT_FOUND = {
  message: 'Processing request not found',
  error: 'Not Found',
  statusCode: 404,
};

describeIfDatabase('owned processing requests over HTTP (PostgreSQL)', () => {
  let app: INestApplication;
  let repository: ProcessingRequestRepository;
  let http: () => ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RabbitMQConnection)
      .useValue(new SilentConnection())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repository = app.get('ProcessingRequestRepository');
    http = () => request(app.getHttpServer() as import('http').Server);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  }, 30_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The database outlives a run, so every test owns fresh owners.
  const owner = (name: string) => `${name}-${randomUUID()}`;
  const t = (minute: number) =>
    new Date(`2026-09-26T10:${String(minute).padStart(2, '0')}:00.000Z`);

  async function seed(
    ownerUserId: string,
    createdAt: Date,
    processingRequestId: string = randomUUID(),
  ): Promise<ProcessingRequest> {
    const r = {
      ...createProcessingRequest({
        ownerUserId,
        // One source per request: an owner holds one request per source.
        sourceStorageKey: `sources/${ownerUserId}/${processingRequestId}.mp4`,
      }),
      processingRequestId,
      createdAt,
      updatedAt: createdAt,
    };
    await repository.save(r);
    return r;
  }

  const spyOnReads = () => [
    jest.spyOn(repository, 'findPageByOwner'),
    jest.spyOn(repository, 'countByOwner'),
    jest.spyOn(repository, 'findByIdAndOwner'),
  ];

  it('runs against PostgreSQL, not the in-memory fallback', () => {
    expect(repository).toBeInstanceOf(TypeOrmProcessingRequestRepository);
  });

  describe('GET /owners/:ownerUserId/processing-requests', () => {
    it("returns only the owner's requests, newest first with the id tiebreak, and the owner's total", async () => {
      const alice = owner('alice');
      const bob = owner('bob');
      const [low, high] = [randomUUID(), randomUUID()].sort();
      const aliceOld = await seed(alice, t(1));
      await seed(bob, t(2));
      await seed(alice, t(3), high);
      await seed(alice, t(3), low);
      await seed(bob, t(4));

      const aliceRes = await http().get(`/owners/${alice}/processing-requests`);
      const bobRes = await http().get(`/owners/${bob}/processing-requests`);
      const aliceBody = aliceRes.body as OwnedPageBody;
      const bobBody = bobRes.body as OwnedPageBody;

      expect(aliceRes.status).toBe(200);
      expect(aliceBody.items.map((i) => i.processingRequestId)).toEqual([
        low,
        high,
        aliceOld.processingRequestId,
      ]);
      expect(aliceBody.total).toBe(3);
      expect(bobBody.items).toHaveLength(2);
      expect(bobBody.total).toBe(2);
      const aliceIds = new Set(
        aliceBody.items.map((i) => i.processingRequestId),
      );
      expect(
        bobBody.items.some((i) => aliceIds.has(i.processingRequestId)),
      ).toBe(false);
    });

    it('answers exactly { items, page, pageSize, total } with the item shape', async () => {
      const alice = owner('alice');
      const r = await seed(alice, t(1));

      const res = await http().get(
        `/owners/${alice}/processing-requests?page=1&pageSize=5`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({
        items: [
          {
            processingRequestId: r.processingRequestId,
            status: 'RECEIVED',
            createdAt: '2026-09-26T10:01:00.000Z',
            updatedAt: '2026-09-26T10:01:00.000Z',
          },
        ],
        page: 1,
        pageSize: 5,
        total: 1,
      });
    });

    it('defaults to page 1 with 20 items', async () => {
      const alice = owner('alice');
      for (let m = 0; m < 21; m++) {
        await seed(alice, t(m));
      }

      const res = await http().get(`/owners/${alice}/processing-requests`);
      const body = res.body as OwnedPageBody;

      expect(res.status).toBe(200);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.items).toHaveLength(20);
      expect(body.items[0].createdAt).toBe('2026-09-26T10:20:00.000Z');
      expect(body.total).toBe(21);
    });

    it('starts page p at offset (p - 1) * pageSize', async () => {
      const alice = owner('alice');
      const rows: ProcessingRequest[] = [];
      for (const m of [1, 2, 3, 4, 5]) {
        rows.push(await seed(alice, t(m)));
      }

      const res = await http().get(
        `/owners/${alice}/processing-requests?page=2&pageSize=2`,
      );
      const body = res.body as OwnedPageBody;

      // Newest first is minutes 5,4 | 3,2 | 1.
      expect(body.items.map((i) => i.processingRequestId)).toEqual([
        rows[2].processingRequestId,
        rows[1].processingRequestId,
      ]);
      expect(body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    });

    it("returns no items but the owner's total beyond the last page", async () => {
      const alice = owner('alice');
      await seed(alice, t(1));
      await seed(alice, t(2));

      const res = await http().get(
        `/owners/${alice}/processing-requests?page=5&pageSize=2`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({
        items: [],
        page: 5,
        pageSize: 2,
        total: 2,
      });
    });

    it('returns an empty page for an owner with no requests', async () => {
      const res = await http().get(
        `/owners/${owner('nobody')}/processing-requests`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
    });

    it('gives a FAILED item its safe sentence and exposes no storage key, attempt or code', async () => {
      const alice = owner('alice');
      const failed = failProcessingRequest(
        acceptProcessingRequest(await seed(alice, t(1))),
        'FORMATO_INVALIDO',
      );
      await repository.update(failed);
      const completed = completeProcessingRequest(
        acceptProcessingRequest(await seed(alice, t(2))),
        `results/${alice}/frames.zip`,
      );
      await repository.update(completed);

      const res = await http().get(`/owners/${alice}/processing-requests`);
      const body = res.body as OwnedPageBody;

      expect(body.items).toStrictEqual([
        {
          processingRequestId: completed.processingRequestId,
          status: 'COMPLETED',
          createdAt: '2026-09-26T10:02:00.000Z',
          updatedAt: completed.updatedAt.toISOString(),
        },
        {
          processingRequestId: failed.processingRequestId,
          status: 'FAILED',
          createdAt: '2026-09-26T10:01:00.000Z',
          updatedAt: failed.updatedAt.toISOString(),
          failureReason: 'O arquivo enviado nao e um video MP4 ou MOV valido.',
        },
      ]);
      for (const secret of [
        'sourceStorageKey',
        'zipStorageKey',
        'attemptId',
        'failureCode',
        'ownerUserId',
        completed.sourceStorageKey,
        failed.sourceStorageKey,
        `results/${alice}/frames.zip`,
        completed.attemptId!,
        failed.attemptId!,
        'FORMATO_INVALIDO',
      ]) {
        expect(res.text).not.toContain(secret);
      }
    });

    it('answers 400 for a blank owner without querying', async () => {
      const reads = spyOnReads();

      const res = await http().get('/owners/%20%20/processing-requests');

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'ownerUserId is required',
      );
      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    });

    it.each(['0', '-1', '1.5', 'abc', ''])(
      'answers 400 naming page and its range for page=%p, without querying',
      async (page) => {
        const reads = spyOnReads();

        const res = await http().get(
          `/owners/${owner('alice')}/processing-requests?page=${page}`,
        );

        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          'page must be an integer greater than or equal to 1',
        );
        for (const read of reads) {
          expect(read).not.toHaveBeenCalled();
        }
      },
    );

    it.each(['0', '101', '2.5', 'abc', ''])(
      'answers 400 naming pageSize and its range for pageSize=%p, without querying',
      async (pageSize) => {
        const reads = spyOnReads();

        const res = await http().get(
          `/owners/${owner('alice')}/processing-requests?pageSize=${pageSize}`,
        );

        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          'pageSize must be an integer between 1 and 100',
        );
        for (const read of reads) {
          expect(read).not.toHaveBeenCalled();
        }
      },
    );

    it('accepts the bounds of pageSize, 1 and 100', async () => {
      const alice = owner('alice');
      await seed(alice, t(1));

      const one = await http().get(
        `/owners/${alice}/processing-requests?pageSize=1`,
      );
      const hundred = await http().get(
        `/owners/${alice}/processing-requests?pageSize=100`,
      );

      expect(one.status).toBe(200);
      expect((one.body as OwnedPageBody).pageSize).toBe(1);
      expect(hundred.status).toBe(200);
      expect((hundred.body as OwnedPageBody).pageSize).toBe(100);
    });
  });

  describe('GET /owners/:ownerUserId/processing-requests/:id', () => {
    it('returns the request to its owner in the item shape', async () => {
      const alice = owner('alice');
      const failed = failProcessingRequest(
        acceptProcessingRequest(await seed(alice, t(1))),
        'PROCESSAMENTO_FALHOU',
      );
      await repository.update(failed);

      const res = await http().get(
        `/owners/${alice}/processing-requests/${failed.processingRequestId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({
        processingRequestId: failed.processingRequestId,
        status: 'FAILED',
        createdAt: '2026-09-26T10:01:00.000Z',
        updatedAt: failed.updatedAt.toISOString(),
        failureReason:
          'Nao foi possivel processar o video. Tente enviar novamente.',
      });
    });

    it("answers another owner's id with the same 404 body as a random id and a malformed one", async () => {
      const alice = owner('alice');
      const r = await seed(alice, t(1));

      const others = await http().get(
        `/owners/${owner('bob')}/processing-requests/${r.processingRequestId}`,
      );
      const random = await http().get(
        `/owners/${alice}/processing-requests/${randomUUID()}`,
      );
      const malformed = await http().get(
        `/owners/${alice}/processing-requests/not-a-uuid`,
      );

      expect(others.status).toBe(404);
      expect(random.status).toBe(404);
      expect(malformed.status).toBe(404);
      expect(random.body).toStrictEqual(NOT_FOUND);
      expect(others.text).toBe(random.text);
      expect(malformed.text).toBe(random.text);
    });

    it('answers a malformed id with 404 before any query', async () => {
      const reads = spyOnReads();

      const res = await http().get(
        `/owners/${owner('alice')}/processing-requests/abc`,
      );

      expect(res.status).toBe(404);
      expect(res.body).toStrictEqual(NOT_FOUND);
      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    });

    it('answers 400 for a blank owner without querying', async () => {
      const reads = spyOnReads();

      const res = await http().get(
        `/owners/%20/processing-requests/${randomUUID()}`,
      );

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'ownerUserId is required',
      );
      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    });
  });

  describe('GET /owners/:ownerUserId/processing-requests/:id/archive', () => {
    const completedFor = async (ownerUserId: string, zipStorageKey: string) => {
      const completed = completeProcessingRequest(
        acceptProcessingRequest(await seed(ownerUserId, t(1))),
        zipStorageKey,
      );
      await repository.update(completed);
      return completed;
    };

    it('returns exactly { zipStorageKey } of a completed request to its owner', async () => {
      const alice = owner('alice');
      const completed = await completedFor(alice, `zips/${alice}/out.zip`);

      const res = await http().get(
        `/owners/${alice}/processing-requests/${completed.processingRequestId}/archive`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({
        zipStorageKey: `zips/${alice}/out.zip`,
      });
    });

    it.each<[string, (r: ProcessingRequest) => ProcessingRequest]>([
      ['RECEIVED', (r) => r],
      ['QUEUED', (r) => acceptProcessingRequest(r)],
      [
        'FAILED',
        (r) =>
          failProcessingRequest(
            acceptProcessingRequest(r),
            'PROCESSAMENTO_FALHOU',
          ),
      ],
    ])('answers 409 for an owned %s request', async (_status, transition) => {
      const alice = owner('alice');
      const seeded = await seed(alice, t(1));
      const moved = transition(seeded);
      if (moved !== seeded) {
        await repository.update(moved);
      }

      const res = await http().get(
        `/owners/${alice}/processing-requests/${seeded.processingRequestId}/archive`,
      );

      expect(res.status).toBe(409);
      expect(res.body).toStrictEqual({
        message: 'Processing request is not completed',
        error: 'Conflict',
        statusCode: 409,
      });
    });

    it("answers another owner's completed id, a random id and a malformed one with the constant 404, byte-identical to the item route's", async () => {
      const alice = owner('alice');
      const completed = await completedFor(alice, `zips/${alice}/out.zip`);
      const itemMiss = await http().get(
        `/owners/${alice}/processing-requests/${randomUUID()}`,
      );

      const others = await http().get(
        `/owners/${owner('bob')}/processing-requests/${completed.processingRequestId}/archive`,
      );
      const random = await http().get(
        `/owners/${alice}/processing-requests/${randomUUID()}/archive`,
      );
      const malformed = await http().get(
        `/owners/${alice}/processing-requests/not-a-uuid/archive`,
      );

      for (const res of [others, random, malformed]) {
        expect(res.status).toBe(404);
        expect(res.body).toStrictEqual(NOT_FOUND);
        expect(res.text).toBe(itemMiss.text);
      }
      expect(others.text).not.toContain(`zips/${alice}/out.zip`);
    });

    it('answers a malformed id with 404 before any query', async () => {
      const reads = spyOnReads();

      const res = await http().get(
        `/owners/${owner('alice')}/processing-requests/abc/archive`,
      );

      expect(res.status).toBe(404);
      expect(res.body).toStrictEqual(NOT_FOUND);
      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    });

    it('answers 400 for a blank owner without querying', async () => {
      const reads = spyOnReads();

      const res = await http().get(
        `/owners/%20/processing-requests/${randomUUID()}/archive`,
      );

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'ownerUserId is required',
      );
      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    });

    it('keeps the list and the read of a completed request free of the archive key', async () => {
      const alice = owner('alice');
      const zip = `zips/${alice}/out.zip`;
      const completed = await completedFor(alice, zip);

      const list = await http().get(`/owners/${alice}/processing-requests`);
      const one = await http().get(
        `/owners/${alice}/processing-requests/${completed.processingRequestId}`,
      );

      expect(list.status).toBe(200);
      expect(one.status).toBe(200);
      expect((list.body as OwnedPageBody).items).toHaveLength(1);
      for (const item of [(list.body as OwnedPageBody).items[0], one.body]) {
        expect(Object.keys(item as object).sort()).toEqual([
          'createdAt',
          'processingRequestId',
          'status',
          'updatedAt',
        ]);
      }
      expect(list.text).not.toContain(zip);
      expect(one.text).not.toContain(zip);
      expect(list.text).not.toContain('zipStorageKey');
      expect(one.text).not.toContain('zipStorageKey');
    });
  });
});
