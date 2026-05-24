import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { UnifiedMarket, BookmakerSlug } from '@arbix/shared';
import { logger } from '../logger';
import { config } from '../config';

export interface AdapterStatus {
  slug: BookmakerSlug;
  status: 'ok' | 'error' | 'rate_limited';
  lastFetch: Date;
  marketsCount: number;
  error?: string;
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15000;

export abstract class BaseAdapter {
  abstract readonly slug: BookmakerSlug;
  abstract readonly displayName: string;

  protected axiosInstance: AxiosInstance;
  private proxyList: string[];
  private proxyIndex = 0;
  private requestCount = 0;
  private windowStart = Date.now();
  protected readonly rateLimitPerMinute: number = 60;

  constructor() {
    this.proxyList = config.proxies;
    this.axiosInstance = axios.create({
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
  }

  abstract fetchMarkets(): Promise<UnifiedMarket[]>;

  protected getNextProxy(): string | undefined {
    if (this.proxyList.length === 0) return undefined;
    const proxy = this.proxyList[this.proxyIndex];
    this.proxyIndex = (this.proxyIndex + 1) % this.proxyList.length;
    return proxy;
  }

  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowMs = 60_000;

    if (now - this.windowStart > windowMs) {
      this.windowStart = now;
      this.requestCount = 0;
    }

    if (this.requestCount >= this.rateLimitPerMinute) {
      const waitMs = windowMs - (now - this.windowStart) + 100;
      logger.warn(`[${this.slug}] Rate limit reached, waiting ${waitMs}ms`);
      await sleep(waitMs);
      this.windowStart = Date.now();
      this.requestCount = 0;
    }

    this.requestCount++;
  }

  protected async fetchWithRetry<T>(
    url: string,
    axiosConfig: AxiosRequestConfig = {},
    attempts: number = DEFAULT_RETRY_ATTEMPTS
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.checkRateLimit();
        const response: AxiosResponse<T> = await this.axiosInstance.get<T>(url, axiosConfig);
        return response.data;
      } catch (err) {
        lastError = err as Error;
        const status = (err as { response?: { status?: number } }).response?.status;

        if (status === 429) {
          const backoff = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt) * 3;
          logger.warn(`[${this.slug}] Rate limited (429), backing off ${backoff}ms`);
          await sleep(backoff);
          continue;
        }

        if (status && status >= 400 && status < 500 && status !== 429) {
          // 4xx errors (except 429) are not retryable
          throw err;
        }

        const backoff = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn(
          `[${this.slug}] Request failed (attempt ${attempt + 1}/${attempts}), retrying in ${backoff}ms`,
          { url, error: (err as Error).message }
        );
        await sleep(backoff);
      }
    }

    throw lastError ?? new Error(`All ${attempts} attempts failed for ${url}`);
  }

  protected async fetchWithProxy<T>(
    url: string,
    axiosConfig: AxiosRequestConfig = {}
  ): Promise<T> {
    const proxy = this.getNextProxy();
    let proxyConfig: AxiosRequestConfig = {};

    if (proxy) {
      try {
        const proxyUrl = new URL(proxy);
        proxyConfig = {
          proxy: {
            host: proxyUrl.hostname,
            port: parseInt(proxyUrl.port, 10),
            auth:
              proxyUrl.username && proxyUrl.password
                ? { username: proxyUrl.username, password: proxyUrl.password }
                : undefined,
            protocol: proxyUrl.protocol.replace(':', '') as 'http' | 'https',
          },
        };
      } catch {
        logger.warn(`[${this.slug}] Invalid proxy URL: ${proxy}`);
      }
    }

    return this.fetchWithRetry<T>(url, { ...axiosConfig, ...proxyConfig });
  }

  protected parseAmericanOdds(american: number): { decimal: number; implied: number } {
    let decimal: number;
    if (american > 0) {
      decimal = american / 100 + 1;
    } else {
      decimal = 100 / Math.abs(american) + 1;
    }
    const implied = 1 / decimal;
    return { decimal: Math.round(decimal * 10000) / 10000, implied: Math.round(implied * 10000) / 10000 };
  }

  protected decimalToAmerican(decimal: number): number {
    if (decimal >= 2) {
      return Math.round((decimal - 1) * 100);
    } else {
      return Math.round(-100 / (decimal - 1));
    }
  }

  protected probabilityToDecimal(probability: number): number {
    if (probability <= 0 || probability >= 1) return 1;
    return Math.round((1 / probability) * 10000) / 10000;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
