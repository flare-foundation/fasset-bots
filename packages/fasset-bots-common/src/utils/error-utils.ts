export function updateErrorWithFullStackTrace(error: unknown, skipDepth: number = 0): Error {
    if (error instanceof Error) {
        error.stack = fullStackTrace(error, skipDepth + 1);
        return error;
    }
    return new Error(`Unknown error: ${error}`);
}

export function fullStackTrace(error: Error, skipDepth: number = 0): string {
    const originalStack = error.stack ?? "Missing original error stack";
    const stackError = new Error("just for stack");
    // always skip 1 line for message, 1 for this method
    const extraStackLines = (stackError.stack ?? "").split("\n").slice(skipDepth + 2);
    const filteredStackLines = extraStackLines.filter(l => !originalStack.includes(l));
    return originalStack.trimEnd() + "\n" + filteredStackLines.join("\n");
}
