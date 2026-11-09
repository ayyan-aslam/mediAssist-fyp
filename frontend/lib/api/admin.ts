import { api } from "@/lib/api/client";
import type { AccountStatusResponse, AdminUser, AuditAction, AuditLog, Paged } from "@/lib/api/types";

export interface AdminUserFilters {
  search?: string;
  role?: "patient" | "doctor" | "admin";
  status?: "active" | "suspended";
  page: number;
  pageSize: number;
}

// from and to are YYYY-MM-DD dates.
export interface AuditLogFilters {
  from?: string;
  to?: string;
  userId?: number;
  action?: AuditAction;
  page: number;
  pageSize: number;
}

export const ADMIN_USERS_QUERY_KEY = ["admin", "users"] as const;
export const adminUsersQueryKey = (filters: AdminUserFilters) =>
  [...ADMIN_USERS_QUERY_KEY, "list", filters] as const;
export const adminUserQueryKey = (userId: number) => [...ADMIN_USERS_QUERY_KEY, userId] as const;
export const auditLogsQueryKey = (filters: AuditLogFilters) => ["admin", "audit-logs", filters] as const;

const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (value === undefined || value === "" ? [] : [[key, String(value)]])),
  ).toString();

// Admin endpoints of the Auth & User Service (design doc 5.2) and the Audit Service (5.10).
// Silent: the admin screens show these errors themselves (error state, or inside the confirm dialog).
export const adminApi = {
  listUsers: (filters: AdminUserFilters) =>
    api<Paged<AdminUser>>(`/admin/users?${query({ ...filters })}`, { silent: true }),

  getUser: (userId: number) => api<AdminUser>(`/admin/users/${userId}`, { silent: true }),

  suspendUser: (userId: number) =>
    api<AccountStatusResponse>(`/admin/users/${userId}/suspend`, { method: "POST", silent: true }),

  activateUser: (userId: number) =>
    api<AccountStatusResponse>(`/admin/users/${userId}/activate`, { method: "POST", silent: true }),

  listAuditLogs: (filters: AuditLogFilters) =>
    api<Paged<AuditLog>>(`/admin/audit-logs?${query({ ...filters })}`, { silent: true }),
};
