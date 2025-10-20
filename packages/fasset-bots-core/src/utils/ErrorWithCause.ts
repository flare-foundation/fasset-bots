export class ErrorWithCause extends Error {
    #errorCause: unknown;

    constructor(
        message: string,
        errorCause: unknown
    ) {
        super(message);
        this.name = this.constructor.name;
        this.#errorCause = errorCause;
    }

    get errorCause() {
        return this.#errorCause;
    }

    static wrap(error: unknown) {
        return new ErrorWithCause(String(error), error);
    }

    fullStack() {
        function formatStack(error: any) {
            const stack = error.stack;
            /* istanbul ignore next */
            return stack ? stack.replace(/^Error:/, `${error.constructor?.name ?? "Error"}:`) : String(error);
        }
        const parts: string[] = [formatStack(this)];
        let error: any = this.errorCause;
        for (let i = 0; i < 10 && error != null; i++) {
            parts.push("  caused by: " + formatStack(error));
            error = error.errorCause;
        }
        return parts.join("\n");
    }
}
