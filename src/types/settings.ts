// Settings types for .claude-intern/settings.json

/**
 * Per-project configuration settings
 */
export interface ProjectSettings {
  /**
   * JIRA project configurations
   * Key is the JIRA project key (e.g., "PROJ", "ABC")
   * Value is the configuration for that project
   */
  projects?: {
    [projectKey: string]: {
      /**
       * JIRA status to transition to after PR creation
       * e.g., "In Review", "Code Review", "Ready for Review"
       */
      prStatus?: string;
    };
  };
}
