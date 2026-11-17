import type { Lead, LeadNote } from '../../../../shared/schemas';
import type { TaskKind, TaskPriority, WorkRole } from '../../../../shared/team/workspace';

export interface WorkTask {
  id: string;
  leadId: string;
  leadName: string;
  assigneeId: string;
  kind: TaskKind;
  title: string;
  priority: TaskPriority;
  notes: string;
  dueAt: string;
  timeZone: string;
  doneAt: string | null;
  doneBy: string;
  reschedules: number;
  createdBy: string;
  createdAt: string;
  doNotContact: boolean;
}
export interface TimelineItem {
  id: string;
  at: string;
  type: string;
  title: string;
  detail: Record<string, unknown> | null;
  actor: string;
  system: boolean;
}
export interface LeadService {
  category: string;
  provider: string;
  monthlyCents: number | null;
  plan: string;
  concerns: string;
  details: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}
export interface Workspace {
  lead: Lead;
  timeline: TimelineItem[];
  notes: LeadNote[];
  tasks: WorkTask[];
  services: LeadService[];
  duplicates: { id: string; name: string; status: string; outcome: string; createdAt: string; matchedOn: string[] }[];
  me: { role: WorkRole; name: string; id: string };
  can: { reassign: boolean; verifyWins: boolean; reopen: boolean; clearDnc: boolean; editAnyNote: boolean };
  representatives?: { id: string; name: string; openLeads: number; accepting: boolean }[];
}
