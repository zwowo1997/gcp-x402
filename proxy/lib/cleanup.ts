import { CloudTasksClient } from "@google-cloud/tasks";
import { config } from "./config";

/** Schedule one authenticated cleanup task. Provisioning fails closed when it cannot be scheduled. */
export async function scheduleCleanup(jobId: string, expiresAt: Date): Promise<void> {
  if (!config.tasksQueue || !config.publicBaseUrl || !config.cleanupToken) {
    throw new Error("CLOUD_TASKS_QUEUE, PUBLIC_BASE_URL, and CLEANUP_TOKEN are required for safe provisioning.");
  }
  const client = new CloudTasksClient();
  const parent = client.queuePath(config.gcpProjectId, config.tasksLocation, config.tasksQueue);
  const task = {
    httpRequest: {
      httpMethod: "POST" as const,
      url: `${config.publicBaseUrl}/api/internal/cleanup`,
      headers: { "content-type": "application/json", "x-cleanup-token": config.cleanupToken },
      body: Buffer.from(JSON.stringify({ jobId })),
    },
    scheduleTime: { seconds: Math.floor(expiresAt.getTime() / 1000) },
  };
  await client.createTask({ parent, task });
}
