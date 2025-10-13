import { createAxiosConfig } from "@flarenetwork/fasset-bots-common";
import axios, { AxiosError, AxiosInstance, AxiosResponse, Method, isAxiosError } from "axios";
import { ErrorWithCause } from "./ErrorWithCause";
import { clipText, elapsedSec } from "./helpers";
import { logger } from "./logger";

export const DEFAULT_TIMEOUT = 15_000;

export class ApiNetworkError extends ErrorWithCause {}

export class ApiServiceError extends ErrorWithCause {
    #response: AxiosResponse<unknown>;

    constructor(message: string, response: AxiosResponse<unknown>, cause: AxiosError) {
        super(message, cause);
        this.#response = response;
    }

    get response() { return this.#response; }
}

export class HttpApiClient {
    constructor(
        public serviceName: string,
        public client: AxiosInstance,
        public timeout: number = DEFAULT_TIMEOUT
    ) {
    }

    static create(serviceName: string, baseUrl: string, apiKey?: string, timeout: number = DEFAULT_TIMEOUT) {
        const client = axios.create(createAxiosConfig(baseUrl, apiKey, timeout));
        return new HttpApiClient(serviceName, client, timeout);
    }

    async get<R>(url: string, methodName: string, requestId: number, clientIndex: number, abortSignal?: AbortSignal): Promise<R> {
        return await this.request("GET", url, undefined, methodName, requestId, clientIndex, abortSignal);
    }

    async post<R>(url: string, data: any, methodName: string, requestId: number, clientIndex: number, abortSignal?: AbortSignal): Promise<R> {
        return await this.request("POST", url, data, methodName, requestId, clientIndex, abortSignal);
    }

    async request<R>(httpMethod: Method, url: string, data: any, methodName: string, requestId: number, clientIndex: number, abortSignal?: AbortSignal): Promise<R> {
        const requestInfo = `request[${requestId}] client[${clientIndex}] ${this.serviceName}.${methodName}`;
        logger.info(`START ${requestInfo}: ${httpMethod.toUpperCase()} ${this.client.getUri()}${url}`);
        const startTimestamp = Date.now();
        try {
            abortSignal?.throwIfAborted();  // don't start request if timeout already reached
            const response = await this.client.request<R>({
                method: httpMethod,
                url: url,
                data: data,
                timeout: this.timeout,
                signal: abortSignal ?? AbortSignal.timeout(this.timeout)
            });
            logger.info(`SUCCESS ${requestInfo} (${elapsedSec(startTimestamp)}s): [${response.status} ${response.statusText}]`);
            return response.data;
        } catch (error) {
            if (isAxiosError(error) && error.response) {
                const message = clipText(error.message, 120);
                if (error.response) {
                    const response = error.response;
                    const responseText = clipText(typeof response.data === "string" ? response.data : tryJsonStringify(response.data), 160);
                    logger.error(`SERVICE ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): [${response.status} ${response.statusText}] ${message}\n    ${responseText}`);
                    throw new ApiServiceError(`${this.serviceName}.${methodName}: ${message}`, response, error);
                }
                logger.error(`NETWORK ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
                throw new ApiNetworkError(`${this.serviceName}.${methodName}: ${message}`, error);
            }
            const message = clipText(String(error), 120);
            logger.info(`UNEXPECTED ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
            throw new ApiNetworkError(`${this.serviceName}.${methodName}: UNEXPECTED ${message}`, error);
        }
    }

    static newRequestId() {
        return ++requestCounter;
    }
}

let requestCounter = 0;

export function tryJsonStringify(data: unknown, indent?: number) {
    try {
        return JSON.stringify(data, null, indent);
    } catch (_error) {
        return "<cannot json stringify data>";
    }
}
