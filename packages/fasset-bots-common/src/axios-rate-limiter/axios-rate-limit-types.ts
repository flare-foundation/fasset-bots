// Adopted from: https://github.com/aishek/axios-rate-limit

import { AxiosInstance } from "axios";

export interface RateLimitOptions {
    maxRequests?: number;
    perMilliseconds?: number;
    maxRPS?: number;
    timeoutMs?: number;
    retries?: number;
}

export interface RateLimitedAxiosInstance extends AxiosInstance {
    getMaxRPS(): number;
    setMaxRPS(rps: number): void;
    setRateLimitOptions(options: RateLimitOptions): void;
}
