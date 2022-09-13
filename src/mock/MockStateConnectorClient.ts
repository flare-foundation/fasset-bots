import { StateConnectorMockInstance } from "../../typechain-truffle";
import { AttestationRequest, AttestationResponse, IStateConnectorClient } from "../underlying-chain/interfaces/IStateConnectorClient";
import { filterStackTrace, sleep, toBN, toNumber, ZERO_BYTES32 } from "../utils/helpers";
import { stringifyJson } from "../utils/json-bn";
import { ILogger } from "../utils/logging";
import { DHType } from "../verification/generated/attestation-hash-types";
import { dataHash } from "../verification/generated/attestation-hash-utils";
import { parseRequest } from "../verification/generated/attestation-request-parse";
import { ARBalanceDecreasingTransaction, ARConfirmedBlockHeightExists, ARPayment, ARReferencedPaymentNonexistence, ARType } from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { SourceId } from "../verification/sources/sources";
import { MerkleTree } from "./MerkleTree";
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
    constructor(
        public stateConnector: StateConnectorMockInstance,
        public supportedChains: { [chainId: number]: MockChain },
        public finalizationType: AutoFinalizationType,
    ) {
    }
    
    rounds: string[][] = [];
    finalizedRounds: FinalizedRound[] = [];
    logger?: ILogger;
    queryWindowSeconds = 86400;
    
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
    
    async submitRequest(data: string): Promise<AttestationRequest> {
        // start new round?
        if (this.finalizedRounds.length >= this.rounds.length) {
            this.rounds.push([]);
        }
        // add request
        const round = this.rounds.length - 1;
        this.rounds[round].push(data);
        this.logger?.log(`STATE CONNECTOR SUBMIT round=${round} data=${data}`);
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
            const proof = this.proveRequest(reqData);
            if (proof != null) {
                proofs[reqData] = proof;
            }
        }
        // build merkle tree
        const hashes = Object.values(proofs).map(proof => proof.hash);
        const tree = new MerkleTree(hashes);
        await this.stateConnector.setMerkleRoot(round, tree.root ?? ZERO_BYTES32);
        for (const proof of Object.values(proofs)) {
            proof.data.stateConnectorRound = round;
            proof.data.merkleProof = tree.getProofForValue(proof.hash) ?? [];
        }
        // add new finalized round
        this.finalizedRounds.push({ proofs, tree });
        // log
        if (this.logger) {
            this.logger.log(`STATE CONNECTOR ROUND ${round} FINALIZED`);
            for (const [data, proof] of Object.entries(proofs)) {
                this.logger.log(`    ${data}  ${stringifyJson(proof)}`);
            }
        }
    }
    
    private proveRequest(requestData: string): DHProof | null {
        try {
            const request = parseRequest(requestData);
            const response = this.proveParsedRequest(request);
            const hash = dataHash({ attestationType: request.attestationType, sourceId: request.sourceId } as ARType, response);
            return { attestationType: request.attestationType, sourceId: request.sourceId, data: response, hash: hash };
        } catch (e) {
            if (e instanceof MockAttestationProverError) {
                const stack = filterStackTrace(e);
                console.error(stack);
                this.logger?.log("!!! " + stack);
                return null;
            }
            throw e;    // other errors not allowed
        }
    }
    
    private proveParsedRequest(parsedRequest: ARType): DHType {
        const chain = this.supportedChains[parsedRequest.sourceId];
        if (chain == null) throw new StateConnectorClientError(`StateConnectorClient: unsupported chain ${parsedRequest.sourceId}`);
        const prover = new MockAttestationProver(chain, this.queryWindowSeconds);
        switch (parsedRequest.attestationType) {
            case AttestationType.Payment: {
                const request = parsedRequest as ARPayment;
                return prover.payment(request.id, toNumber(request.inUtxo), toNumber(request.utxo), request.upperBoundProof);
            }
            case AttestationType.BalanceDecreasingTransaction: {
                const request = parsedRequest as ARBalanceDecreasingTransaction;
                return prover.balanceDecreasingTransaction(request.id, toNumber(request.inUtxo), request.upperBoundProof);
            }
            case AttestationType.ReferencedPaymentNonexistence: {
                const request = parsedRequest as ARReferencedPaymentNonexistence;
                return prover.referencedPaymentNonexistence(request.destinationAddressHash, request.paymentReference,
                    toBN(request.amount), toNumber(request.deadlineBlockNumber), toNumber(request.deadlineTimestamp));
            }
            case AttestationType.ConfirmedBlockHeightExists: {
                const request = parsedRequest as ARConfirmedBlockHeightExists;
                return prover.confirmedBlockHeightExists(request.upperBoundProof);
            }
            default: {
                throw new StateConnectorClientError(`StateConnectorClient: unsupported attestation request ${AttestationType[parsedRequest.attestationType]} (${parsedRequest.attestationType})`);
            }
        }
    }
}
