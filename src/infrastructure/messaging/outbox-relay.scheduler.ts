import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { OutboxRelay } from './outbox-relay';

export const OUTBOX_POLL_INTERVAL_MS = Number(
  process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000,
);

/**
 * Drives the relay on an interval.
 *
 * A poll that finds nothing is nearly free thanks to the partial index, and
 * polling avoids the second failure mode that LISTEN/NOTIFY would add.
 *
 * A failed drain is logged and left for the next tick: the rows stay pending,
 * which is the whole point. Throwing here would kill the interval and stop
 * every future delivery.
 */
@Injectable()
export class OutboxRelayScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxRelayScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private draining = false;

  constructor(
    @Optional()
    private readonly relay?: OutboxRelay,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.relay) {
      // No database configured: nothing records to an outbox, so nothing
      // needs draining.
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, OUTBOX_POLL_INTERVAL_MS);
    // Do not hold the process open for the sake of the poll.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed so tests drive a tick without waiting on the clock. */
  async tick(): Promise<number> {
    if (!this.relay || this.draining) {
      return 0;
    }
    this.draining = true;
    try {
      return await this.relay.drain();
    } catch (error) {
      this.logger.warn(
        `Outbox drain failed, rows stay pending: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    } finally {
      this.draining = false;
    }
  }
}
