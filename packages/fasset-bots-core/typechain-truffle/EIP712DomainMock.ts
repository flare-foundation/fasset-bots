/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface EIP712DomainMockContract
  extends Truffle.Contract<EIP712DomainMockInstance> {
  "new"(
    name: string,
    version: string,
    meta?: Truffle.TransactionDetails
  ): Promise<EIP712DomainMockInstance>;
}

export interface EIP712DomainChanged {
  name: "EIP712DomainChanged";
  args: {};
}

export type AllEvents = EIP712DomainChanged;

export interface EIP712DomainMockInstance extends Truffle.ContractInstance {
  domainSeparatorV4(txDetails?: Truffle.TransactionDetails): Promise<string>;

  eip712Domain(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    0: string;
    1: string;
    2: string;
    3: BN;
    4: string;
    5: string;
    6: BN[];
  }>;

  hashTypedDataV4(
    structHash: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  verify(
    signature: string,
    signer: string,
    mailTo: string,
    mailContents: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<void>;

  methods: {
    domainSeparatorV4(txDetails?: Truffle.TransactionDetails): Promise<string>;

    eip712Domain(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      0: string;
      1: string;
      2: string;
      3: BN;
      4: string;
      5: string;
      6: BN[];
    }>;

    hashTypedDataV4(
      structHash: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    verify(
      signature: string,
      signer: string,
      mailTo: string,
      mailContents: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
  };

  getPastEvents(event: string): Promise<EventData[]>;
  getPastEvents(
    event: string,
    options: PastEventOptions,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
  getPastEvents(event: string, options: PastEventOptions): Promise<EventData[]>;
  getPastEvents(
    event: string,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
}
