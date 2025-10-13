import { Method } from "axios";
import { ErrorWithCause } from "./ErrorWithCause";
import { abortableSleep } from "./helpers";
import { ApiNetworkError, ApiServiceError, DEFAULT_TIMEOUT, HttpApiClient } from "./HttpApiClient";
import { logger } from "./logger";

const PARALLEL = false;
const DEFAULT_TRY_NEXT_AFTER = 5_000;
const DEFAULT_KILL_AFTER = 20_000;

export class MultiApiClientError extends Error {
    #requestId: number;
    #errors: Error[];

    constructor(message: string, requestId: number, errors: Error[]) {
        super(message);
        this.#errors = errors;
        this.#requestId = requestId;
    }

    get errors() { return this.#errors; }
    get requestId() { return this.#requestId; }

    lastServiceError(): ApiServiceError | undefined {
        for (let i = this.#errors.length - 1; i >= 0; i--) {
            const error = this.#errors[i];
            if (error instanceof ApiServiceError) {
                return error;
            }
        }
    }
}

export abstract class MultiApiClient {
    clients: HttpApiClient[] = [];

    constructor(
        public serviceName: string,
        public tryNextAfter: number,    // start request with next client in parallel after this time
        public timeout: number,         // axios http request timeout
        public killAfter: number,       // stop waiting after this many seconds, even if there is no timeout from axios
    ) {
    }

    static create(
        serviceName: string,
        parallel: boolean = PARALLEL,
        tryNextAfter: number = DEFAULT_TRY_NEXT_AFTER,   // start request with next client in parallel after this time
        timeout: number = DEFAULT_TIMEOUT,               // axios http request timeout
        killAfter: number = DEFAULT_KILL_AFTER,          // stop waiting after this many seconds, even if there is no timeout from axios
    ) {
        if (parallel) {
            return new MultiApiClientParallel(serviceName, tryNextAfter, timeout, killAfter);
        } else {
            return new MultiApiClientSerial(serviceName, 0, timeout, killAfter);
        }
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

    abstract request<R>(httpMethod: Method, url: string, data: any, methodName: string): Promise<R>;
}

class MultiApiClientSerial extends MultiApiClient {
    override async request<R>(httpMethod: Method, url: string, data: any, methodName: string): Promise<R> {
        const requestId = HttpApiClient.newRequestId();
        const clients = Array.from(this.clients);
        if (clients.length === 0) {
            throw new MultiApiClientError(`No clients for ${this.serviceName}`, requestId, []);
        }
        const errors: Error[] = [];
        for (const [i, client] of clients.entries()) {
            try {
                const abortSignal = AbortSignal.timeout(this.killAfter);
                return await client.request<R>(httpMethod, url, data, methodName, requestId, i, abortSignal);
            } catch (error) {
                errors.push(error instanceof Error ? error : ErrorWithCause.wrap(error));
            }
        }
        logger.error(`MULTICLIENT ERROR request[${requestId}] ${this.serviceName}.${methodName}: failed on all ${clients.length} clients`);
        throw new MultiApiClientError(`${this.serviceName}.${methodName}: failed on all ${clients.length} clients`, requestId, errors);
    }
}

class MultiApiClientParallel extends MultiApiClient {
    override async request<R>(httpMethod: Method, url: string, data: any, methodName: string): Promise<R> {
        const requestId = HttpApiClient.newRequestId();
        const clients = Array.from(this.clients);
        if (clients.length === 0) {
            throw new MultiApiClientError(`No clients for ${this.serviceName}`, requestId, []);
        }
        const abortController = new AbortController();
        const abortSignal = abortController.signal;
        const results = await Promise.allSettled(clients.map(async (client, index) => {
            try {
                await abortableSleep(index * this.tryNextAfter, abortSignal);
                return await Promise.race([
                    client.request<R>(httpMethod, url, data, methodName, requestId, index, abortSignal),
                    abortableSleep(this.killAfter, abortSignal)
                        .then(() => { throw new ApiNetworkError(`Timeout of ${this.killAfter}ms reached`, null); }),
                ]);
            } finally {
                if (!abortSignal.aborted) {
                    abortController.abort(new Error("Request aborted because it finished first on another client"));
                }
            }
        }));
        const successfulResult = results.find(res => res.status === "fulfilled");
        if (successfulResult) {
            return successfulResult.value;
        }
        const errors = results.map(r => (r as PromiseRejectedResult).reason);
        logger.error(`MULTICLIENT ERROR request[${requestId}] ${this.serviceName}.${methodName}: failed on all ${clients.length} clients`);
        throw new MultiApiClientError(`${this.serviceName}.${methodName}: failed on all ${clients.length} clients`, requestId, errors);
    }
}
