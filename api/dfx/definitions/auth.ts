export const AuthUrl = { signMessage: 'auth/signMessage', auth: 'auth/'};

export interface SignMessage {
  message: string;
}

export interface Auth {
  accessToken: string;
}
