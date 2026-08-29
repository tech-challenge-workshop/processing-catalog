import { RabbitMQHealthIndicator } from './rabbitmq.health-indicator';
import { RabbitMQConnection } from './rabbitmq.connection';

describe('RabbitMQHealthIndicator', () => {
  it('returns up when the connection is open', () => {
    const connection = {
      isConnected: () => true,
    } as unknown as RabbitMQConnection;
    const indicator = new RabbitMQHealthIndicator(connection);

    expect(indicator.isHealthy()).toBe(true);
  });

  it('returns down when the connection is closed', () => {
    const connection = {
      isConnected: () => false,
    } as unknown as RabbitMQConnection;
    const indicator = new RabbitMQHealthIndicator(connection);

    expect(indicator.isHealthy()).toBe(false);
  });
});
