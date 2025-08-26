import { DriverException, UniqueConstraintViolationException, ValidationError } from "@mikro-orm/core";

export function isORMError(e: unknown) {
    return e instanceof ValidationError || e instanceof DriverException || e instanceof UniqueConstraintViolationException;
}

export class NotEnoughUTXOsError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class LessThanDustAmountError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class NegativeFeeError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class MissingFieldError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class RBFRestrictionsNotMetError extends Error {
    constructor(message: string) {
        super(message);
    }
}
