/**
 * Types for automatic PR review feedback loop
 */

export type ReviewPriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ReviewCategory =
  | 'code-quality'
  | 'bug'
  | 'performance'
  | 'security'
  | 'testing'
  | 'documentation'
  | 'style';

export interface ReviewFeedbackItem {
  /** Priority level of the feedback */
  priority: ReviewPriority;

  /** Category of the feedback */
  category: ReviewCategory;

  /** File path relative to repository root */
  file?: string;

  /** Line number or range (e.g., "42" or "42-45") */
  line?: string;

  /** Description of the issue */
  issue: string;

  /** Suggested fix or improvement */
  suggestion: string;
}

export interface ReviewFeedback {
  /** Overall summary of the review */
  summary: string;

  /** List of feedback items */
  items: ReviewFeedbackItem[];

  /** Whether the PR is approved (all issues are info/low priority) */
  approved: boolean;
}

export interface AutoReviewLoopOptions {
  /** GitHub repository (e.g., "owner/repo") */
  repository: string;

  /** PR number */
  prNumber: number;

  /** PR branch name (head branch) */
  prBranch: string;

  /** PR base/target branch (e.g., "main", "develop") */
  baseBranch: string;

  /** Path to Claude CLI executable */
  claudePath: string;

  /** Maximum number of review iterations */
  maxIterations?: number;

  /** Minimum priority to address (default: medium) */
  minPriority?: ReviewPriority;

  /** Working directory for the repository */
  workingDir: string;

  /** Output directory for logs and artifacts */
  outputDir: string;
}

export interface AutoReviewLoopResult {
  /** Number of iterations performed */
  iterations: number;

  /** Whether all critical/high/medium issues were addressed */
  success: boolean;

  /** Final review feedback */
  finalFeedback: ReviewFeedback;

  /** History of all review iterations */
  history: Array<{
    iteration: number;
    feedback: ReviewFeedback;
    addressed: ReviewFeedbackItem[];
  }>;
}
