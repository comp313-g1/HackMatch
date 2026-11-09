
export interface AuditRecord {
  id: string;
  actorId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  reason: string;
  outcome: string;
  createdAt: string;
}

export interface AuditResponse {
  records: AuditRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
