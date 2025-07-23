export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: {
    '16x16': string;
    '24x24': string;
    '32x32': string;
    '48x48': string;
  };
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
}

export interface JiraStatus {
  id: string;
  name: string;
  description?: string;
  statusCategory: {
    id: number;
    name: string;
    key: string;
    colorName: string;
  };
}

export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraComponent {
  id: string;
  name: string;
  description?: string;
}

export interface JiraVersion {
  id: string;
  name: string;
  description?: string;
  released: boolean;
  releaseDate?: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
  created: string;
  author: JiraUser;
}

export interface JiraIssueLink {
  id: string;
  type: {
    id: string;
    name: string;
    inward: string;
    outward: string;
  };
  inwardIssue?: {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority;
      issuetype: JiraIssueType;
    };
  };
  outwardIssue?: {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority;
      issuetype: JiraIssueType;
    };
  };
}

export interface AtlassianDocumentNode {
  type: string;
  attrs?: Record<string, any>;
  content?: AtlassianDocumentNode[];
  marks?: Array<{
    type: string;
    attrs?: Record<string, any>;
  }>;
  text?: string;
}

export interface AtlassianDocument {
  version: number;
  type: 'doc';
  content: AtlassianDocumentNode[];
}

export interface JiraComment {
  id: string;
  body: AtlassianDocument | string;
  renderedBody?: string;
  author: JiraUser;
  created: string;
  updated: string;
  visibility?: {
    type: string;
    value: string;
  };
}

export interface JiraIssueFields {
  summary: string;
  description?: AtlassianDocument | string;
  issuetype: JiraIssueType;
  status: JiraStatus;
  priority?: JiraPriority;
  assignee?: JiraUser;
  reporter: JiraUser;
  created: string;
  updated: string;
  labels: string[];
  components: JiraComponent[];
  fixVersions: JiraVersion[];
  attachment: JiraAttachment[];
  issuelinks: JiraIssueLink[];
  [key: string]: any; // For custom fields
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
  names?: Record<string, string>;
  renderedFields?: {
    description?: string;
    [key: string]: any;
  };
  changelog?: {
    histories: Array<{
      id: string;
      author: JiraUser;
      created: string;
      items: Array<{
        field: string;
        fieldtype: string;
        from?: string;
        fromString?: string;
        to?: string;
        toString?: string;
      }>;
    }>;
  };
}

export interface JiraCommentsResponse {
  comments: JiraComment[];
  maxResults: number;
  total: number;
  startAt: number;
}

export interface LinkedResource {
  type: 'custom_field_link' | 'description_link' | 'rich_text_link' | 'issue_link';
  field?: string;
  url?: string;
  description: string;
  linkType?: string;
  issueKey?: string;
  summary?: string;
}

export interface DetailedRelatedIssue {
  key: string;
  summary: string;
  description?: AtlassianDocument | string;
  renderedDescription?: string;
  issueType: string;
  status: string;
  priority?: string;
  assignee?: string;
  reporter: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  linkType: string; // e.g., "blocks", "is blocked by", "relates to", "subtask", "parent"
  relationshipDirection: 'inward' | 'outward' | 'subtask' | 'parent';
}

export interface FormattedTaskDetails {
  key: string;
  summary: string;
  description?: AtlassianDocument | string;
  renderedDescription?: string;
  issueType: string;
  status: string;
  priority?: string;
  assignee?: string;
  reporter: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  linkedResources: LinkedResource[];
  relatedIssues: DetailedRelatedIssue[]; // New field for detailed related work items
  comments: Array<{
    id: string;
    author: string;
    body: AtlassianDocument | string;
    renderedBody?: string;
    created: string;
    updated: string;
  }>;
  attachments: Array<{
    filename: string;
    size: number;
    mimeType: string;
    created: string;
    author: string;
    content: string;
  }>;
}

export interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
} 