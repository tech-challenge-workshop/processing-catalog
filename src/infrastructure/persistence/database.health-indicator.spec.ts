import { DataSource } from 'typeorm';
import { DatabaseHealthIndicator } from './database.health-indicator';

describe('DatabaseHealthIndicator', () => {
  const asDataSource = (value: unknown) => value as DataSource;

  it('reports healthy when no database is configured, since the service runs in memory', async () => {
    const indicator = new DatabaseHealthIndicator(undefined);

    await expect(indicator.isHealthy()).resolves.toBe(true);
  });

  it('reports unhealthy before the data source is initialised', async () => {
    const indicator = new DatabaseHealthIndicator(
      asDataSource({ isInitialized: false }),
    );

    await expect(indicator.isHealthy()).resolves.toBe(false);
  });

  it('reports healthy when the database answers', async () => {
    const indicator = new DatabaseHealthIndicator(
      asDataSource({ isInitialized: true, query: () => Promise.resolve([{}]) }),
    );

    await expect(indicator.isHealthy()).resolves.toBe(true);
  });

  it('reports unhealthy when the query fails', async () => {
    const indicator = new DatabaseHealthIndicator(
      asDataSource({
        isInitialized: true,
        query: () => Promise.reject(new Error('connection refused')),
      }),
    );

    await expect(indicator.isHealthy()).resolves.toBe(false);
  });
});
