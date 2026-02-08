import { Platform } from "../enums";

const API_BASE_URL = "https://botster.io/api/v2";

const PLATFORM_ENDPOINTS: Record<Platform, string> = {
  [Platform.GOOGLE_MAPS]: `${API_BASE_URL}/bots/google-maps-reviews-scraper`,
  [Platform.TRIPADVISOR]: `${API_BASE_URL}/bots/tripadvisor-reviews-scraper`,
  [Platform.BOOKING]: `${API_BASE_URL}/bots/booking-review-scraper`,
  [Platform.TRUSTPILOT]: "", // No Botster endpoint — imported via JSON
};

interface BotsterJobPayload {
  input: string[];
  depth?: number;
  sort?: string;
  new_items_only?: boolean;
  coordinates?: { latitude: number; longitude: number; zoom: string };
  tripadvisor_language?: string;
}

interface BotsterJob {
  id: string;
  state: string;
  finished: boolean;
  created_at: number;
  runs?: { id: string }[];
}

interface BotsterJobResponse {
  job: BotsterJob;
}

interface BotsterJobsPage {
  jobs: BotsterJob[];
}

export interface BotsterClientConfig {
  apiKey: string;
  requestDelay?: number;
  archiveBatchDelay?: number;
}

export class BotsterClient {
  private apiKey: string;
  private requestDelay: number;
  private archiveBatchDelay: number;

  constructor(config: BotsterClientConfig) {
    this.apiKey = config.apiKey;
    this.requestDelay = config.requestDelay ?? 1000;
    this.archiveBatchDelay = config.archiveBatchDelay ?? 3000;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    retries = 3,
  ): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const res = await fetch(url, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        const backoff = Math.pow(2, attempt) * 1000;
        await this.sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Botster API ${method} ${url} → ${res.status}: ${text}`);
      }

      return res.json() as T;
    }

    throw new Error(`Botster API ${method} ${url} → max retries exceeded`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -- Job lifecycle --

  async createJob(
    platform: Platform,
    payload: BotsterJobPayload,
  ): Promise<string> {
    const endpoint = PLATFORM_ENDPOINTS[platform];
    if (!endpoint) throw new Error(`No Botster endpoint for ${platform}`);

    // Remove undefined/null values
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v != null),
    );

    const data = await this.request<BotsterJobResponse>(
      "POST",
      endpoint,
      cleanPayload,
    );
    return data.job.id;
  }

  async getJobStatus(jobId: string): Promise<BotsterJob> {
    const data = await this.request<BotsterJobResponse>(
      "GET",
      `${API_BASE_URL}/jobs/${jobId}`,
    );
    return data.job;
  }

  async getRunResults(runId: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<Record<string, unknown>[]>(
      "GET",
      `${API_BASE_URL}/runs/${runId}`,
    );
    return data;
  }

  async getJobResults(jobId: string): Promise<Record<string, unknown>[]> {
    const job = await this.getJobStatus(jobId);
    const runs = job.runs ?? [];
    if (runs.length === 0) return [];
    const lastRunId = runs[runs.length - 1].id;
    return this.getRunResults(lastRunId);
  }

  async restartJob(jobId: string): Promise<void> {
    await this.request<unknown>("POST", `${API_BASE_URL}/jobs/${jobId}/restart`);
  }

  async archiveJob(jobId: string): Promise<void> {
    await this.request<unknown>("POST", `${API_BASE_URL}/jobs/${jobId}/archive`);
  }

  // -- Job listing (paginated) --

  async *listJobs(perPage = 50): AsyncGenerator<BotsterJob[]> {
    let page = 1;
    while (true) {
      const data = await this.request<BotsterJobsPage>(
        "GET",
        `${API_BASE_URL}/jobs?page=${page}&per=${perPage}`,
      );
      const jobs = data.jobs ?? [];
      if (jobs.length > 0) yield jobs;
      if (jobs.length < perPage) break;
      page++;
      await this.sleep(this.requestDelay);
    }
  }

  // -- Bulk archive (rate-limited) --

  async archiveOldJobs(daysThreshold = 14): Promise<{ archived: number; errors: number }> {
    const cutoff = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
    let archived = 0;
    let errors = 0;

    for await (const jobs of this.listJobs()) {
      const oldJobs = jobs.filter((job) => {
        if (!job.finished && job.state !== "completed" && job.state !== "failed")
          return false;
        const createdMs =
          typeof job.created_at === "number" && job.created_at < 1e12
            ? job.created_at * 1000
            : job.created_at;
        return createdMs < cutoff;
      });

      // Process in batches of 10
      for (let i = 0; i < oldJobs.length; i += 10) {
        const batch = oldJobs.slice(i, i + 10);
        for (const job of batch) {
          try {
            await this.archiveJob(job.id);
            archived++;
          } catch {
            errors++;
          }
          await this.sleep(this.requestDelay);
        }
        if (i + 10 < oldJobs.length) {
          await this.sleep(this.archiveBatchDelay);
        }
      }
    }

    return { archived, errors };
  }

  // -- Cost calculation --

  async calculateCost(
    platform: Platform,
    payload: BotsterJobPayload,
  ): Promise<Record<string, unknown>> {
    const endpoint = PLATFORM_ENDPOINTS[platform];
    if (!endpoint) throw new Error(`No Botster endpoint for ${platform}`);
    return this.request<Record<string, unknown>>(
      "POST",
      `${endpoint}/calculate`,
      payload,
    );
  }

  // -- Credits --

  async getCredits(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `${API_BASE_URL}/credits`,
    );
  }
}

// -- Payload builders per platform --

export function buildGoogleMapsPayload(
  placeId: string,
  depth: number,
): BotsterJobPayload {
  return {
    input: [`place_id:${placeId}`],
    coordinates: { latitude: 1, longitude: 1, zoom: "15" },
    depth,
    sort: "newest",
    new_items_only: true,
  };
}

export function buildTripAdvisorPayload(
  locationUrl: string,
  depth: number,
): BotsterJobPayload {
  return {
    input: [locationUrl],
    tripadvisor_language: "it",
    depth,
    new_items_only: true,
  };
}

export function buildBookingPayload(
  locationUrl: string,
): BotsterJobPayload {
  return {
    input: [locationUrl],
    new_items_only: true,
  };
}
