import { StateConnectorMockInstance } from "../../typechain-truffle";
import { AttestationRequestId, AttestationResponse, IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { MerkleTree } from "../utils/MerkleTree";
import { StaticAttestationDefinitionStore } from "../utils/StaticAttestationDefinitionStore";
import { ZERO_BYTES32, filterStackTrace, sleep, toBN, toNumber } from "../utils/helpers";
import { MIC_SALT } from "../verification/attestation-types/attestation-types";
import { DHType } from "../verification/generated/attestation-hash-types";
import { ARBalanceDecreasingTransaction, ARBase, ARConfirmedBlockHeightExists, ARPayment, ARReferencedPaymentNonexistence } from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { SourceId } from "../verification/sources/sources";
import { MockAttestationProver, MockAttestationProverError } from "./MockAttestationProver";
import { MockChain } from "./MockChain";

interface DHProof {
    attestationType: AttestationType;
    sourceId: SourceId;
    data: DHType;
    hash: string;
}

interface FinalizedRound {
    proofs: { [requestData: string]: DHProof };
    tree: MerkleTree;
}

export class StateConnectorClientError extends Error {
    constructor(message: string) {
        super(message);
    }
}

// auto - create new round for every pushed request and finalize immediately - useful for unit tests
// on_wait - during waitForRoundFinalization finalize up to the awaited round - simulates simple (linear) real usage
// timed - finalize rounds based on time, like in real case
// manual - user must manually call finalizeRound()
export type AutoFinalizationType = 'auto' | 'on_wait' | 'timed' | 'manual';

export class MockStateConnectorClient implements IStateConnectorClient {
    static deepCopyWithObjectCreate = true;

    constructor(
        public stateConnector: StateConnectorMockInstance,
        public supportedChains: { [chainId: number]: MockChain },
        public finalizationType: AutoFinalizationType,
    ) {
    }

    rounds: string[][] = [];
    finalizedRounds: FinalizedRound[] = [];
    queryWindowSeconds = 86400;
    definitionStore = new StaticAttestationDefinitionStore();

    setTimedFinalization(timedRoundSeconds: number) {
        this.finalizationType = 'timed';
        setInterval(() => this.finalizeRound(), timedRoundSeconds * 1000);
    }

    addChain(id: SourceId, chain: MockChain) {
        this.supportedChains[id] = chain;
    }

    async roundFinalized(round: number): Promise<boolean> {
        return this.finalizedRounds.length > round;
    }

    async waitForRoundFinalization(round: number): Promise<void> {
        if (round >= this.rounds.length) {
            throw new StateConnectorClientError(`StateConnectorClient: round doesn't exist yet (${round} >= ${this.rounds.length})`);
        }
        while (this.finalizedRounds.length <= round) {
            if (this.finalizationType == 'on_wait') {
                await this.finalizeRound();
            } else {
                await sleep(1000);
            }
        }
    }

    async submitRequest(request: ARBase): Promise<AttestationRequestId | null> {
        // add message integrity code to request data - for this, we have to obtain the response before submitting request
        const responseData = this.proveParsedRequest(request);
        if (responseData == null) return null;  // cannot prove request (yet)
        const mic = this.definitionStore.dataHash(request, responseData, MIC_SALT);
        if (mic == null) {
            throw new StateConnectorClientError(`StateConnectorClient: invalid attestation data`);
        }
        const data = this.definitionStore.encodeRequest({ ...request, messageIntegrityCode: mic });
        // start new round?
        if (this.finalizedRounds.length >= this.rounds.length) {
            this.rounds.push([]);
        }
        // add request
        const round = this.rounds.length - 1;
        this.rounds[round].push(data);
        // auto finalize?
        if (this.finalizationType === 'auto') {
            await this.finalizeRound();
        }
        return { round, data };
    }

    async obtainProof(round: number, requestData: string): Promise<AttestationResponse<DHType>> {
        if (round >= this.finalizedRounds.length) {
            return { finalized: false, result: null };  // not yet finalized
        }
        const proof = this.finalizedRounds[round].proofs[requestData];
        if (proof == null) {
            return { finalized: true, result: null };   // disproved
        }
        return { finalized: true, result: proof.data }; // proved
    }

    finalizing = false;

    async finalizeRound() {
        while (this.finalizing) await sleep(100);
        this.finalizing = true;
        try {
            await this._finalizeRound();
        } finally {
            this.finalizing = false;
        }
    }

    private async _finalizeRound() {
        const round = this.finalizedRounds.length;
        // all rounds finalized?
        if (round >= this.rounds.length) return;
        // if this is the last round, start a new one, so that the one we are finalizing doesn't change
        if (round == this.rounds.length - 1) {
            this.rounds.push([]);
        }
        // verify and collect proof data of requests
        const proofs: { [data: string]: DHProof } = {};
        for (const reqData of this.rounds[round]) {
            const proof = this.proveRequest(reqData, round);
            if (proof != null) {
                proofs[reqData] = proof;
            }
        }
        // build merkle tree
        const hashes = Object.values(proofs).map(proof => proof.hash);
        const tree = new MerkleTree(hashes);
        await this.stateConnector.setMerkleRoot(round, tree.root ?? ZERO_BYTES32);
        for (const proof of Object.values(proofs)) {
            proof.data.merkleProof = tree.getProofForValue(proof.hash) ?? [];
        }
        // add new finalized round
        this.finalizedRounds.push({ proofs, tree });
    }

    private proveRequest(requestData: string, stateConnectorRound: number): DHProof | null {
        const request = this.definitionStore.parseRequest<ARBase>(requestData);
        const response = this.proveParsedRequest(request);
        if (response == null) return null;
        // verify MIC (message integrity code) - stateConnectorRound field must be 0
        const mic = this.definitionStore.dataHash(request, response, MIC_SALT);
        if (mic == null || mic !== request.messageIntegrityCode) {
            throw new StateConnectorClientError(`StateConnectorClient: invalid message integrity code`);
        }
        // calculate hash for Merkle tree - requires correct stateConnectorRound field
        response.stateConnectorRound = stateConnectorRound;
        const hash = this.definitionStore.dataHash(request, response);
        if (hash == null) {
            throw new StateConnectorClientError(`StateConnectorClient: invalid attestation reponse`);
        }
        return { attestationType: request.attestationType, sourceId: request.sourceId, data: response, hash: hash };
    }

    private proveParsedRequest(parsedRequest: ARBase): DHType | null {
        try {
            const chain = this.supportedChains[parsedRequest.sourceId];
            if (chain == null) throw new StateConnectorClientError(`StateConnectorClient: unsupported chain ${parsedRequest.sourceId}`);
            const prover = new MockAttestationProver(chain, this.queryWindowSeconds);
            switch (parsedRequest.attestationType) {
                case AttestationType.Payment: {
                    const request = parsedRequest as ARPayment;
                    return prover.payment(request.id, toNumber(request.blockNumber), toNumber(request.inUtxo), toNumber(request.utxo));
                }
                case AttestationType.BalanceDecreasingTransaction: {
                    const request = parsedRequest as ARBalanceDecreasingTransaction;
                    return prover.balanceDecreasingTransaction(request.id, toNumber(request.blockNumber), request.sourceAddressIndicator);
                }
                case AttestationType.ReferencedPaymentNonexistence: {
                    const request = parsedRequest as ARReferencedPaymentNonexistence;
                    return prover.referencedPaymentNonexistence(request.destinationAddressHash, request.paymentReference, toBN(request.amount),
                        toNumber(request.minimalBlockNumber), toNumber(request.deadlineBlockNumber), toNumber(request.deadlineTimestamp));
                }
                case AttestationType.ConfirmedBlockHeightExists: {
                    const request = parsedRequest as ARConfirmedBlockHeightExists;
                    return prover.confirmedBlockHeightExists(toNumber(request.blockNumber), toNumber(request.queryWindow));
                }
                default: {
                    throw new StateConnectorClientError(`StateConnectorClient: unsupported attestation request ${AttestationType[parsedRequest.attestationType]} (${parsedRequest.attestationType})`);
                }
            }
        } catch (e) {
            if (e instanceof MockAttestationProverError) {
                const stack = filterStackTrace(e);
                console.error(stack);
                return null;
            }
            throw e;    // other errors not allowed
        }
    }
}
