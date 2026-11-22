import path from 'node:path';

/**
 * Workspace Boundary Guard.
 * Ensures all file operations remain strictly confined within the project workspace.
 */
export function validateWorkspacePath(inputPath: string, projectRoot: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(projectRoot, inputPath);

  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(
      `Security Violation: Path traversal blocked. Target '${inputPath}' escapes workspace root '${projectRoot}'.`
    );
  }

  return resolvedTarget;
}

/**
 * Secret Leak Interceptor.
 * Prevents writing files containing unmasked credentials or private keys.
 */
export function checkSecretLeak(content: string): { hasLeak: boolean; reason?: string } {
  // Check for private key headers
  if (content.includes('BEGIN PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE KEY')) {
    return {
      hasLeak: true,
      reason: 'Hardcoded private key detected in source payload',
    };
  }

  // Check for common API token prefixes
  const secretPatterns = [
    /ghp_[a-zA-Z0-9]{36}/,        // GitHub personal access token
    /gho_[a-zA-Z0-9]{36}/,        // GitHub OAuth token
    /sk-[a-zA-Z0-9]{32,}/,        // OpenAI / API secret keys
    /xox[baprs]-[0-9a-zA-Z]{10,}/, // Slack tokens
    /AIza[0-9A-Za-z-_]{35}/,      // Google API keys
  ];

  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      return {
        hasLeak: true,
        reason: `Potential secret or API token matching pattern '${pattern.source}' detected`,
      };
    }
  }

  return { hasLeak: false };
}
