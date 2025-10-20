import express from "express";
import type { Server } from "node:http";
import { elapsedSec, sleep } from "../../src/utils/helpers";

type AppData = { index: number };

function createApp(data?: AppData) {
    const app = express();
    app.use(express.json());

    app.get("/wait/:seconds", (req, res) => runAsyncBody(res, async () => {
        const start = Date.now();
        const delayMs = Number(req.params.seconds) * 1000;
        await sleep(delayMs);
        return { elapsed: elapsedSec(start) };
    }));

    app.post("/error", (req, res) => runAsyncBody(res, async () => {
        const body = req.body;
        throw new Error(`text=${body?.text}`);
    }));

    app.post("/multiwait", (req, res) => runAsyncBody(res, async () => {
        const start = Date.now();
        const delaysMs = (req.body as number[]).map(s => s * 1000);
        await sleep(delaysMs[data?.index ?? 0]);
        return { elapsed: elapsedSec(start), index: data?.index };
    }));

    app.post("/multierror", (req, res) => runAsyncBody(res, async () => {
        const doError = (req.body as number[]).includes(data?.index ?? -1);
        if (doError) {
            throw new Error(`index=${data?.index}`);
        } else {
            return { status: "OK", index: data?.index };
        }
    }));

    return app;
}

function runAsyncBody(res: express.Response, handler: () => Promise<unknown>) {
    handler()
        .then(v => {
            res.json(v);
        })
        .catch(e => {
            res.status(400);
            res.json({ error: String(e) });
        })
}

export function startHttpListening(host: string, port: number, data?: AppData) {
    return new Promise<Server>((resolve) => {
        const app = createApp(data);
        const server = app.listen(port, host, () => {
            console.log(`Http server listening on http://${host}:${port}`);
            resolve(server);
        });
    });
}

export function stopHttpListening(server: Server | undefined) {
    return new Promise<void>((resolve) => {
        if (server) {
            server.close(() => {
                console.log("Http server stopped");
                resolve();
            });
        } else {
            resolve();
        }
    });
}

if (typeof require !== "undefined" && require.main === module) {
    void startHttpListening("127.0.0.1", 8080);
}
