export const SwapUrl = { get: 'swap' };

export interface SwapInfo {
    active: boolean;
    annualVolume: number;
    asset: {
        blockchain: string;
        buyable: boolean;
        cardBuyable: boolean;
        cardSellable: boolean;
        category: string;
        chainId: null;
        comingSoon: boolean;
        description: string;
        dexName: string;
        explorerUrl: string;
        feeTier: string;
        id: number;
        instantBuyable: boolean;
        instantSellable: boolean;
        name: string;
        sellable: boolean;
        sortOrder: null;
        type: string;
        uniqueName: string;
    };
    blockchain: string;
    deposit: {
        address: string;
        blockchain: string;
        blockchains: string[];
        id: number;
    };
    fee: number;
    id: number;
    minDeposits: {
        amount: number;
        asset: string;
    }[];
    minFee: {
        amount: number;
        asset: string;
    };
    volume: number;
}