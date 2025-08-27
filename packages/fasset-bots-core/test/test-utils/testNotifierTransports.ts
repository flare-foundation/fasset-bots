import { ConsoleNotifierTransport, LoggerNotifierTransport } from "@flarenetwork/fasset-bots-common";

export const testNotifierTransports = [
    new ConsoleNotifierTransport(),
    new LoggerNotifierTransport(),
];
