import { sendRouteError, type RouteError } from '../src/utils/route-error';

function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn(function status(this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: typeof res, body: unknown) {
      this.body = body;
      return this;
    }),
  };
  return res;
}

describe('route error responder', () => {
  it('masks server error messages before sending responses', () => {
    const res = mockResponse();
    const error = new Error('database password auth failed') as RouteError;

    sendRouteError(res as any, error, 'IDENTITY_REGISTER_FAILED');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body).toEqual({
      error: 'Internal server error',
      code: 'IDENTITY_REGISTER_FAILED',
    });
  });

  it('preserves intentional client error messages and codes', () => {
    const res = mockResponse();
    const error = Object.assign(new Error('Invalid recovery proof'), {
      statusCode: 400,
      code: 'IDENTITY_RECOVERY_PROOF_INVALID',
    });

    sendRouteError(res as any, error, 'IDENTITY_RECOVER_FAILED');

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({
      error: 'Invalid recovery proof',
      code: 'IDENTITY_RECOVERY_PROOF_INVALID',
    });
  });
});
