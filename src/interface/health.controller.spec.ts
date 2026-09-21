import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { HealthController } from './health.controller';
import { RabbitMQHealthIndicator } from '../infrastructure/rabbitmq/rabbitmq.health-indicator';

describe('HealthController (integration)', () => {
  let app: INestApplication;
  let indicator: { isHealthy: jest.Mock };
  let request: ReturnType<typeof supertest>;

  beforeEach(async () => {
    indicator = { isHealthy: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: RabbitMQHealthIndicator,
          useValue: indicator,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    request = supertest(app.getHttpServer() as import('http').Server);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 when RabbitMQ is up', async () => {
    indicator.isHealthy.mockReturnValue(true);

    const response = await request.get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', rabbitmq: 'up' });
  });

  it('returns 503 when RabbitMQ is down', async () => {
    indicator.isHealthy.mockReturnValue(false);

    const response = await request.get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', rabbitmq: 'down' });
  });
});
