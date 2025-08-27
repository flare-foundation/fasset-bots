// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Transaction } from 'bitcore-lib';

declare module 'bitcore-lib' {
    interface Transaction {
        _calculateSize(): number;
        _calculateVSize(noRound?: boolean): number;
        _calculateWeight(): number;
        _estimateSize(): number;
    }
}