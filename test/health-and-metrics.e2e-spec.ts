// AppModule reads the flag when it is loaded: unset it first so this suite
// always asserts the production composition.
delete process.env.LOCAL_INTEGRATION;

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RabbitMQConnection } from '../src/infrastructure/rabbitmq/rabbitmq.connection';

/** A broker connection whose health the test decides. */
class SwitchableConnection {
  connected = true;
  isConnected(): boolean {
    return this.connected;
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

const describeIfDatabase = process.env.DATABASE_HOST ? describe : describe.skip;

describeIfDatabase(
  'health split and metrics exposition (OBS-23, OBS-26..28)',
  () => {
    let app: INestApplication;
    let connection: SwitchableConnection;
    const http = () => request(app.getHttpServer() as Server);

    beforeEach(async () => {
      connection = new SwitchableConnection();
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(RabbitMQConnection)
        .useValue(connection)
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
    }, 30_000);

    afterEach(async () => {
      await app.close();
    }, 30_000);

    it('reports ready and live when both dependencies are up (OBS-27)', async () => {
      const ready = await http().get('/health');
      const live = await http().get('/health/live');

      expect(ready.status).toBe(200);
      expect(ready.body).toStrictEqual({
        status: 'ok',
        rabbitmq: 'up',
        database: 'up',
      });
      expect(live.status).toBe(200);
    });

    it('reports not-ready naming rabbitmq while the broker is away, and stays live (OBS-26)', async () => {
      connection.connected = false;

      const ready = await http().get('/health');
      const live = await http().get('/health/live');

      expect(ready.status).toBe(503);
      expect(ready.body).toStrictEqual({
        status: 'error',
        rabbitmq: 'down',
        database: 'up',
      });
      expect(live.status).toBe(200);
    });

    it('serves every fiapx family on /metrics without credentials, in the 0.0.4 text format (OBS-23, OBS-28)', async () => {
      const response = await http().get('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe(
        'text/plain; version=0.0.4',
      );
      for (const family of [
        'fiapx_outbox_pending_rows',
        'fiapx_outbox_oldest_pending_seconds',
        'fiapx_outbox_publish_failures_total',
        'fiapx_events_consumed_total',
      ]) {
        expect(response.text).toContain(`# TYPE ${family} `);
      }
    });
  },
);
