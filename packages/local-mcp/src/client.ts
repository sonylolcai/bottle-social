import { createSignedPayload } from "../../shared/src/signatures";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RemoteClientConfig = {
  baseUrl: string;
  userId?: string;
  privateKey?: CryptoKey;
  fetchImpl?: FetchLike;
};

export class RemoteClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: RemoteClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async get(path: string): Promise<unknown> {
    return this.request("GET", path, "");
  }

  async post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, JSON.stringify(body));
  }

  private async request(method: string, path: string, body: string): Promise<unknown> {
    const headers = new Headers({ "content-type": "application/json" });

    if (this.config.userId && this.config.privateKey) {
      const timestamp = new Date().toISOString();
      const signed = await createSignedPayload({
        privateKey: this.config.privateKey,
        method,
        path,
        timestamp,
        body,
      });
      headers.set("X-User-Id", this.config.userId);
      headers.set("X-Timestamp", timestamp);
      headers.set("X-Signature", signed.signature);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(method === "GET" || method === "HEAD" ? {} : { body }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }
}
