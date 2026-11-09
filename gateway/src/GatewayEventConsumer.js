import { z } from 'zod';

export const USER_STATUS_QUEUE = 'gateway.user.status';

// user.suspended and user.activated (design doc 6.4.10 and 6.4.11). Both share one queue, so the messages
// for one user stay in order.
const userStatusSchema = z.object({
  type: z.enum(['user.suspended', 'user.activated']),
  data: z.object({
    userId: z.int().positive().max(2_147_483_647),
    changedAt: z.iso.datetime({ offset: true }),
  }),
});

// Listens to user.suspended and user.activated, and adds or removes the user in BlockListStore
// (design doc Diagram 11). Safe to run twice: adding or removing the same user again gives the same result.
export class GatewayEventConsumer {
  constructor({ eventConsumer, blockListStore, logger }) {
    this.eventConsumer = eventConsumer;
    this.blockListStore = blockListStore;
    this.logger = logger;
  }

  start() {
    this.eventConsumer.consume(USER_STATUS_QUEUE, this.handle);
  }

  // A message that does not match throws, so it goes to the retry and dead-letter queues.
  handle = async (message) => {
    const result = userStatusSchema.safeParse(message ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`Invalid message: ${issue.path.join('.')}: ${issue.message}`);
    }

    const { type, data } = result.data;
    const changedAt = Date.parse(data.changedAt);
    const applied =
      type === 'user.suspended'
        ? this.blockListStore.add(data.userId, changedAt)
        : this.blockListStore.remove(data.userId, changedAt);

    const log = { type, userId: data.userId, changedAt: data.changedAt };
    if (!applied) this.logger.info(log, 'Older user status message ignored');
    else this.logger.info(log, type === 'user.suspended' ? 'User added to the block list' : 'User removed from the block list');
  };
}
