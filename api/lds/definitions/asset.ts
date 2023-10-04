export enum AssetStatus {
  COMING_SOON = 'ComingSoon',
  ACTIVE = 'Active',
}

export interface Asset {
  name: string;
  displayName: string;
  description?: string;
  status: AssetStatus;
}
