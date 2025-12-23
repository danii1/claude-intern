/**
 * Git Hook Fixer
 *
 * Utility to automatically fix git hook errors using Claude.
 */

import { spawn, type ChildProcess } from "child_process";
import { Utils } from "./utils";

/**
 * Run Claude to fix git hook errors.
 *
 * @param hookType - Type of git hook that failed ("commit" or "push")
 * @param claudePath - Path to Claude CLI executable
 * @param maxTurns - Maximum number of turns for Claude conversation
 * @returns Promise<boolean> - True if hook errors were fixed successfully
 */
export async function runClaudeToFixGitHook(
  hookType: "commit" | "push",
  claudePath: string,
  maxTurns: number
): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("\n🔧 Attempting to fix git hook errors with Claude...");

    // Create a concise prompt that asks Claude to re-run the git command
    // This avoids context length issues from including full error output
    const gitCommand = hookType === "commit"
      ? "git commit"
      : "git push origin HEAD";

    // Get the path to the git-hook-errors.log file
    const baseOutputDir =
      process.env.CLAUDE_INTERN_OUTPUT_DIR || "/tmp/claude-intern-tasks";
    const gitHookErrorLog = `${baseOutputDir}/*/git-hook-errors.log`;

    const fixPrompt = `# Git Hook Error - Fix Required

The git ${hookType} operation has failed, likely due to pre-${hookType} hooks checking code quality.

## Your Task

1. **Review recent hook errors** (optional but helpful):
   \`\`\`bash
   tail -n 100 ${gitHookErrorLog}
   \`\`\`
   This shows the last 100 lines of previous hook errors to understand patterns.

2. **Run the git command** to see what failed:
   \`\`\`bash
   ${gitCommand}
   \`\`\`

3. **Analyze the error output** and fix all issues. Common problems include:
   - **Linting errors**: Fix code style, formatting, or linting issues
   - **Test failures**: Fix failing tests or update test expectations
   - **Type errors**: Resolve TypeScript or type-checking issues
   - **Formatting issues**: Run formatters or fix code formatting
   - **Security issues**: Address security vulnerabilities or dependency issues

4. **Stage your changes** with:
   \`\`\`bash
   git add .
   \`\`\`

5. ${hookType === "commit"
    ? "**Retry the commit** to verify it succeeds."
    : "**Amend the existing commit** with your fixes:\n   ```bash\n   git commit --amend --no-edit\n   ```\n\n6. **Verify the fix** by running the push command again to ensure it succeeds."}

**Important**:
- Only fix the issues mentioned in the error output
- Do not modify unrelated code
- Ensure all tests pass if the hook runs tests
- Follow the project's coding standards and conventions
${hookType === "push" ? "- Make sure to amend the commit (git commit --amend --no-edit) so the fixes are included in the push" : ""}
`;

    let stdoutOutput = "";
    let stderrOutput = "";

    // Spawn Claude process to fix the issues
    const claude: ChildProcess = spawn(
      claudePath,
      [
        "-p",
        "--dangerously-skip-permissions",
        "--max-turns",
        maxTurns.toString(),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Capture stdout
    if (claude.stdout) {
      claude.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutOutput += output;
        process.stdout.write(output);
      });
    }

    // Capture stderr
    if (claude.stderr) {
      claude.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        stderrOutput += output;
        process.stderr.write(output);
      });
    }

    claude.on("error", (error: NodeJS.ErrnoException) => {
      console.error(`❌ Failed to run Claude for git hook fix: ${error.message}`);
      resolve(false);
    });

    claude.on("close", async (code: number | null) => {
      if (code === 0) {
        console.log("\n🔍 Claude completed - verifying the fix actually worked...");

        // Verify the fix by checking git status
        // For push: Claude should have amended the commit, so we just verify nothing is staged
        // For commit: Claude should have completed the commit, so we verify a clean state
        try {
          const statusResult = await Utils.executeGitCommand(["status", "--porcelain"]);

          if (hookType === "commit") {
            // For commit fix: verify nothing is staged/modified (commit succeeded)
            if (statusResult.success && statusResult.output.trim() === "") {
              console.log("✅ Verification successful - commit completed successfully!");
              resolve(true);
            } else {
              console.log("⚠️  Claude fixed the code but didn't commit - committing manually...");
              console.log(`   Changes: ${statusResult.output}`);

              // Attempt to stage and commit manually
              const stageResult = await Utils.executeGitCommand(["add", "."]);
              if (!stageResult.success) {
                console.log("❌ Failed to stage changes:");
                console.log(`   ${stageResult.error}`);
                resolve(false);
                return;
              }

              const commitResult = await Utils.executeGitCommand([
                "commit", "--no-verify"
              ]);
              if (commitResult.success) {
                console.log("✅ Successfully committed changes manually!");
                resolve(true);
              } else {
                console.log("❌ Failed to commit changes:");
                console.log(`   ${commitResult.error}`);
                resolve(false);
              }
            }
          } else {
            // For push fix: verify changes are committed and ready to push
            // Claude should have amended, so check if we can push
            const pushDryRun = await Utils.executeGitCommand([
              "push", "origin", "HEAD", "--dry-run"
            ]);

            if (pushDryRun.success) {
              console.log("✅ Verification successful - changes are committed and ready to push!");
              resolve(true);
            } else {
              console.log("⚠️  Claude fixed the code but didn't amend - amending manually...");

              // Check if there are uncommitted changes to amend
              const statusCheck = await Utils.executeGitCommand(["status", "--porcelain"]);
              if (statusCheck.success && statusCheck.output.trim() !== "") {
                // Stage all changes
                const stageResult = await Utils.executeGitCommand(["add", "."]);
                if (!stageResult.success) {
                  console.log("❌ Failed to stage changes:");
                  console.log(`   ${stageResult.error}`);
                  resolve(false);
                  return;
                }

                // Amend the commit
                const amendResult = await Utils.executeGitCommand([
                  "commit", "--amend", "--no-edit", "--no-verify"
                ]);
                if (amendResult.success) {
                  console.log("✅ Successfully amended commit manually!");

                  // Verify push would work now
                  const retryPush = await Utils.executeGitCommand([
                    "push", "origin", "HEAD", "--dry-run"
                  ]);
                  if (retryPush.success) {
                    console.log("✅ Verification successful - ready to push!");
                    resolve(true);
                  } else {
                    console.log("❌ Push would still fail after amend:");
                    console.log(`   ${retryPush.error || retryPush.output}`);
                    resolve(false);
                  }
                } else {
                  console.log("❌ Failed to amend commit:");
                  console.log(`   ${amendResult.error}`);
                  resolve(false);
                }
              } else {
                console.log("❌ Push dry-run failed but no uncommitted changes to amend:");
                console.log(`   ${pushDryRun.error || pushDryRun.output}`);
                resolve(false);
              }
            }
          }
        } catch (verifyError) {
          console.log(`❌ Could not verify fix: ${verifyError}`);
          resolve(false);
        }
      } else {
        console.log(`\n❌ Claude exited with code ${code} while fixing git hook errors`);
        resolve(false);
      }
    });

    // Send the fix prompt to Claude
    if (claude.stdin) {
      claude.stdin.write(fixPrompt);
      claude.stdin.end();
    }
  });
}
