import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { catalogMetrics } from './metrics';
import { HttpMetricsMiddleware } from './http-metrics.middleware';

function buildApp(): Express {
  const app = express();
  const middleware = new HttpMetricsMiddleware();
  app.use(middleware.use.bind(middleware));
  app.get('/items/:id', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('HttpMetricsMiddleware', () => {
  beforeEach(() => {
    catalogMetrics.resetMetrics();
  });

  it('records the route template for a matched request', async () => {
    const response = await request(buildApp()).get('/items/42');

    expect(response.status).toBe(200);
    const exposition = await catalogMetrics.metrics();
    expect(exposition).toContain(
      'fiapx_http_requests_total{method="GET",route="/items/:id",status="200"} 1',
    );
    expect(exposition).toContain(
      'fiapx_http_request_duration_seconds_count{method="GET",route="/items/:id",status="200"} 1',
    );
    expect(exposition).not.toContain('route="/items/42"');
  });

  it("records 'unmatched' when no route template matched", async () => {
    const response = await request(buildApp()).get('/nope');

    expect(response.status).toBe(404);
    const exposition = await catalogMetrics.metrics();
    expect(exposition).toContain(
      'fiapx_http_requests_total{method="GET",route="unmatched",status="404"} 1',
    );
    expect(exposition).not.toContain('route="/nope"');
  });

  it('counts each request exactly once', async () => {
    const app = buildApp();
    await request(app).get('/items/1');
    await request(app).get('/items/2');
    await request(app).get('/items/1');

    const exposition = await catalogMetrics.metrics();
    expect(exposition).toContain(
      'fiapx_http_requests_total{method="GET",route="/items/:id",status="200"} 3',
    );
  });

  it('never throws into the pipeline when counting fails', async () => {
    const record = jest
      .spyOn(catalogMetrics, 'recordHttpRequest')
      .mockImplementation(() => {
        throw new Error('registry down');
      });

    const response = await request(buildApp()).get('/items/42');

    expect(response.status).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);

    record.mockRestore();
  });
});
