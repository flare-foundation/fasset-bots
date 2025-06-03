// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBalanceDecreasingTransaction} from "@flarenetwork/flare-periphery-contracts/flare/IFdcVerification.sol";
import {ArbitrageConfig} from "../lib/Structs.sol";
import {ILiquidator} from "./ILiquidator.sol";


interface IChallenger is ILiquidator {

    function illegalPaymentChallenge(
        IBalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    ) external;

    function doublePaymentChallenge(
        IBalanceDecreasingTransaction.Proof calldata _payment1,
        IBalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    ) external;

    function freeBalanceNegativeChallenge(
        IBalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    ) external;

}
