import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { catalogMetrics } from './metrics';

/**
 * Counts every served request with its route template (requests no route
 * matched report 'unmatched', keeping cardinality bounded) plus its duration.
 * Counting runs on response finish and can never throw into the pipeline.
 * Same pattern as the API's.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const routePath = (req as { route?: { path: unknown } }).route?.path;
        const route = typeof routePath === 'string' ? routePath : 'unmatched';
        const durationSeconds =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        catalogMetrics.recordHttpRequest(
          req.method,
          route,
          String(res.statusCode),
          durationSeconds,
        );
      } catch {
        // Metrics are a side effect: a counting failure must never fail a request.
      }
    });
    next();
  }
}
