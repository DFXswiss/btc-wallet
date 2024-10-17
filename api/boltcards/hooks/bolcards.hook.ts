import { useApi } from './api.hook';
import { BoltcardUrl } from '../definitions/urls';
import { BoltcardCreateDTO, BoltcardUpdateDTO, Hit } from '../definitions/apiDtos';
import { BolcardSecrets, BoltCardModel } from '../../../models/boltcard';
import { useWalletContext } from '../../../contexts/wallet.context';
const createHash = require('create-hash');

type UseLdsBoltcards = {
  getBoltcards: (invoiceId: string) => Promise<BoltCardModel[]>;
  createBoltcard: (adminKey: string, freshCardDetails: BoltcardCreateDTO) => Promise<BoltCardModel>;
  genFreshCardDetails: () => Promise<BoltcardCreateDTO>;
  getBoltcardSecret: (boltcard: BoltCardModel) => Promise<BolcardSecrets>;
  updateBoltcard: (adminKey: string, boltcard: BoltcardUpdateDTO) => Promise<BoltCardModel>;
  enableBoltcard: (adminKey: string, boltcard: BoltcardUpdateDTO, state: boolean) => Promise<BoltCardModel>;
  getHits: (invoiceId: string) => Promise<Hit[]>;
  deleteBoltcard: (adminKey: string, boltcard: BoltCardModel) => Promise<void>;
};

const generateRandomHex = (size: number): string => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

const hashIt = (s: string) => createHash('sha256').update(s).digest().toString('hex');

export function useLdsBoltcards(): UseLdsBoltcards {
  const { getOwnershipProof } = useWalletContext();
  const { call } = useApi();

  const genFreshCardDetails = async (): Promise<BoltcardCreateDTO> => {
    const ownerProof = await getOwnershipProof();
    const k0 = hashIt(`k0-seed-${ownerProof}`).slice(0, 32);
    const k1 = hashIt(`k1-k3-seed-${ownerProof}`).slice(0, 32);
    const k2 = hashIt(`k2-k4-seed-${ownerProof}`).slice(0, 32);

    return {
      card_name: 'BITCOIN PAY CARD',
      k0,
      k1,
      k2,
      k3: k1,
      k4: k2,
      counter: 0,
      tx_limit: 100000,
      daily_limit: 100000,
      uid: generateRandomHex(14), // dummy value, the phisical card holds the real value
    };
  };

  const getBoltcards = async (invoiceId: string): Promise<BoltCardModel[]> => {
    return call<BoltCardModel[]>({ method: 'GET', url: BoltcardUrl.cards, apiKey: invoiceId });
  };

  const createBoltcard = async (adminKey: string, freshCardDetails: BoltcardCreateDTO): Promise<BoltCardModel> => {
    return call<BoltCardModel>({ method: 'POST', url: BoltcardUrl.cards, apiKey: adminKey, data: freshCardDetails });
  };

  const getBoltcardSecret = async ({ otp }: BoltCardModel): Promise<BolcardSecrets> => {
    const url = new URL(BoltcardUrl.auth);
    url.searchParams.append('a', otp);
    return call<BolcardSecrets>({ method: 'GET', url: url.toString() });
  };

  const updateBoltcard = async (adminKey: string, boltcard: BoltcardUpdateDTO): Promise<BoltCardModel> => {
    return call<BoltCardModel>({ method: 'PUT', url: `${BoltcardUrl.cards}/${boltcard.id}`, apiKey: adminKey, data: boltcard });
  };

  const enableBoltcard = async (adminKey: string, boltcard: BoltcardUpdateDTO, state: boolean): Promise<BoltCardModel> => {
    return call<BoltCardModel>({
      method: 'GET',
      url: `${BoltcardUrl.enable}/${boltcard.id}/${state ? 'true' : 'false'}`,
      apiKey: adminKey,
    });
  };

  const getHits = async (invoiceId: string): Promise<Hit[]> => {
    const hits = await call<Hit[]>({ method: 'GET', url: BoltcardUrl.hits, apiKey: invoiceId });
    return hits.reverse().filter(({ amount }) => amount > 0);
  };

  const deleteBoltcard = async (adminKey: string, boltcard: BoltCardModel): Promise<void> => {
    await call<void>({ method: 'DELETE', url: `${BoltcardUrl.cards}/${boltcard.id}`, apiKey: adminKey });
  };

  return { getBoltcards, genFreshCardDetails, createBoltcard, getBoltcardSecret, updateBoltcard, enableBoltcard, getHits, deleteBoltcard };
}

export default useLdsBoltcards;
