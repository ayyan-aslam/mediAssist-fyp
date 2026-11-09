import { requireAdmin } from './currentAdmin.js';

// Here we define the admin endpoint /admin/audit-logs (design doc 5.10 and Diagram 12).
export class AuditController {
  constructor({ requestValidator, auditService }) {
    this.requestValidator = requestValidator;
    this.auditService = auditService;
  }

  list = async (req, res) => {
    requireAdmin(req);
    const filters = this.requestValidator.validateAuditLogList(req.query);
    res.json(await this.auditService.list(filters));
  };
}
