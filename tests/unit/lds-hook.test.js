import React from 'react';
import { render } from '@testing-library/react-native';

const mockCall = jest.fn();
jest.mock('../../api/lds/hooks/api.hook', () => ({ useApi: () => ({ call: mockCall }) }));

const { useLds } = require('../../api/lds/hooks/lds.hook');

function lds() {
  let hook;
  const Probe = () => {
    hook = useLds();
    return null;
  };
  render(<Probe />);
  return hook;
}

const signMessage = jest.fn(async message => `sig:${message.length}`);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useLds findUser', () => {
  it('signs in without signing up and loads the user', async () => {
    mockCall.mockResolvedValueOnce({ accessToken: 'token-1' }).mockResolvedValueOnce({ address: 'bc1q', lightning: {} });

    const user = await lds().findUser('bc1q', signMessage);

    expect(user).toEqual({ address: 'bc1q', lightning: {} });
    expect(signMessage.mock.calls[0][0]).toMatch(/_Your_ID:_bc1q$/);
    expect(mockCall.mock.calls[0][0]).toEqual({
      method: 'POST',
      url: 'auth/sign-in',
      data: { address: 'bc1q', signature: expect.any(String) },
    });
    expect(mockCall.mock.calls[1][0]).toEqual({ method: 'GET', url: 'user', token: 'token-1' });
    expect(mockCall.mock.calls.some(([config]) => config.url === 'auth')).toBe(false);
  });

  it('resolves undefined when no account exists', async () => {
    mockCall.mockRejectedValueOnce({ statusCode: 404, message: 'User not found' });

    await expect(lds().findUser('bc1q', signMessage)).resolves.toBeUndefined();
    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it('rethrows other failures so an outage is not read as a missing account', async () => {
    mockCall.mockRejectedValueOnce({ statusCode: 503, message: 'unavailable' });

    await expect(lds().findUser('bc1q', signMessage)).rejects.toEqual({ statusCode: 503, message: 'unavailable' });
  });
});
