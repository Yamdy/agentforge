/**
 * Security policy for production agent (M6).
 *
 * Controls which paths and operations are allowed for tools.
 */

export interface SecurityPolicyConfig {
  /** Allowed path prefixes for file operations */
  allowedPaths: string[];
  /** Blocked path patterns */
  blockedPatterns: RegExp[];
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Whether to allow network access */
  allowNetwork: boolean;
}

const defaultConfig: SecurityPolicyConfig = {
  allowedPaths: [
    process.cwd(),
  ],
  blockedPatterns: [
    /\/etc\/passwd/,
    /\/\.ssh\//,
    /\/\.env$/,
    /\.key$/,
    /\.pem$/,
  ],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowNetwork: false,
};

export class ToolSecurityPolicy {
  private config: SecurityPolicyConfig;

  constructor(config: SecurityPolicyConfig = defaultConfig) {
    this.config = config;
  }

  /**
   * Check if a file path is allowed by the security policy.
   */
  isPathAllowed(filePath: string): boolean {
    // Check blocked patterns first
    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(filePath)) {
        return false;
      }
    }

    // Check allowed paths
    return this.config.allowedPaths.some((allowed) =>
      filePath.startsWith(allowed)
    );
  }

  /**
   * Check if a file size is within limits.
   */
  isFileSizeAllowed(size: number): boolean {
    return size <= this.config.maxFileSize;
  }

  /**
   * Check if network access is allowed.
   */
  isNetworkAllowed(): boolean {
    return this.config.allowNetwork;
  }
}

export const securityPolicy = new ToolSecurityPolicy();