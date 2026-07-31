export type AuditEntityType =
  | 'customer'
  | 'dress'
  | 'accessory'
  | 'reservation'
  | 'appointment'
  | 'payment'
  | 'expense'
  | 'sale'
  | 'delivery-return'
  | 'stocktake'
  | 'daily-closing'
  | 'preferences'
  | 'backup'
  | 'database'
  | 'storage';

export type AuditActionType =
  | 'create'
  | 'update'
  | 'status-change'
  | 'cancel'
  | 'deliver'
  | 'return'
  | 'payment'
  | 'refund'
  | 'sale'
  | 'close-day'
  | 'reopen-day'
  | 'import-backup'
  | 'reset-data'
  | 'migrate-images'
  | 'archive'
  | 'restore'
  | 'delete';

export type AuditLogEntry = {
  id: string;
  /**
   * Operator this action is attributed to. Optional because every entry written
   * before attribution existed has none, and rewriting history to invent an
   * author would be worse than admitting it is unknown.
   */
  performedBy?: string;
  action: AuditActionType;
  entityType: AuditEntityType;
  entityId: string;
  timestamp: string;
  summary: string;
  previousValues?: Record<string, unknown>;
  nextValues?: Record<string, unknown>;
};

export type AuditLogFilters = {
  search: string;
  entityType: AuditEntityType | 'all';
  action: AuditActionType | 'all';
  /** Narrow the log to one operator. */
  performedBy?: string;
};
