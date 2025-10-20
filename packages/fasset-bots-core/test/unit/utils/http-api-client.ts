import { assert, expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Server } from "node:http";
import { ApiCanceledError, ApiNetworkError, ApiServiceError, ApiTimeoutError, ApiUnexpectedError, HttpApiClient } from "../../../src/utils/HttpApiClient";
import { startHttpListening, stopHttpListening } from "../../test-utils/test-api-server";
use(chaiAsPromised);

describe("Test http server timeouts and errors", () => {
    const testHost = "127.0.0.1";
    const testPort = 8080;
    const serverName = "TestService";
    const testUrl = `http://${testHost}:${testPort}`;
    let server: Server;

    before(async () => {
        server = await startHttpListening(testHost, testPort);
    });

    after(async () => {
        await stopHttpListening(server);
    });

    it("test http server successful wait", async () => {
        const server = HttpApiClient.create(serverName, 0, testUrl, undefined, 2000);
        const a = await server.get<{ elapsed: number }>("/wait/1", "wait", 1);
        assert.typeOf(a.elapsed, "number");
        assert.isAtLeast(a.elapsed, 1);
    });

    it("test http server default timeout/abort (don't know which)", async () => {
        const server = HttpApiClient.create(serverName, 0, testUrl, undefined, 1000);
        await expect(server.get<{ elapsed: number }>("/wait/3", "wait", 2))
            .eventually.rejectedWith(ApiTimeoutError, /canceled|timeout/);
    });

    it("test http server timeout", async () => {
        const server = HttpApiClient.create(serverName, 0, testUrl, undefined, 1000);
        const abortSignal = AbortSignal.timeout(5000);
        await expect(server.get<{ elapsed: number }>("/wait/3", "wait", 3, abortSignal))
            .eventually.rejectedWith(ApiTimeoutError, /TestService.wait: timeout of 1000ms exceeded/);
    });

    it("test http server default cancelation (abort before timeout expires)", async () => {
        const server = HttpApiClient.create(serverName, 0, testUrl, undefined, 5000);
        const abortSignal = AbortSignal.timeout(1000);
        await expect(server.get<{ elapsed: number }>("/wait/3", "wait", 4, abortSignal))
            .eventually.rejectedWith(ApiCanceledError, /TestService.wait: canceled/);
    });

    it("test http server service error", async () => {
        const server = HttpApiClient.create(serverName, 0, testUrl, undefined, 5000);
        await expect(server.post("/error", { text: "ABCD" }, "error", 5))
            .eventually.rejectedWith(ApiServiceError, /TestService.error: Request failed with status code 400/);
    });

    it("test http server 404 error", async () => {
        const server = HttpApiClient.create(serverName, 0, testUrl, undefined, 5000);
        await expect(server.get("/wrong_path", "wrong_path", 5))
            .eventually.rejectedWith(ApiServiceError, /TestService.wrong_path: Request failed with status code 404/);
    });

    it("test http invalid url (no 'http://' prefix) - should throw unexpected error", async () => {
        const server = HttpApiClient.create(serverName, 0, `127.0.0.1:${testPort}`, undefined, 2000);
        await expect(server.get<{ elapsed: number }>("/wait/1", "wait", 6))
            .eventually.rejectedWith(ApiUnexpectedError, /TestService.wait/);
    });
});
