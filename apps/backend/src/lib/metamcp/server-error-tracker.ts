import { McpServerErrorStatusEnum } from "@repo/zod-types";

import { namespaceMappingsRepository } from "../../db/repositories/index";

export interface ServerCrashInfo {
  serverUuid: string;
  namespaceUuid: string;
  exitCode: number | null;
  signal: string | null;
  timestamp: Date;
}

export class ServerErrorTracker {
  private static instance: ServerErrorTracker | null = null;

  // Track crash attempts per server per namespace
  private crashAttempts: Map<string, Map<string, number>> = new Map();

  // Default max attempts before marking as ERROR
  private readonly defaultMaxAttempts: number = 1;

  // Server-specific max attempts (can be configured per server)
  private serverMaxAttempts: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): ServerErrorTracker {
    if (!ServerErrorTracker.instance) {
      ServerErrorTracker.instance = new ServerErrorTracker();
    }
    return ServerErrorTracker.instance;
  }

  /**
   * Set max attempts for a specific server
   */
  setServerMaxAttempts(serverUuid: string, maxAttempts: number): void {
    this.serverMaxAttempts.set(serverUuid, maxAttempts);
  }

  /**
   * Get max attempts for a specific server
   */
  getServerMaxAttempts(serverUuid: string): number {
    return this.serverMaxAttempts.get(serverUuid) || this.defaultMaxAttempts;
  }

  /**
   * Record a server crash and check if it should be marked as ERROR
   */
  async recordServerCrash(
    serverUuid: string,
    namespaceUuid: string,
    exitCode: number | null,
    signal: string | null,
  ): Promise<void> {
    // Get current attempt count
    const currentAttempts =
      this.crashAttempts.get(serverUuid)?.get(namespaceUuid) || 0;
    const newAttempts = currentAttempts + 1;

    // Update crash attempts tracking
    if (!this.crashAttempts.has(serverUuid)) {
      this.crashAttempts.set(serverUuid, new Map());
    }
    this.crashAttempts.get(serverUuid)?.set(namespaceUuid, newAttempts);

    const maxAttempts = this.getServerMaxAttempts(serverUuid);

    console.log(
      `Server ${serverUuid} crashed in namespace ${namespaceUuid}. Attempt ${newAttempts}/${maxAttempts}`,
    );

    // If we've reached max attempts, mark the server as ERROR
    if (newAttempts >= maxAttempts) {
      console.warn(
        `Server ${serverUuid} has crashed ${newAttempts} times in namespace ${namespaceUuid}. Marking as ERROR.`,
      );

      try {
        await this.markServerAsError(serverUuid, namespaceUuid);

        // Log the crash info
        const crashInfo: ServerCrashInfo = {
          serverUuid,
          namespaceUuid,
          exitCode,
          signal,
          timestamp: new Date(),
        };

        console.error(
          "Server marked as ERROR due to repeated crashes:",
          crashInfo,
        );
      } catch (error) {
        console.error(
          `Failed to mark server ${serverUuid} as ERROR in namespace ${namespaceUuid}:`,
          error,
        );
      }
    }
  }

  /**
   * Mark a server as ERROR in a specific namespace
   */
  private async markServerAsError(
    serverUuid: string,
    namespaceUuid: string,
  ): Promise<void> {
    await namespaceMappingsRepository.updateServerErrorStatus({
      namespaceUuid,
      serverUuid,
      errorStatus: McpServerErrorStatusEnum.Enum.ERROR,
    });
  }

  /**
   * Reset crash attempts for a server in a namespace (e.g., after successful recovery)
   */
  resetServerAttempts(serverUuid: string, namespaceUuid: string): void {
    const serverAttempts = this.crashAttempts.get(serverUuid);
    if (serverAttempts) {
      serverAttempts.delete(namespaceUuid);

      // Clean up empty server entry
      if (serverAttempts.size === 0) {
        this.crashAttempts.delete(serverUuid);
      }
    }
  }

  /**
   * Reset crash attempts for all namespaces of a server
   */
  resetServerAttemptsForAllNamespaces(serverUuid: string): void {
    this.crashAttempts.delete(serverUuid);
  }

  /**
   * Get current crash attempts for a server in a namespace
   */
  getServerAttempts(serverUuid: string, namespaceUuid: string): number {
    return this.crashAttempts.get(serverUuid)?.get(namespaceUuid) || 0;
  }

  /**
   * Check if a server is in ERROR state for a namespace
   */
  async isServerInErrorState(
    serverUuid: string,
    namespaceUuid: string,
  ): Promise<boolean> {
    try {
      const mapping = await namespaceMappingsRepository.findServerMapping(
        namespaceUuid,
        serverUuid,
      );
      return mapping?.error_status === McpServerErrorStatusEnum.Enum.ERROR;
    } catch (error) {
      console.error(
        `Error checking server error state for ${serverUuid} in ${namespaceUuid}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Reset error state for a server in a namespace (e.g., after manual recovery)
   */
  async resetServerErrorState(
    serverUuid: string,
    namespaceUuid: string,
  ): Promise<void> {
    try {
      // Reset crash attempts
      this.resetServerAttempts(serverUuid, namespaceUuid);

      // Update the database to clear the error status
      await namespaceMappingsRepository.updateServerErrorStatus({
        namespaceUuid,
        serverUuid,
        errorStatus: McpServerErrorStatusEnum.Enum.NONE,
      });

      console.log(
        `Reset error state for server ${serverUuid} in namespace ${namespaceUuid}`,
      );
    } catch (error) {
      console.error(
        `Error resetting error state for server ${serverUuid} in namespace ${namespaceUuid}:`,
        error,
      );
    }
  }
}

// Export singleton instance
export const serverErrorTracker = ServerErrorTracker.getInstance();
