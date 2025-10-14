import { assert, expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Server } from "node:http";
import { MultiApiClient, MultiApiClientError } from "../../../src/utils/MultiApiClient";
import { startHttpListening, stopHttpListening } from "../../test-utils/test-api-server";
use(chaiAsPromised);

describe("Test http server timeouts and errors", () => {
    const testHost = "127.0.0.1";
    const testPorts = [8080, 8081];
    const serverName = "TestService";
    const testUrls = testPorts.map(port => `http://${testHost}:${port}`);
    const servers: Server[] = [];

    before(async () => {
        for (const [index, port] of testPorts.entries()) {
            servers.push(await startHttpListening(testHost, port, { index }));
        }
    });

    after(async () => {
        for (const server of servers) {
            await stopHttpListening(server);
        }
    });

    function createClient(parallel: boolean, tryNextAfter: number, timeout: number, killAfter: number) {
        const client = MultiApiClient.create(serverName, parallel, tryNextAfter, timeout, killAfter);
        for (const [index, url] of testUrls.entries()) {
            client.addClient(url, undefined, index);
        }
        return client;
    }

    type MultiwaitResult = {
        elapsed: number;
        index: number;
    };

    type MultierrorResult = {
        status: string;
        index: number;
    };

    it("test http multi client (serial) successful wait (first succeeds)", async () => {
        const server = createClient(false, 1000, 2000, 3000);
        const a = await server.post<MultiwaitResult>("/multiwait", [0.5, 1.5], "multiwait");
        assert.typeOf(a.elapsed, "number");
        assert.equal(a.index, 0);
    });

    it("test http multi client (serial) successful wait (first timeouts)", async () => {
        const server = createClient(false, 1000, 2000, 3000);
        const a = await server.post<MultiwaitResult>("/multiwait", [3, 1.5], "multiwait");
        assert.typeOf(a.elapsed, "number");
        assert.equal(a.index, 1);
    });

    it("test http multi client (serial) successful multierror (first succeeds)", async () => {
        const server = createClient(false, 1000, 2000, 3000);
        const a = await server.post<MultierrorResult>("/multierror", [1], "multierror");
        assert.equal(a.status, "OK");
        assert.equal(a.index, 0);
    });

    it("test http multi client (serial) successful multierror (first errors)", async () => {
        const server = createClient(false, 1000, 2000, 3000);
        const a = await server.post<MultierrorResult>("/multierror", [0], "multierror");
        assert.equal(a.status, "OK");
        assert.equal(a.index, 1);
    });

    it("test http multi client (serial) multierror error (both fail)", async () => {
        const server = createClient(false, 1000, 2000, 3000);
        await expect(server.post<MultierrorResult>("/multierror", [0, 1], "multierror"))
            .eventually.rejectedWith(MultiApiClientError, /failed on all 2 clients/);
    });

    it("test http multi client (parallel) successful wait, success on first, second not started", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        const a = await server.post<MultiwaitResult>("/multiwait", [0.5, 1.5], "multiwait");
        assert.typeOf(a.elapsed, "number");
        assert.equal(a.index, 0);
    });

    it("test http multi client (parallel) successful wait, success on first, second canceled", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        const a = await server.post<MultiwaitResult>("/multiwait", [1.5, 1.5], "multiwait");
        assert.typeOf(a.elapsed, "number");
        assert.equal(a.index, 0);
    });

    it("test http multi client (parallel) successful wait - success on second, timout on first before", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        const a = await server.post<MultiwaitResult>("/multiwait", [2.2, 1.5], "multiwait");
        assert.typeOf(a.elapsed, "number");
        assert.equal(a.index, 1);
    });

    it("test http multi client (parallel) successful wait - success on second, first canceled before timeout", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        const a = await server.post<MultiwaitResult>("/multiwait", [3, 0.5], "multiwait");
        assert.typeOf(a.elapsed, "number");
        assert.equal(a.index, 1);
    });

    it("test http multi client (parallel) error - all services timeout", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        await expect(server.post<MultiwaitResult>("/multiwait", [3, 3], "multiwait"))
            .eventually.rejectedWith(MultiApiClientError, /failed on all 2 clients/);
    });

    it("test http multi client (parallel) successful multierror (first succeeds)", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        const a = await server.post<MultierrorResult>("/multierror", [1], "multierror");
        assert.equal(a.status, "OK");
        assert.equal(a.index, 0);
    });

    it("test http multi client (parallel) successful multierror (first errors)", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        const a = await server.post<MultierrorResult>("/multierror", [0], "multierror");
        assert.equal(a.status, "OK");
        assert.equal(a.index, 1);
    });

    it("test http multi client (parallel) multierror error (both fail)", async () => {
        const server = createClient(true, 1000, 2000, 3000);
        await expect(server.post<MultierrorResult>("/multierror", [0, 1], "multierror"))
            .eventually.rejectedWith(MultiApiClientError, /failed on all 2 clients/);
    });

});
