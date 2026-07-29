import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { getCurrentOperatorName } from '../operators/operator.service';
import type { AuditLogEntry, AuditLogFilters } from './audit.types';

const COLLECTION = 'audit-log';

export type RecordAuditInput = Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string };

export function getAuditLog(): AuditLogEntry[] {
  return readCollection<AuditLogEntry>(COLLECTION, []);
}

export function recordAudit(input: RecordAuditInput): AuditLogEntry {
  const entry: AuditLogEntry = {
    ...input,
    id: generateId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    // Stamped centrally: no caller can forget to record who acted.
    performedBy: input.performedBy ?? getCurrentOperatorName(),
  };

  writeCollection(COLLECTION, [entry, ...getAuditLog()]);
  return entry;
}

export function filterAuditLog(entries: AuditLogEntry[], filters: AuditLogFilters): AuditLogEntry[] {
  const search = filters.search.trim().toLowerCase();

  return entries.filter((entry) => {
    const matchesEntity = filters.entityType === 'all' || entry.entityType === filters.entityType;
    const matchesAction = filters.action === 'all' || entry.action === filters.action;
    const matchesOperator = !filters.performedBy || entry.performedBy === filters.performedBy;
    const matchesSearch =
      !search ||
      entry.summary.toLowerCase().includes(search) ||
      entry.entityId.toLowerCase().includes(search) ||
      entry.entityType.toLowerCase().includes(search) ||
      entry.action.toLowerCase().includes(search) ||
      (entry.performedBy ?? '').toLowerCase().includes(search);

    return matchesEntity && matchesAction && matchesOperator && matchesSearch;
  });
}
