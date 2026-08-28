import { metaErrorFrom, transportError, type MetaErrorBody } from './errors.js';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaClientOptions {
  pageId: string;
  pageToken: string;
  igBusinessId?: string;
  fetchImpl?: typeof fetch;
  /** Polling budget for an Instagram container to finish processing. */
  containerPollAttempts?: number;
  containerPollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PublishResult {
  externalId: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MetaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: MetaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async post<T>(path: string, params: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({ ...params, access_token: this.options.pageToken });

    let response: Response;
    try {
      response = await this.fetchImpl(`${GRAPH_BASE}${path}`, { method: 'POST', body });
    } catch (cause) {
      throw transportError(cause);
    }

    const payload = (await response.json().catch(() => ({}))) as T & MetaErrorBody;
    if (!response.ok || payload.error) throw metaErrorFrom(payload, response.status);
    return payload;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const search = new URLSearchParams({ ...params, access_token: this.options.pageToken });

    let response: Response;
    try {
      response = await this.fetchImpl(`${GRAPH_BASE}${path}?${search.toString()}`);
    } catch (cause) {
      throw transportError(cause);
    }

    const payload = (await response.json().catch(() => ({}))) as T & MetaErrorBody;
    if (!response.ok || payload.error) throw metaErrorFrom(payload, response.status);
    return payload;
  }

  /**
   * Publishes a Facebook Page photo post. `/photos` is used rather than
   * `/feed` so the creative is the post itself; the link lives in the caption,
   * which is where our copy already puts it for Facebook.
   */
  async publishToFacebook(input: { imageUrl: string; caption: string }): Promise<PublishResult> {
    const result = await this.post<{ id?: string; post_id?: string }>(`/${this.options.pageId}/photos`, {
      url: input.imageUrl,
      caption: input.caption,
      published: 'true',
    });

    const externalId = result.post_id ?? result.id;
    if (!externalId) throw new Error('Facebook publish returned no post id');
    return { externalId };
  }

  /**
   * Instagram publishing is two calls: create a media container, then publish
   * it. Meta *fetches `image_url` itself*, so it has to be publicly reachable —
   * local bytes cannot be uploaded here. That is why the redirector serves the
   * generated card at a public URL.
   *
   * The container is processed asynchronously, so it is polled until it
   * reports FINISHED; publishing an unfinished container fails.
   */
  async publishToInstagram(input: { imageUrl: string; caption: string }): Promise<PublishResult> {
    const igUserId = this.options.igBusinessId;
    if (!igUserId) throw new Error('IG_BUSINESS_ID is required to publish to Instagram');

    const container = await this.post<{ id?: string }>(`/${igUserId}/media`, {
      image_url: input.imageUrl,
      caption: input.caption,
    });
    if (!container.id) throw new Error('Instagram container creation returned no id');

    await this.waitForContainer(container.id);

    const published = await this.post<{ id?: string }>(`/${igUserId}/media_publish`, {
      creation_id: container.id,
    });
    if (!published.id) throw new Error('Instagram publish returned no media id');

    return { externalId: published.id };
  }

  /**
   * Removes a published post — used to unpublish an ad for an event that was
   * cancelled (piège #6). Meta returns 404/code 100 for a post already gone,
   * which is treated as success: the goal is "not published any more", and it
   * already is.
   */
  async deletePost(externalId: string): Promise<{ deleted: boolean }> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const url = `${GRAPH_BASE}/${externalId}?access_token=${encodeURIComponent(this.options.pageToken)}`;

    let response: Response;
    try {
      response = await doFetch(url, { method: 'DELETE' });
    } catch (cause) {
      throw transportError(cause);
    }

    const payload = (await response.json().catch(() => ({}))) as MetaErrorBody;

    if (response.status === 404 || payload.error?.code === 100) return { deleted: false };
    if (!response.ok || payload.error) throw metaErrorFrom(payload, response.status);

    return { deleted: true };
  }

  private async waitForContainer(containerId: string): Promise<void> {
    const attempts = this.options.containerPollAttempts ?? 10;
    const delay = this.options.containerPollDelayMs ?? 3000;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const status = await this.get<{ status_code?: string; status?: string }>(`/${containerId}`, {
        fields: 'status_code,status',
      });

      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
        throw new Error(`Instagram container ${containerId} failed: ${status.status ?? status.status_code}`);
      }

      await this.sleep(delay);
    }

    throw new Error(`Instagram container ${containerId} did not finish in time`);
  }
}
