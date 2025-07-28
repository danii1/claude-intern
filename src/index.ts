#!/usr/bin/env node

import { config } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { program } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import { JiraClient } from './lib/jira-client';
import { ClaudeFormatter } from './lib/claude-formatter';
import { Utils } from './lib/utils';
import { PRManager } from './lib/pr-client';
import { execSync } from 'child_process';

interface ProgramOptions {
  claude: boolean;
  claudePath: string;
  envFile?: string;
  git: boolean;
  verbose: boolean;
  maxTurns: string;
  autoCommit: boolean;
  skipClarityCheck: boolean; // New option to skip clarity check
  createPr: boolean; // New option to create pull request
  prTargetBranch: string; // Target branch for PR
  jql?: string; // JQL query for batch processing
}

interface ClarityAssessment {
  isImplementable: boolean;
  clarityScore: number;
  issues: Array<{
    category: string;
    description: string;
    severity: 'critical' | 'major' | 'minor';
  }>;
  recommendations: string[];
  summary: string;
}

// Load environment variables from multiple possible locations
function loadEnvironment(envFile?: string): void {
  // If user specified a custom env file, use that first
  if (envFile) {
    const customEnvPath = resolve(envFile);
    if (existsSync(customEnvPath)) {
      config({ path: customEnvPath });
      console.log(`📁 Loaded environment from custom file: ${customEnvPath}`);
      return;
    } else {
      console.error(`❌ Specified .env file not found: ${customEnvPath}`);
      process.exit(1);
    }
  }

  // Otherwise, check standard locations
  const envPaths = [
    resolve(process.cwd(), '.env'),           // Current working directory
    resolve(process.env.HOME || '~', '.env'), // Home directory
    resolve(__dirname, '..', '.env'),         // Claude-intern directory (for development)
  ];

  let envLoaded = false;
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      config({ path: envPath });
      envLoaded = true;
      break;
    }
  }

  if (!envLoaded) {
    // Try to load from current directory one more time silently
    const cwdEnv = resolve(process.cwd(), '.env');
    if (existsSync(cwdEnv)) {
      config({ path: cwdEnv });
    }
  }
}

// Load environment variables early (before CLI parsing)
loadEnvironment();

// Function to find executable in PATH (cross-platform)
function findInPath(command: string): string | null {
  try {
    const isWindows = process.platform === 'win32';
    const whichCommand = isWindows ? 'where' : 'which';
    const result = execSync(`${whichCommand} ${command}`, { encoding: 'utf8', stdio: 'pipe' });
    return result.trim().split('\n')[0]; // Take first result on Windows
  } catch {
    return null;
  }
}

// Function to resolve Claude CLI path
function resolveClaudePath(providedPath?: string): string {
  // Determine the command to resolve
  let commandToResolve = providedPath;

  // If no path provided, check environment variable
  if (!commandToResolve) {
    commandToResolve = process.env.CLAUDE_CLI_PATH || 'claude';
  }

  // If user provided a specific non-default path, use it as-is
  if (providedPath && providedPath !== 'claude' && !providedPath.includes('/')) {
    // It's likely a command name, try to find it in PATH first
    const whichResult = findInPath(providedPath);
    if (whichResult) {
      return whichResult;
    }
    return providedPath;
  }

  // If it's an absolute path, use it directly
  if (commandToResolve.startsWith('/') || commandToResolve.includes(':')) {
    return commandToResolve;
  }

  // If it's a relative path, resolve it from current working directory
  if (commandToResolve.includes('/')) {
    const resolvedPath = resolve(process.cwd(), commandToResolve);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  // Try to find the command in PATH
  const whichResult = findInPath(commandToResolve);
  if (whichResult) {
    return whichResult;
  }

  // Final fallback
  return commandToResolve;
}

// Configure CLI
program
  .name('claude-intern')
  .description('Your AI intern for automatically implementing JIRA tasks using Claude. Supports single tasks, multiple tasks, or JQL queries for batch processing.')
  .version('1.0.0')
  .argument('[task-keys...]', 'JIRA task key(s) (e.g., PROJ-123) or use --jql for query-based selection')
  .option('--jql <query>', 'JQL query to fetch multiple issues (e.g., "project = PROJ AND status = \'To Do\'")')
  .option('--no-claude', 'Skip running Claude, just fetch and format the task')
  .option('--claude-path <path>', 'Path to Claude CLI executable', resolveClaudePath())
  .option('--env-file <path>', 'Path to .env file')
  .option('--no-git', 'Skip git branch creation')
  .option('-v, --verbose', 'Verbose output')
  .option('--max-turns <number>', 'Maximum number of turns for Claude', '25')
  .option('--no-auto-commit', 'Skip automatic git commit after Claude completes')
  .option('--skip-clarity-check', 'Skip running Claude for clarity assessment')
  .option('--create-pr', 'Create pull request after implementation')
  .option('--pr-target-branch <branch>', 'Target branch for pull request', 'main')
  .parse();

const options = program.opts<ProgramOptions>();
const taskKeys = program.args;

// Reload environment variables if custom env file was specified
if (options.envFile) {
  loadEnvironment(options.envFile);
} else if (options.verbose) {
  console.log('⚠️  No .env file found in standard locations');
  console.log('   Checked:');
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.env.HOME || '~', '.env'),
    resolve(__dirname, '..', '.env'),
  ];
  envPaths.forEach(path => console.log(`   - ${path}`));
}

// Resolve the final Claude path
const resolvedClaudePath = resolveClaudePath(options.claudePath);
if (options.verbose) {
  console.log(`🤖 Claude CLI path resolved to: ${resolvedClaudePath}`);
}

// Validate environment variables
function validateEnvironment(): void {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease ensure you have a .env file in one of these locations:');
    console.error(`   - Current directory: ${resolve(process.cwd(), '.env')}`);
    console.error(`   - Home directory: ${resolve(process.env.HOME || '~', '.env')}`);
    console.error('\nOr specify a custom .env file with --env-file <path>');
    console.error('Or set these environment variables in your shell.');
    console.error('See .env.sample for reference.');
    process.exit(1);
  }
}

// Function to process a single task
async function processSingleTask(taskKey: string, taskIndex: number = 0, totalTasks: number = 1): Promise<void> {
  try {
    const taskPrefix = totalTasks > 1 ? `[${taskIndex + 1}/${totalTasks}] ` : '';
    console.log(`${taskPrefix}🔍 Fetching JIRA task: ${taskKey}`);

    // Validate environment
    validateEnvironment();

    // Initialize JIRA client
    const jiraClient = new JiraClient(
      process.env.JIRA_BASE_URL!,
      process.env.JIRA_EMAIL!,
      process.env.JIRA_API_TOKEN!
    );

    // Fetch task details
    if (options.verbose) {
      console.log('📥 Fetching issue details...');
    }
    const issue = await jiraClient.getIssue(taskKey);

    if (options.verbose) {
      console.log('💬 Fetching comments...');
    }
    console.log('💬 Fetching comments...');
    const comments = await jiraClient.getIssueComments(taskKey);
    console.log(`✅ Successfully fetched ${comments.length} comments`);

    if (options.verbose) {
      console.log('🔗 Extracting linked resources...');
    }
    console.log('🔗 Extracting linked resources...');
    const linkedResources = jiraClient.extractLinkedResources(issue);
    console.log(`✅ Successfully extracted ${linkedResources.length} linked resources`);

    // Fetch detailed related work items
    console.log('🔗 Fetching related work items...');
    const relatedIssues = await jiraClient.getRelatedWorkItems(issue);
    console.log(`✅ Successfully fetched ${relatedIssues.length} related work items`);

    // Format task details
    console.log('📝 Formatting task details...');
    console.log('🔍 Issue structure:', JSON.stringify({
      key: issue.key,
      hasFields: !!issue.fields,
      fieldKeys: issue.fields ? Object.keys(issue.fields) : [],
      summary: issue.fields?.summary,
      issueType: issue.fields?.issuetype
    }, null, 2));

    let taskDetails;
    try {
      taskDetails = jiraClient.formatIssueDetails(issue, comments, linkedResources, relatedIssues);
      console.log('✅ Successfully formatted task details');
    } catch (formatError) {
      console.error('❌ Error formatting task details:', formatError);
      throw formatError;
    }

    // Display summary
    console.log('\n📋 Task Summary:');
    console.log(`   Key: ${taskDetails.key}`);
    console.log(`   Summary: ${taskDetails.summary}`);
    console.log(`   Type: ${taskDetails.issueType}`);
    console.log(`   Status: ${taskDetails.status}`);
    console.log(`   Priority: ${taskDetails.priority || 'Not specified'}`);
    console.log(`   Assignee: ${taskDetails.assignee || 'Unassigned'}`);

    if (linkedResources.length > 0) {
      console.log(`   Linked Resources: ${linkedResources.length} found`);
      if (options.verbose) {
        linkedResources.forEach(resource => {
          if (resource.url) {
            console.log(`     - ${resource.description}: ${resource.url}`);
          } else if (resource.issueKey) {
            console.log(`     - ${resource.linkType}: ${resource.issueKey}`);
          }
        });
      }
    }

    if (relatedIssues.length > 0) {
      console.log(`   Related Work Items: ${relatedIssues.length} found`);
      if (options.verbose) {
        relatedIssues.forEach(relatedIssue => {
          console.log(`     - ${relatedIssue.linkType}: ${relatedIssue.key} - ${relatedIssue.summary} (${relatedIssue.status})`);
        });
      }
    }

    if (comments.length > 0) {
      console.log(`   Comments: ${comments.length} found`);
    }

    // Create unified task-specific directory structure
    const baseOutputDir = process.env.CLAUDE_INTERN_OUTPUT_DIR || '/tmp/claude-intern-tasks';
    const taskDir = join(baseOutputDir, taskKey.toLowerCase());
    const taskFileName = `task-details.md`;
    
    // Create task directory if it doesn't exist
    mkdirSync(taskDir, { recursive: true });
    
    const outputFile = join(taskDir, taskFileName);
    const attachmentDir = join(taskDir, 'attachments');

    // Download attachments automatically - both direct attachments and embedded ones
    let attachmentMap: Map<string, string> | undefined;
    
    // First, download direct attachments
    if (taskDetails.attachments.length > 0) {
      console.log(`\n📎 Downloading ${taskDetails.attachments.length} direct attachments...`);
      attachmentMap = await jiraClient.downloadIssueAttachments(taskKey, attachmentDir);
    } else {
      attachmentMap = new Map<string, string>();
    }
    
    // Then, scan all HTML content for embedded attachment URLs
    console.log(`\n🔍 Scanning content for embedded attachments...`);
    let allHtmlContent = '';
    
    // Collect all HTML content from descriptions and comments
    if (taskDetails.renderedDescription) {
      allHtmlContent += taskDetails.renderedDescription;
    }
    
    // Add comments
    taskDetails.comments.forEach(comment => {
      if (comment.renderedBody) {
        allHtmlContent += comment.renderedBody;
      }
    });
    
    // Add related issues HTML content
    relatedIssues.forEach(relatedIssue => {
      if (relatedIssue.renderedDescription) {
        allHtmlContent += relatedIssue.renderedDescription;
      }
    });
    
    // Download embedded attachments
    if (allHtmlContent) {
      attachmentMap = await jiraClient.downloadAttachmentsFromContent(allHtmlContent, attachmentDir, attachmentMap);
    }
    
    if (attachmentMap.size > 0) {
      console.log(`✅ Downloaded ${attachmentMap.size} total attachments to: ${attachmentDir}`);
    }
    console.log(`\n💾 Saving formatted task details to: ${outputFile}`);
    ClaudeFormatter.saveFormattedTask(taskDetails, outputFile, process.env.JIRA_BASE_URL!, attachmentMap);

    // Run Claude if requested
    if (options.claude) {
      // Create feature branch before running Claude (unless disabled)
      if (options.git) {
        console.log('\n🌿 Creating feature branch...');
        const branchResult = await Utils.createFeatureBranch(taskKey);

        if (branchResult.success) {
          console.log(`✅ ${branchResult.message}`);
        } else {
          // Check if the failure is due to uncommitted changes
          if (branchResult.message.includes('uncommitted changes')) {
            console.error(`❌ ${branchResult.message}`);
            console.error('Please commit or stash your changes before running claude-intern.');
            console.error('You can use: git add . && git commit -m "your commit message"');
            process.exit(1);
          } else {
            console.log(`⚠️  ${branchResult.message}`);
            console.log('Continuing without creating a feature branch...');
          }
        }
      }

      // Run clarity check first (unless skipped)
      if (!options.skipClarityCheck) {
        console.log('\n🔍 Running basic feasibility assessment...');
        console.log('   (Checking for fundamental requirements only - technical details will be inferred from code)');
        const clarityFile = outputFile.replace('.md', '-clarity.md');
        ClaudeFormatter.saveClarityAssessment(taskDetails, clarityFile, process.env.JIRA_BASE_URL!, attachmentMap);

        try {
          const assessment = await runClarityCheck(clarityFile, resolvedClaudePath, taskKey, jiraClient);

          if (assessment && !assessment.isImplementable) {
            // For batch processing, log and continue; for single task, exit
            if (totalTasks > 1) {
              console.log(`\n⚠️  Task ${taskKey} failed clarity assessment but continuing with batch processing...`);
            } else {
              // Exit early if task is not clear enough (single task mode)
              process.exit(1);
            }
          }

          // Clean up clarity file
          try {
            require('fs').unlinkSync(clarityFile);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        } catch (clarityError) {
          console.warn('⚠️  Feasibility check failed, continuing with implementation:', clarityError);
          console.log('   You can skip feasibility checks with --skip-clarity-check');
        }
      }

      console.log('\n🤖 Running Claude with task details...');
      await runClaude(outputFile, resolvedClaudePath, parseInt(options.maxTurns), taskKey, taskDetails.summary, options.git && options.autoCommit, issue, options.createPr, options.prTargetBranch, jiraClient);
    } else {
      console.log('\n✅ Task details saved. You can now:');
      console.log('   1. Create a feature branch manually:');
      console.log(`      git checkout -b feature/${taskKey.toLowerCase()}`);
      console.log('   2. Run clarity check:');
      console.log(`      ${resolvedClaudePath} -p --dangerously-skip-permissions --max-turns 10 < ${outputFile.replace('.md', '-clarity.md')}`);
      console.log('   3. Run Claude:');
      console.log(`      ${resolvedClaudePath} -p --dangerously-skip-permissions --max-turns ${options.maxTurns} < ${outputFile}`);
      console.log('   4. Commit changes:');
      console.log('      git add . && git commit -m "feat: implement task"');
      console.log('\n   Or run this script again with the same task key to automatically create the branch, run clarity check, invoke Claude, and commit changes.');
    }

  } catch (error) {
    const err = error as Error;
    const taskPrefix = totalTasks > 1 ? `[${taskIndex + 1}/${totalTasks}] ` : '';
    console.error(`${taskPrefix}❌ Error processing ${taskKey}: ${err.message}`);
    if (options.verbose && err.stack) {
      console.error(err.stack);
    }
    
    // For batch processing, throw the error to be handled by the main function
    // For single task processing, exit immediately
    if (totalTasks > 1) {
      throw error;
    } else {
      process.exit(1);
    }
  }
}

// Main execution function
async function main(): Promise<void> {
  try {
    // Validate environment first
    validateEnvironment();

    let tasksToProcess: string[] = [];

    // Determine which tasks to process
    if (options.jql) {
      // JQL query mode
      console.log(`🔍 Searching JIRA with JQL: ${options.jql}`);
      
      const jiraClient = new JiraClient(
        process.env.JIRA_BASE_URL!,
        process.env.JIRA_EMAIL!,
        process.env.JIRA_API_TOKEN!
      );

      const searchResult = await jiraClient.searchIssues(options.jql);
      
      if (searchResult.issues.length === 0) {
        console.log('⚠️  No issues found matching the JQL query');
        return;
      }

      tasksToProcess = searchResult.issues.map(issue => issue.key);
      console.log(`📋 Found ${tasksToProcess.length} tasks to process: ${tasksToProcess.join(', ')}`);
    } else if (taskKeys.length > 0) {
      // Individual task keys mode
      tasksToProcess = taskKeys;
      console.log(`📋 Processing ${tasksToProcess.length} task(s): ${tasksToProcess.join(', ')}`);
    } else {
      // No tasks specified
      console.error('❌ Error: No tasks specified. Provide task keys as arguments or use --jql option.');
      console.error('   Examples:');
      console.error('     claude-intern PROJ-123');
      console.error('     claude-intern PROJ-123 PROJ-124 PROJ-125');
      console.error('     claude-intern --jql "project = PROJ AND status = \'To Do\'"');
      process.exit(1);
    }

    // Process tasks sequentially
    const results = {
      total: tasksToProcess.length,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ taskKey: string, error: string }>
    };

    for (let i = 0; i < tasksToProcess.length; i++) {
      const taskKey = tasksToProcess[i];
      
      try {
        await processSingleTask(taskKey, i, tasksToProcess.length);
        results.successful++;
        
        if (i < tasksToProcess.length - 1) {
          console.log('\n' + '='.repeat(80));
          console.log(`⏭️  Moving to next task...\n`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          taskKey,
          error: (error as Error).message
        });
        
        console.log(`⚠️  Continuing with remaining tasks...\n`);
      }
    }

    // Print summary for batch operations
    if (tasksToProcess.length > 1) {
      console.log('\n' + '='.repeat(80));
      console.log('📊 Batch Processing Summary:');
      console.log(`   Total tasks: ${results.total}`);
      console.log(`   ✅ Successful: ${results.successful}`);
      console.log(`   ❌ Failed: ${results.failed}`);
      
      if (results.errors.length > 0) {
        console.log('\n❌ Failed tasks:');
        results.errors.forEach(({ taskKey, error }) => {
          console.log(`   - ${taskKey}: ${error}`);
        });
      }
      
      if (results.failed > 0) {
        process.exit(1);
      }
    }

  } catch (error) {
    const err = error as Error;
    console.error(`❌ Error: ${err.message}`);
    if (options.verbose && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Function to run Claude clarity assessment
async function runClarityCheck(clarityFile: string, claudePath: string, taskKey: string, jiraClient: JiraClient): Promise<ClarityAssessment | null> {
  return new Promise((resolve, reject) => {
    // Check if clarity file exists
    if (!existsSync(clarityFile)) {
      reject(new Error(`Clarity assessment file not found: ${clarityFile}`));
      return;
    }

    // Read the clarity assessment content
    const clarityContent = readFileSync(clarityFile, 'utf8');

    console.log('🔍 Running feasibility assessment with Claude...');
    console.log(`   Command: ${claudePath} -p --dangerously-skip-permissions --max-turns 10`);
    console.log(`   Input: ${clarityFile}`);

    let stdoutOutput = '';
    let stderrOutput = '';

    // Spawn Claude process for clarity check
    const claude: ChildProcess = spawn(claudePath, ['-p', '--dangerously-skip-permissions', '--max-turns', '10'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Capture stdout for parsing JSON response
    if (claude.stdout) {
      claude.stdout.on('data', (data: Buffer) => {
        stdoutOutput += data.toString();
      });
    }

    // Capture stderr for error handling
    if (claude.stderr) {
      claude.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });
    }

    // Handle errors
    claude.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Claude CLI not found at: ${claudePath}\nPlease install Claude CLI or specify the correct path with --claude-path`));
      } else {
        reject(new Error(`Failed to run Claude clarity check: ${error.message}`));
      }
    });

    // Handle process exit
    claude.on('close', async (code: number | null) => {
      if (code === 0) {
        try {
          // Parse the JSON response from Claude
          const assessment = parseClarityResponse(stdoutOutput);

          if (!assessment.isImplementable) {
            console.log('\n❌ Task feasibility assessment failed');
            console.log(`📊 Clarity Score: ${assessment.clarityScore}/10 (threshold: 4/10)`);
            console.log(`📝 Summary: ${assessment.summary}`);

            if (assessment.issues.length > 0) {
              console.log('\n🚨 Critical issues identified:');
              assessment.issues.forEach((issue, index) => {
                const severityIcon = issue.severity === 'critical' ? '🔴' : issue.severity === 'major' ? '🟡' : '🔵';
                console.log(`   ${severityIcon} ${issue.category}: ${issue.description}`);
              });
            }

            if (assessment.recommendations.length > 0) {
              console.log('\n💡 Recommendations:');
              assessment.recommendations.forEach((rec, index) => {
                console.log(`   ${index + 1}. ${rec}`);
              });
            }

            // Post comment to JIRA with clarity issues
            await postClarityComment(jiraClient, taskKey, assessment);

            console.log('\n🛑 Stopping execution - fundamental requirements unclear');
            console.log('   Please address the critical issues and run again');
            console.log('   Or use --skip-clarity-check to bypass this assessment');
          } else {
            console.log('\n✅ Task feasibility assessment passed');
            console.log(`📊 Clarity Score: ${assessment.clarityScore}/10 (threshold: 4/10)`);
            console.log(`📝 Summary: ${assessment.summary}`);
            if (assessment.clarityScore < 7) {
              console.log('💡 Note: Some details may need to be inferred from existing codebase');
            }

            // Post successful assessment to JIRA as well for feedback
            console.log('\n💬 Posting feasibility assessment to JIRA...');
            await postClarityComment(jiraClient, taskKey, assessment);
          }

          resolve(assessment);
        } catch (parseError) {
          console.warn('Failed to parse clarity assessment response:', parseError);
          console.log('Raw Claude output:', stdoutOutput);
          
          // Check if Claude reached max turns or had other issues
          if (stdoutOutput.includes('Reached max turns') || stdoutOutput.includes('max-turns')) {
            console.log('\n⚠️  Clarity assessment reached maximum conversation turns');
            console.log('   This may indicate task complexity or insufficient details');
            console.log('   Will attempt to proceed with implementation but posting failure to JIRA...\n');
            
            // Post assessment failure to JIRA
            try {
              await postAssessmentFailure(jiraClient, taskKey, 'max-turns', stdoutOutput);
            } catch (jiraError) {
              console.warn('Failed to post assessment failure to JIRA:', jiraError);
            }
          } else {
            console.log('\n⚠️  Could not parse clarity assessment response');
            console.log('   Will attempt to proceed with implementation but posting failure to JIRA...\n');
            
            // Post assessment failure to JIRA
            try {
              await postAssessmentFailure(jiraClient, taskKey, 'parse-error', stdoutOutput);
            } catch (jiraError) {
              console.warn('Failed to post assessment failure to JIRA:', jiraError);
            }
          }
          
          resolve(null); // Continue with implementation if parsing fails
        }
      } else {
        reject(new Error(`Claude clarity check exited with code ${code}`));
      }
    });

    // Send clarity assessment content to Claude
    if (claude.stdin) {
      claude.stdin.write(clarityContent);
      claude.stdin.end();
    }
  });
}

// Function to parse Claude's clarity assessment response
function parseClarityResponse(output: string): ClarityAssessment {
  // Extract JSON from Claude's response
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    // Provide more specific error based on output content
    if (output.includes('Reached max turns') || output.includes('max-turns')) {
      throw new Error('warn: Claude reached max turns - no JSON assessment available');
    } else if (output.trim().length === 0) {
      throw new Error('warn: Empty response from Claude');
    } else {
      throw new Error('warn: No JSON found in Claude response');
    }
  }

  try {
    const assessment = JSON.parse(jsonMatch[1]);

    // Validate required fields
    if (typeof assessment.isImplementable !== 'boolean' ||
      typeof assessment.clarityScore !== 'number' ||
      !Array.isArray(assessment.issues) ||
      !Array.isArray(assessment.recommendations) ||
      typeof assessment.summary !== 'string') {
      throw new Error('warn: Invalid assessment structure - missing required fields');
    }

    return assessment;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`warn: Malformed JSON in Claude response: ${error.message}`);
    }
    throw new Error(`warn: Failed to parse assessment: ${error}`);
  }
}

// Function to post Claude's implementation output to JIRA
async function postImplementationComment(taskKey: string, claudeOutput: string, taskSummary?: string): Promise<void> {
  try {
    // Initialize JIRA client
    const jiraClient = new JiraClient(
      process.env.JIRA_BASE_URL!,
      process.env.JIRA_EMAIL!,
      process.env.JIRA_API_TOKEN!
    );

    // Use the rich text implementation comment method
    await jiraClient.postImplementationComment(taskKey, claudeOutput, taskSummary);
    console.log(`✅ Implementation summary posted to ${taskKey}`);
  } catch (error) {
    throw new Error(`Failed to post implementation comment: ${error}`);
  }
}

// Function to post clarity assessment comment to JIRA
async function postAssessmentFailure(jiraClient: JiraClient, taskKey: string, failureType: 'max-turns' | 'parse-error', rawOutput: string): Promise<void> {
  try {
    const isMaxTurns = failureType === 'max-turns';
    
    const commentBody = {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "panel",
            attrs: { panelType: "warning" },
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "🤖 Claude Intern - Feasibility Assessment Failed", marks: [{ type: "strong" }] }
                ]
              },
              {
                type: "paragraph", 
                content: [
                  { 
                    type: "text", 
                    text: isMaxTurns 
                      ? "⚠️ Assessment reached maximum conversation turns before completion" 
                      : "⚠️ Could not parse feasibility assessment response"
                  }
                ]
              },
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "📋 ", marks: [{ type: "strong" }] },
                  { type: "text", text: "What this means:", marks: [{ type: "strong" }] }
                ]
              },
              ...(isMaxTurns ? [
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "🧩 ", marks: [{ type: "strong" }] },
                            { type: "text", text: "Task complexity: ", marks: [{ type: "strong" }] },
                            { type: "text", text: "The task may involve multiple complex components or interdependencies that require extensive analysis" }
                          ]
                        }
                      ]
                    },
                    {
                      type: "listItem", 
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "📝 ", marks: [{ type: "strong" }] },
                            { type: "text", text: "Insufficient details: ", marks: [{ type: "strong" }] },
                            { type: "text", text: "The task description may lack specific requirements, acceptance criteria, or technical specifications" }
                          ]
                        }
                      ]
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph", 
                          content: [
                            { type: "text", text: "🔍 ", marks: [{ type: "strong" }] },
                            { type: "text", text: "Context discovery: ", marks: [{ type: "strong" }] },
                            { type: "text", text: "Extensive codebase exploration was needed to understand existing patterns and architecture" }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "🚀 ", marks: [{ type: "strong" }] },
                    { type: "text", text: "Next steps:", marks: [{ type: "strong" }] }
                  ]
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Implementation will proceed with available information" }
                          ]
                        }
                      ]
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Additional clarification may be requested during development" }
                          ]
                        }
                      ]
                    },
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Consider adding more specific acceptance criteria for future similar tasks" }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ] : [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "The AI assessment tool encountered an unexpected response format. Implementation will proceed but may require manual review of results." }
                  ]
                }
              ])
            ]
          }
        ]
      }
    };
    
    // Use the same API call pattern as other rich text comments
    await (jiraClient as any).jiraApiCall('POST', `/rest/api/3/issue/${taskKey}/comment`, commentBody);
  } catch (error) {
    console.warn('Failed to post assessment failure to JIRA:', error);
  }
}

async function postClarityComment(jiraClient: JiraClient, taskKey: string, assessment: ClarityAssessment): Promise<void> {
  try {
    // Use the rich text clarity comment method
    await jiraClient.postClarityComment(taskKey, assessment);
  } catch (error) {
    console.warn('Failed to post clarity comment to JIRA:', error);
  }
}

// Function to run Claude with the formatted task
async function runClaude(taskFile: string, claudePath: string, maxTurns: number = 25, taskKey?: string, taskSummary?: string, enableGit: boolean = true, issue?: any, createPr: boolean = false, prTargetBranch: string = 'main', jiraClient?: JiraClient): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if task file exists
    if (!existsSync(taskFile)) {
      reject(new Error(`Task file not found: ${taskFile}`));
      return;
    }

    // Read the task content
    const taskContent = readFileSync(taskFile, 'utf8');

    console.log('🚀 Launching Claude...');
    console.log(`   Command: ${claudePath} -p --dangerously-skip-permissions --max-turns ${maxTurns} --verbose`);
    console.log(`   Input: ${taskFile}`);
    console.log('   Output: All Claude output will be displayed below in real-time');
    console.log('\n' + '='.repeat(60));

    // Capture stderr to detect max turns error and stdout for JIRA comment
    let stderrOutput = '';
    let stdoutOutput = '';

    // Spawn Claude process with enhanced permissions and max turns
    // stdio configuration:
    // - stdin: 'pipe' (we write task content to it)
    // - stdout: 'pipe' (we capture it for JIRA comment while also showing to user)
    // - stderr: 'pipe' (we capture it for error detection while also showing to user)
    const claude: ChildProcess = spawn(claudePath, ['-p', '--dangerously-skip-permissions', '--max-turns', maxTurns.toString()], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Capture and display stdout output
    if (claude.stdout) {
      claude.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        stdoutOutput += output;
        // Immediately write stdout output to user (no buffering)
        process.stdout.write(output);
      });
    }

    // Capture stderr output for error detection while ensuring it's visible to user
    if (claude.stderr) {
      claude.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrOutput += output;
        // Immediately write stderr output to user (no buffering)
        process.stderr.write(output);
      });
    }

    // Handle errors
    claude.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Claude CLI not found at: ${claudePath}\nPlease install Claude CLI or specify the correct path with --claude-path`));
      } else {
        reject(new Error(`Failed to run Claude: ${error.message}`));
      }
    });

    // Handle process exit
    claude.on('close', async (code: number | null) => {
      console.log('\n' + '='.repeat(60));

      // Check for max turns error in stderr output
      const maxTurnsReached = stderrOutput.includes('Reached max turns') ||
        stderrOutput.includes('max turns reached') ||
        stderrOutput.includes('maximum turns reached');

      if (maxTurnsReached) {
        console.log('❌ Claude reached maximum turns limit without completing the task');
        console.log('   The task may be too complex or require more turns to complete');
        console.log('   Consider breaking it into smaller tasks or increasing the max-turns limit');
        console.log('   No JIRA comment will be posted as the implementation is incomplete');
        reject(new Error('Claude reached maximum turns limit. The task may be too complex or require more turns to complete. Consider breaking it into smaller tasks or increasing the max-turns limit.'));
        return;
      }

      // Check for genuine failure indicators in the output
      const hasErrors = stderrOutput.includes('Error:') && !stderrOutput.includes('Reached max turns');

      // Look for genuine failure patterns, not just words that might appear in implementation summaries
      const hasGenuineFailures = /I (?:was unable to|cannot|could not|failed to)/i.test(stdoutOutput) ||
        stdoutOutput.includes('implementation was unsuccessful') ||
        stdoutOutput.includes('failed to implement') ||
        stdoutOutput.includes('I apologize, but I');

      if (code === 0) {
        // Even if exit code is 0, check if Claude actually completed meaningful work
        const hasMinimalOutput = stdoutOutput.trim().length < 100;
        const seemsIncomplete = hasErrors || hasGenuineFailures || hasMinimalOutput;

        if (seemsIncomplete) {
          console.log('⚠️  Claude execution completed but appears to be incomplete or failed');
          console.log('   No JIRA comment will be posted due to insufficient implementation');
          console.log('   Check the output above for specific issues');
        } else {
          console.log('✅ Claude execution completed successfully');

          // Post Claude's output to JIRA only if implementation seems successful
          if (taskKey && stdoutOutput.trim()) {
            try {
              console.log('\n💬 Posting implementation summary to JIRA...');
              await postImplementationComment(taskKey, stdoutOutput, taskSummary);
            } catch (commentError) {
              console.warn(`⚠️  Failed to post implementation comment to JIRA: ${commentError}`);
              console.log('   Implementation completed successfully, but JIRA comment failed');
            }
          }
        }

        // Commit changes if git is enabled and we have task details
        if (enableGit && taskKey && taskSummary) {
          console.log('\n📝 Committing changes...');
          Utils.commitChanges(taskKey, taskSummary).then(async (commitResult) => {
            if (commitResult.success) {
              console.log(`✅ ${commitResult.message}`);

              // Create pull request if requested
              if (createPr && issue) {
                console.log('\n📤 Pushing branch to remote...');
                const pushResult = await Utils.pushCurrentBranch();

                if (pushResult.success) {
                  console.log(`✅ ${pushResult.message}`);

                  console.log('\n🔀 Creating pull request...');
                  try {
                    const prManager = new PRManager();
                    const currentBranch = await Utils.getCurrentBranch();

                    if (currentBranch) {
                      const prResult = await prManager.createPullRequest(
                        issue,
                        currentBranch,
                        prTargetBranch,
                        stdoutOutput // Use Claude's output as implementation summary
                      );

                      if (prResult.success) {
                        console.log(`✅ Pull request created: ${prResult.url}`);
                        
                        // Transition JIRA status if configured
                        const prStatus = process.env.JIRA_PR_STATUS;
                        if (prStatus && prStatus.trim() && taskKey && jiraClient) {
                          try {
                            console.log('\n🔄 Transitioning JIRA status after PR creation...');
                            await jiraClient.transitionIssue(taskKey, prStatus.trim());
                          } catch (statusError) {
                            console.warn(`⚠️  Failed to transition JIRA status: ${(statusError as Error).message}`);
                            console.log('   PR was created successfully, but status transition failed');
                          }
                        }
                      } else {
                        console.log(`⚠️  PR creation failed: ${prResult.message}`);
                      }
                    } else {
                      console.log('⚠️  Could not determine current branch for PR creation');
                    }
                  } catch (prError) {
                    console.log(`⚠️  PR creation failed: ${(prError as Error).message}`);
                  }
                } else {
                  console.log(`⚠️  Failed to push branch: ${pushResult.message}`);
                  console.log('   Cannot create PR without pushing branch to remote');
                }
              }
            } else {
              console.log(`⚠️  ${commitResult.message}`);
              console.log('You can commit changes manually with: git add . && git commit -m "feat: implement task"');
            }
            resolve();
          }).catch(commitError => {
            console.log(`⚠️  Failed to commit changes: ${commitError.message}`);
            console.log('You can commit changes manually with: git add . && git commit -m "feat: implement task"');
            resolve(); // Still resolve since Claude succeeded
          });
        } else {
          resolve();
        }
      } else {
        console.log(`❌ Claude exited with non-zero code ${code}`);
        console.log('   No JIRA comment will be posted due to execution failure');
        reject(new Error(`Claude exited with code ${code}`));
      }
    });

    // Send task content to Claude
    if (claude.stdin) {
      claude.stdin.write(taskContent);
      claude.stdin.end();
    }
  });
}

// Handle uncaught errors
process.on('unhandledRejection', (error: Error) => {
  console.error('❌ Unhandled error:', error.message);
  if (options.verbose && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main();
}

export { main, JiraClient, ClaudeFormatter }; 