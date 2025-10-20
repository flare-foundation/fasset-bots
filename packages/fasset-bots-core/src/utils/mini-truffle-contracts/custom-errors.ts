import coder from "web3-eth-abi";
import { AbiItem } from "web3-utils";
import { ErrorWithCause } from "../ErrorWithCause";

export interface RevertData {
    abi: AbiItem;
    name: string;
    args: { [key: string]: any; };
}

export class TransactionRevertedError extends ErrorWithCause {
    #revertData: RevertData;

    constructor(
        message: string,
        revertData: RevertData,
        errorCause: unknown,
    ) {
        super(message, errorCause);
        this.#revertData = revertData;
    }

    get revertData() {
        return this.#revertData;
    }

    formattedRevertData() {
        return formatRevertData(this.#revertData);
    }
}


export const STRING_REVERT_ERROR: AbiItem = { type: "error" as any, name: "Error", inputs: [{ "internalType": "string", "name": "message", "type": "string" }] };
export const PANIC_ERROR: AbiItem = { type: "error" as any, name: "Panic", inputs: [{ "internalType": "uint256", "name": "code", "type": "uint256" }] };

export function buildCustomErrorMap(abi: AbiItem[]) {
    function addError(item: AbiItem) {
        if (item.type as string === "error") {
            errorMap.set(coder.encodeFunctionSignature(item), item);
        }
    }
    const errorMap = new Map<string, AbiItem>;
    addError(STRING_REVERT_ERROR);
    addError(PANIC_ERROR);
    for (const item of abi) {
        addError(item);
    }
    return errorMap;
}

export function decodeRevertData(error: unknown, errorMap: Map<string, AbiItem>): RevertData | undefined {
    const hexdata = (error as any)?.data as unknown;
    if (typeof hexdata === "string" && hexdata.length >= 10) {
        const errorAbi = errorMap.get(hexdata.slice(0, 10));
        if (errorAbi && errorAbi.inputs) {
            const paramdata = "0x" + hexdata.slice(10);
            return {
                abi: errorAbi,
                name: errorAbi.name || "UNKNOWN_ERROR",
                args: coder.decodeParameters(errorAbi.inputs, paramdata)
            };
        }
    }
}

export function formatRevertData(data: RevertData) {
    const args = data.abi.inputs?.map(it => {
        const value = String(data.args[it.name]);
        return it.type === "string" ? JSON.stringify(value) : value;
    });
    return `${data.name}(${args?.join(", ")})`;
}

export function formatRevertMessage(data: RevertData) {
    if (data.abi === STRING_REVERT_ERROR) {
        return `execution reverted: ${data.args.message}`;
    } else {
        return `reverted with custom error ${formatRevertData(data)}`;
    }
}
