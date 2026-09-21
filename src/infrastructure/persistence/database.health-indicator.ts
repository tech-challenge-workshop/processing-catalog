import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from './data-source';

/**
 * Readiness must reflect the database, or the service accepts traffic it can
 * only turn into requeues.
 *
 * When no database is configured the service runs on the in-memory repository,
 * and there is nothing to be unhealthy about - so the indicator reports
 * healthy rather than blocking a configuration that is deliberate.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Optional()
    @Inject(DATA_SOURCE)
    private readonly dataSource?: DataSource,
  ) {}

  async isHealthy(): Promise<boolean> {
    if (!this.dataSource) {
      return true;
    }
    if (!this.dataSource.isInitialized) {
      return false;
    }
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
