import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CorrelationContext, parseCorrelationId } from './correlation-context';

/**
 * The HTTP edge: every request runs inside a correlation scope, taken from a
 * valid `X-Correlation-Id` header or generated, and echoed on the response.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly context: CorrelationContext) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const id =
      parseCorrelationId(req.header('x-correlation-id')) ??
      this.context.getOrGenerateCorrelationId();
    res.setHeader('x-correlation-id', id);
    this.context.runWithCorrelation(id, next);
  }
}
