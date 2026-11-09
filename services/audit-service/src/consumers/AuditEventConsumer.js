export const AUDIT_QUEUE = 'audit.audit.event';

// Listens to the audit.event queue from all services and passes each event to AuditService (design doc
// Diagram 12). A message is acked only after its row is saved; a failure goes to the retry and dead-letter
// queues.
export class AuditEventConsumer {
  constructor({ eventConsumer, messageValidator, auditService }) {
    this.eventConsumer = eventConsumer;
    this.messageValidator = messageValidator;
    this.auditService = auditService;
  }

  start() {
    this.eventConsumer.consume(AUDIT_QUEUE, this.handle);
  }

  handle = async (message) => {
    await this.auditService.record(this.messageValidator.validateAuditEvent(message));
  };
}
