import { createAxiosConfig } from "@flarenetwork/fasset-bots-common";
import axios, { AxiosError, AxiosInstance, AxiosResponse, GenericAbortSignal, isAxiosError, Method } from "axios";
import { ErrorWithCause } from "./ErrorWithCause";
import { clipText, systemTimestamp } from "./helpers";
import { logger } from "./logger";

const DEFAULT_TRY_NEXT_AFTER = 5_000;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_KILL_AFTER = 20_000;

let requestCounter = 0;

export class ApiNetworkError extends ErrorWithCause {}

export class ApiServiceError extends ErrorWithCause {
    #response: AxiosResponse<unknown>;

    constructor(message: string, response: AxiosResponse<unknown>, cause: AxiosError) {
        super(message, cause);
        this.#response = response;
    }

    get response() { return this.#response; }
}

export class MultiApiClientError extends Error {
    #errors: Error[];

    constructor(message: string, errors: Error[]) {
        super(message);
        this.#errors = errors;
    }

    get errors() { return this.#errors; }
}

export class MultiApiClient {
    clients: HttpApiClient[] = [];

    constructor(
        public serviceName: string,
        public tryNextAfter: number = DEFAULT_TRY_NEXT_AFTER,   // start request with next client in parallel after this time
        public timeout: number = DEFAULT_TIMEOUT,               // axios http request timeout
        public killAfter: number = DEFAULT_KILL_AFTER,          // stop waiting after this many seconds, even if there is no timeout from axios
    ) {
    }

    addClient(baseUrl: string, apiKey?: string) {
        const client = HttpApiClient.create(this.serviceName, baseUrl, apiKey, this.timeout);
        this.clients.push(client);
    }

    async get<R>(url: string, methodName: string): Promise<R> {
        return await this.request("GET", url, undefined, methodName);
    }

    async post<R>(url: string, data: any, methodName: string): Promise<R> {
        return await this.request("POST", url, data, methodName);
    }

    async request<R>(httpMethod: Method, url: string, data: any, methodName: string): Promise<R> {
        const requestId = HttpApiClient.newRequestId();
        const clients = Array.from(this.clients);
        if (clients.length === 0) {
            throw new MultiApiClientError(`No clients for ${this.serviceName}`, []);
        }
        const errors: Error[] = [];
        for (let i = 0; i < clients.length; i++) {
            try {
                const abortSignal = AbortSignal.timeout(this.killAfter);
                return await this.clients[i].request<R>(httpMethod, url, data, methodName, requestId, i, abortSignal);
            } catch (error) {
                errors.push(error instanceof Error ? error : ErrorWithCause.wrap(error));
            }
        }
        logger.error(`MULTICLIENT ERROR request[${requestId}] ${this.serviceName}.${methodName}: failed on all ${clients.length} clients`);
        throw new MultiApiClientError(`${this.serviceName}.${methodName}: failed on all ${clients.length} clients`, errors);
    }
}

export class HttpApiClient {
    constructor(
        public serviceName: string,
        public client: AxiosInstance,
        public timeout: number = DEFAULT_TIMEOUT,
    ) {
    }

    static create(serviceName: string, baseUrl: string, apiKey?: string, timeout: number = DEFAULT_TIMEOUT) {
        const client = axios.create(createAxiosConfig(baseUrl, apiKey, timeout));
        return new HttpApiClient(serviceName, client, timeout);
    }

    async get<R>(url: string, methodName: string, requestId: number, clientIndex: number, abortSignal?: GenericAbortSignal): Promise<R> {
        return await this.request("GET", url, undefined, methodName, requestId, clientIndex, abortSignal);
    }

    async post<R>(url: string, data: any, methodName: string, requestId: number, clientIndex: number, abortSignal?: GenericAbortSignal): Promise<R> {
        return await this.request("POST", url, data, methodName, requestId, clientIndex, abortSignal);
    }

    async request<R>(httpMethod: Method, url: string, data: any, methodName: string, requestId: number, clientIndex: number, abortSignal?: GenericAbortSignal): Promise<R> {
        const requestInfo = `request[${requestId}] client[${clientIndex}] ${this.serviceName}.${methodName}`;
        logger.info(`START ${requestInfo}: ${httpMethod.toUpperCase()} ${this.client.getUri()}${url}`);
        const startTime = systemTimestamp();
        try {
            const response = await this.client.request<R>({
                method: httpMethod,
                url: url,
                data: data,
                timeout: this.timeout,
                signal: abortSignal ?? AbortSignal.timeout(this.timeout)
            });
            logger.info(`SUCCESS ${requestInfo} (${systemTimestamp() - startTime}s): [${response.status} ${response.statusText}]`);
            return response.data;
        } catch (error) {
            if (isAxiosError(error) && error.response) {
                if (error.response) {
                    const response = error.response;
                    const message = clipText(typeof response.data === "string" ? response.data : tryJsonStringify(response.data), 120);
                    logger.error(`SERVICE ERROR ${requestInfo} (${systemTimestamp() - startTime}s): [${response.status} ${response.statusText}] ${message}`);
                    throw new ApiServiceError(`${this.serviceName}.${methodName}: ${message}`, response, error);
                }
                const message = clipText(error.message, 120);
                logger.error(`NETWORK ERROR ${requestInfo} (${systemTimestamp() - startTime}s): ${message}`);
                throw new ApiNetworkError(`${this.serviceName}.${methodName}: ${message}`, error);
            }
            const message = clipText(String(error), 120);
            logger.info(`UNEXPECTED ERROR ${requestInfo} (${systemTimestamp() - startTime}s): ${message}`);
            throw new ApiNetworkError(`${this.serviceName}.${methodName}: UNEXPECTED ${message}`, error);
        }
    }

    static newRequestId() {
        return ++requestCounter;
    }
}

function tryJsonStringify(data: unknown, indent?: number) {
    try {
        return JSON.stringify(data, null, indent);
    } catch (_error) {
        return "<cannot json stringify data>";
    }
}
