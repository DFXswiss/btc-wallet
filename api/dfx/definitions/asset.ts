export const AssetUrl = { get: 'asset' };

export interface Asset {
  id: number;
  name: string;
  description: string;
  buyable: boolean;
  sellable: boolean;
  comingSoon: boolean;
  sortOrder?: number;
}
