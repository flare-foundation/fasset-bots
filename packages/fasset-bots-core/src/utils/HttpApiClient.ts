import { createAxiosConfig } from "@flarenetwork/fasset-bots-common";
import axios, { AxiosError, AxiosInstance, AxiosResponse, Method, isAxiosError } from "axios";
import { ErrorWithCause } from "./ErrorWithCause";
import { clipText, elapsedSec } from "./helpers";
import { logger } from "./logger";

export const DEFAULT_TIMEOUT = 15_000;

export class ApiBaseError extends ErrorWithCause {}

export class ApiServiceError extends ApiBaseError {
    #response: AxiosResponse<unknown>;

    constructor(message: string, response: AxiosResponse<unknown>, cause: AxiosError) {
        super(message, cause);
        this.#response = response;
    }

    get response() { return this.#response; }
}

export class ApiNetworkError extends ApiBaseError {}
export class ApiTimeoutError extends ApiBaseError {}
export class ApiCanceledError extends ApiBaseError {}
export class ApiUnexpectedError extends ApiBaseError {}

export class HttpApiClient {
    constructor(
        public serviceName: string,
        public serverIndex: number,
        public client: AxiosInstance,
        public timeout: number = DEFAULT_TIMEOUT
    ) {
    }

    static create(serviceName: string, serverIndex: number, baseUrl: string, apiKey?: string, timeout: number = DEFAULT_TIMEOUT) {
        const client = axios.create(createAxiosConfig(baseUrl, apiKey, timeout));
        return new HttpApiClient(serviceName, serverIndex, client, timeout);
    }

    async get<R>(url: string, methodName: string, requestId: number, abortSignal?: AbortSignal): Promise<R> {
        return await this.request("GET", url, undefined, methodName, requestId, abortSignal);
    }

    async post<R, D = unknown>(url: string, data: D, methodName: string, requestId: number, abortSignal?: AbortSignal): Promise<R> {
        return await this.request("POST", url, data, methodName, requestId, abortSignal);
    }

    async request<R, D = unknown>(httpMethod: Method, url: string, data: D, methodName: string, requestId: number, abortSignal?: AbortSignal): Promise<R> {
        const requestInfo = `request[${requestId}] client[${this.serverIndex}] ${this.serviceName}.${methodName}`;
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
            if (isAxiosError(error)) {
                const message = clipText(error.message, 120);
                if (error.response) {
                    const response = error.response;
                    const responseText = clipText(typeof response.data === "string" ? response.data : tryJsonStringify(response.data), 160);
                    logger.error(`SERVICE ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): [${response.status} ${response.statusText}] ${message}\n    ${responseText}`);
                    throw new ApiServiceError(`${this.serviceName}.${methodName}: ${message}`, response, error);
                } else if (error.name === "CanceledError") {
                    if (Date.now() - startTimestamp < this.timeout) {
                        logger.info(`CANCELED ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
                        throw new ApiCanceledError(`${this.serviceName}.${methodName}: ${message}`, error);
                    } else {
                        logger.error(`TIMEOUT ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
                        throw new ApiTimeoutError(`${this.serviceName}.${methodName}: ${message}`, error);
                    }
                } else if (error.name === "AxiosError") {
                    if (error.message?.match(/^timeout of \w* exceeded$/)) {
                        logger.error(`TIMEOUT ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
                        throw new ApiTimeoutError(`${this.serviceName}.${methodName}: ${message}`, error);
                    } else {
                        logger.error(`NETWORK ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
                        throw new ApiNetworkError(`${this.serviceName}.${methodName}: ${message}`, error);
                    }
                }
                // other error types treated as unexpected, even if they are axios errors
            }
            const message = clipText(String(error), 120);
            logger.error(`UNEXPECTED ERROR ${requestInfo} (${elapsedSec(startTimestamp)}s): ${message}`);
            throw new ApiUnexpectedError(`${this.serviceName}.${methodName}: ${message}`, error);
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
