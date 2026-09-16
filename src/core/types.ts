/**
 * SendAPigeon data model.
 *
 * Every record is one line of JSON in a .jsonl file. Fields are deliberately
 * flat, optional and stringly-typed where possible so the files stay easy to
 * diff, grep, hand-edit and import into anything else.
 */

export type EntityKind = 'company' | 'person' | 'deal' | 'todo' | 'note';

export interface BaseRecord {
  /** Human-readable slug, stable for the life of the record. */
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Freeform labels. Lowercased on write. */
  tags?: string[];
  /** Anything the schema does not know about is preserved verbatim. */
  [key: string]: unknown;
}

export interface Company extends BaseRecord {
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  size?: string;
  location?: string;
  phone?: string;
  owner?: string;
  description?: string;
  archived?: boolean;
}

export interface Person extends BaseRecord {
  name: string;
  /** Company id. People live under a company. */
  companyId?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  /** Latest workflow milestone reached. The following stage is the open to-do. */
  stage?: string;
  /** Named people workflow this contact belongs to. */
  boardId?: string;
  /** Set when the final workflow stage is checked off. */
  stageCompletedAt?: string;
  /** Keeps the contact in the CRM while excluding them from workflow boards. */
  workflowExcluded?: boolean;
  location?: string;
  owner?: string;
  description?: string;
  archived?: boolean;
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal extends BaseRecord {
  title: string;
  companyId?: string;
  /** Contacts attached to this deal. */
  personIds?: string[];
  /** Must match a stage id in pigeon.json. */
  stage: string;
  status: DealStatus;
  value?: number;
  currency?: string;
  probability?: number;
  expectedCloseDate?: string;
  closedAt?: string;
  lostReason?: string;
  source?: string;
  owner?: string;
  description?: string;
  /** Manual ordering within a kanban column. Lower sorts first. */
  order?: number;
}

export type Priority = 'low' | 'normal' | 'high';

export interface Todo extends BaseRecord {
  title: string;
  done: boolean;
  dueDate?: string;
  priority?: Priority;
  companyId?: string;
  personId?: string;
  dealId?: string;
  /** A configured workflow stage when this todo drives board progress. */
  stageId?: string;
  /** People workflow owning stageId. Absent on legacy default-board todos. */
  boardId?: string;
  owner?: string;
  notes?: string;
  completedAt?: string;
}

/** Notes are markdown files; this is the frontmatter plus derived fields. */
export interface Note {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  type?: string;
  companyId?: string;
  dealId?: string;
  /** Person ids present at the meeting. */
  attendees?: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  /** Path relative to the vault root. */
  path: string;
  /** Markdown body, excluding frontmatter. Omitted from list responses. */
  body?: string;
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  name: string;
  /** Default win probability for deals landing in this stage. */
  probability?: number;
}

export interface PeopleBoardTemplate {
  id: string;
  name: string;
  stages: Stage[];
}

export interface VaultConfig {
  version: number;
  name: string;
  currency: string;
  /** Kanban columns, in board order. */
  stages: Stage[];
  /** Named contact workflows. The first is the default for new people. */
  peopleBoards: PeopleBoardTemplate[];
  /** Optional default owner stamped onto new records. */
  owner?: string;
}

export interface ActivityEvent {
  ts: string;
  /** created | updated | deleted | stage_changed | won | lost | completed ... */
  action: string;
  kind: EntityKind;
  id: string;
  /** Who or what did it: "cli", "mcp", "api", "web", or a named agent. */
  actor?: string;
  summary?: string;
  changes?: Record<string, unknown>;
}

export const DEFAULT_STAGES: Stage[] = [
  { id: 'lead', name: 'Lead In', probability: 10 },
  { id: 'contacted', name: 'Contacted', probability: 25 },
  { id: 'demo', name: 'Demo', probability: 40 },
  { id: 'proposal', name: 'Proposal', probability: 60 },
  { id: 'negotiation', name: 'Negotiation', probability: 80 },
];

export const DEFAULT_CONFIG: VaultConfig = {
  version: 1,
  name: 'SendAPigeon',
  currency: 'AUD',
  stages: DEFAULT_STAGES,
  peopleBoards: [{ id: 'people', name: 'People workflow', stages: DEFAULT_STAGES }],
};
