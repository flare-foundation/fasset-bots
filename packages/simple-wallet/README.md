# Simple wallet

This is a Typescript library that allows querying basic wallet functions from any blockchain in a unified manner. It somewhat dependent on [MCC](https://github.com/flare-foundation/multi-chain-client) and some useful blockchain essentials can be found on their [docs](https://github.com/flare-foundation/multi-chain-client/blob/main/docs/README.md).

## Supported blockchains

- [BTC](https://developer.bitcoin.org/index.html)
- [DOGE](https://dogecoin.com/)
- [XRP](https://xrpl.org/docs.html)

## Installation

- Clone the project, change directory to `simple-wallet`.

```
git clone git@gitlab.com:flarenetwork/simple-wallet.git
cd simple-wallet
```

- Install `node_modules`

```
yarn
```

- Create following `.env` file in root directory (see `.env.template`)

## Examples

Examples for **creating a wallet**, **preparing transaction**, **signing transaction**, **submitting transaction** and **getting balance** can be found in the following test files. Examples are working with the `.env` file provided above.


- [BTC examples](./test/BTC/wallet.test.ts),
- [DOGE examples](./test/DOGE/wallet.test.ts),
- [XRP examples](./test/XRP/wallet.test.ts).

## Implementation

Implemented functions:

```javascript
   createWallet()
:
ICreateWalletResponse;
createWalletFromMnemonic(mnemonic
:
string
):
ICreateWalletResponse;

getAccountBalance(account)
:
string
):
Promise < BN >;
getCurrentTransactionFee(params
:
FeeParams
):
Promise < BN >;

preparePaymentTransaction(
    source
:
string,
    destination
:
string,
    amount
:
BN | null,
    fee ? : BN,
    note ? : string,
    maxFee ? : BN,
    sequence ? : number
):
Promise < any >;
signTransaction(transaction
:
any, privateKey
:
string
):
Promise < string >;
submitTransaction(signedTx
:
string
):
Promise < any >;
executeLockedSignedTransactionAndWait(
    source
:
string,
    privateKey
:
string,
    destination
:
string,
    amount
:
BN | null,
    fee ? : BN,
    note ? : string,
    maxFee ? : BN,
    sequence ? : number
):
Promise < any >;

deleteAccount(
    source
:
string,
    privateKey
:
string,
    destination
:
string,
    fee ? : BN,
    note ? : string,
    maxFee ? : BN,
    sequence ? : number
):
Promise < any >;
```

## Tests

Test files are stored in directory `test` and are split into subdirectories. Test directly linked to blockchains can be found in:

- [`test/BTC`](./test/BTC),
- [`test/DOGE`](./test/DOGE),
- [`test/XRP`](./test/XRP).

Other tests can be found in [`test/OTHER`](./test/OTHER).

### Running tests

Single can be run with following command:

```
yarn test test/[subdirectory]/[test-file].test.ts
```

Test coverage can be run with following command:

```
yarn test test:coverage
```
Beware currently timeout on coverage tests in set to ```500000ms```.

## Minimum balance

For account to be activated some minimum balance should be satisfied.

#### XRP:
- [Minimum balance](https://xrpl.org/accounts.html) is 10 XRP

## Testnet faucets

https://docs.lmnl.app/docs/testnet-faucets-guide

#### BTC:
- https://bitcoinfaucet.uo1.net - 0.0007 BTC per hour

#### DOGE:
- https://dogecoin-faucet.ruan.dev - 1000 DOGE per hour (locked on address)

#### XRP:
- https://test.bithomp.com/faucet - 1000 XRP
- https://xrpl.org/xrp-testnet-faucet.html - 1000 XRP (they generate the address)

## Blockchain explorers
Following are some of mainnet and testnet explorers:

#### BTC:
- Mainnet explorer: https://sochain.com/btc
- Testnet explorer: https://sochain.com/testnet/btc

#### DOGE:
- Mainnet explorer: https://sochain.com/doge
- Testnet explorer: https://sochain.com/testnet/doge

#### XRP:
- Mainnet explorer: https://livenet.xrpl.org/
- Testnet explorer: https://testnet.xrpl.org/

## Basic use

Following is a minimal example to create a wallet on BTC blockchain with a custom connection.

```javascript
// Configuration object
const connectConfig = {
   url: "https://myAwesomeBtcTestnetNode.com/",
   username: "user",
   password: "pass",
   inTestnet: true
};

// WALLET object used to connect to Bitcoin node
const wClient = new BTC(connectConfig);

// Create a wallet
const newAccount = wClient();
// Log wallet details
console.log(newAccount); // => { address: <address>, mnemonic: <mnemonic>, privateKey: <privateKey>, publicKey: <publicKey> }
```
