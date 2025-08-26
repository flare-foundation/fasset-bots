import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { RateLimitedAxiosInstance, RateLimitOptions } from "../axios-rate-limiter/axios-rate-limit-types";
import { logger } from "../logging/logger";
import { fullStackTrace, updateErrorWithFullStackTrace } from "./error-utils";

export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimitOptions = {
    maxRPS: 100,
    maxRequests: 1000,
    timeoutMs: 20000,
    retries: 10,
};

export async function tryWithClients<T>(clients: AxiosInstance[], operation: (client: AxiosInstance) => Promise<T>, method: string, logWithStackTrace: boolean = true) {
    for (const [index] of clients.entries()) {
        try {
            const result = await operation(clients[index]);
            return result;
        } catch (error) {
            const failedUrl = clients[index].defaults.baseURL ?? 'Unknown URL';
            if (logWithStackTrace) {
                logger.warn(`Client with index ${index}, url ${failedUrl} and method ${method} failed with: ${errorMessageWithStackTrace(error)}`);
            }
            const lastClient = clients.length - 1;
            if (index === lastClient) {
                throw updateErrorWithFullStackTrace(error);
            }
        }
    }
    throw new Error(`All clients failed.`);
}

export function errorMessageWithStackTrace(e: unknown) {
    const stackTrace = e instanceof Error ? fullStackTrace(e, 1) : new Error(String(e)).stack;
    return `${errorMessage(e)}\nStack Trace: ${stackTrace}`;
}

export function errorMessage(e: unknown) {
    if (e instanceof AxiosError) {
        const { code, config, response } = e;
        const statusCode = response?.status ?? 'No Status';
        const statusText = response?.statusText ?? 'No Status Text';
        const url = config?.url ?? 'No URL';
        let responseData = 'No Response Data';
        if (response?.data) {
            if (typeof response.data === 'string') {
                responseData = response.data;
            } else if (typeof response.data === 'object') {
                responseData = JSON.stringify(response.data, null, 2);
            }
        }
        return `AxiosError - Code: ${code}, URL: ${url}, Status: ${statusCode} ${statusText} - ${e.message}\nResponse Data: ${responseData}`;
    } else if (e instanceof Error) {
        return `${e.name} - ${e.message}`;
    } else {
        return `Unkown error - ${String(e)}`;
    }
}

export function createAxiosConfig(url: string, apiKey?: string, timeoutMs?: number) {
    const createAxiosConfig: AxiosRequestConfig = {
        baseURL: url,
        timeout: timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs,
        headers: {
            "Content-Type": "application/json",
        },
        validateStatus: function (status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
        },
    };
    if (apiKey) {
        createAxiosConfig.headers ??= {};
        createAxiosConfig.headers["X-API-KEY"] = apiKey;
        createAxiosConfig.headers["x-apikey"] = apiKey;
    }
    return createAxiosConfig;
}

export function createAxiosInstance(url: string, apiKey?: string, rateLimitOptions?: RateLimitOptions): RateLimitedAxiosInstance {
    return axiosRateLimit(axios.create(createAxiosConfig(url, apiKey, rateLimitOptions?.timeoutMs)), {
        ...DEFAULT_RATE_LIMIT_OPTIONS,
        ...rateLimitOptions,
    });
}
