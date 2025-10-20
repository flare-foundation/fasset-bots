import { ARBase, AddressValidity, decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { formatArgs } from "../utils/formatting";
import { ZERO_BYTES32 } from "../utils/helpers";
import { logger } from "../utils/logger";
import { MultiApiClient, MultiApiClientError } from "../utils/MultiApiClient";
import { IVerificationApiClient } from "./interfaces/IVerificationApiClient";

export class VerificationApiError extends Error {}

interface VerificationResponseWrapper<T> {
    status: "VALID" | "INVALID";
    response?: T;
}

// Uses prepareResponse from private API.
export class VerificationPrivateApiClient implements IVerificationApiClient {
    verifier: MultiApiClient;

    constructor(
        verifierUrls: string[],
        verifierUrlApiKeys: string[],
    ) {
        this.verifier = MultiApiClient.create("VerifierPrivateApi");
        for (const [index, url] of verifierUrls.entries()) {
            this.verifier.addClient(url, verifierUrlApiKeys[index], index);
        }
    }

    async checkAddressValidity(chainId: string, addressStr: string): Promise<AddressValidity.ResponseBody> {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: chainId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: { addressStr },
        };
        const response = await this.prepareResponse<AddressValidity.Response>(request);
        /* istanbul ignore next */
        if (response.response == null) {
            throw new VerificationApiError(`Invalid request ${formatArgs(request)}`);
        }
        return response.response.responseBody;
    }

    async prepareResponse<T>(request: ARBase): Promise<VerificationResponseWrapper<T>> {
        const attestationName = decodeAttestationName(request.attestationType);
        /* istanbul ignore next */
        try {
            return await this.verifier.post<VerificationResponseWrapper<T>>(`/${encodeURIComponent(attestationName)}/prepareResponse`, request, "prepareResponse");
        } catch (error) {
            let message: string;
            if (error instanceof MultiApiClientError) {
                const serviceErrorResp = error.lastServiceError()?.response;
                message = `Verification API error: cannot submit request[${error.requestId}] ${formatArgs(request)}: ${serviceErrorResp?.status}: ${(serviceErrorResp?.data as any)?.error}`;
            } else {
                message = `Verification API error: cannot submit request ${formatArgs(request)}: ${String(error)}`;
            }
            logger.error(message);
            throw new VerificationApiError(message);
        }
    }
}
