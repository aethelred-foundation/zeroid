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

  it('passes through a listed 5xx code with its fixed message', () => {
    const res = mockResponse();
    const error = Object.assign(
      new Error('Identity registry verification is not configured'),
      { statusCode: 503, code: 'IDENTITY_REGISTRY_NOT_CONFIGURED' },
    );

    sendRouteError(res as any, error, 'IDENTITY_REGISTER_FAILED', {
      passthroughCodes: ['IDENTITY_REGISTRY_NOT_CONFIGURED'],
    });

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toEqual({
      error: 'Identity registry verification is not configured',
      code: 'IDENTITY_REGISTRY_NOT_CONFIGURED',
    });
  });

  it('still masks 5xx codes that are not on the passthrough list', () => {
    const res = mockResponse();
    const error = Object.assign(new Error('pg://user:pw@host failed'), {
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
    });

    sendRouteError(res as any, error, 'IDENTITY_REGISTER_FAILED', {
      passthroughCodes: ['IDENTITY_REGISTRY_NOT_CONFIGURED'],
    });

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toEqual({
      error: 'Internal server error',
      code: 'IDENTITY_REGISTER_FAILED',
    });
  });

  it('never applies passthrough to client errors (their message is already sent)', () => {
    const res = mockResponse();
    const error = Object.assign(new Error('DID already registered'), {
      statusCode: 409,
      code: 'IDENTITY_DID_EXISTS',
    });

    sendRouteError(res as any, error, 'IDENTITY_REGISTER_FAILED', {
      passthroughCodes: ['IDENTITY_DID_EXISTS'],
    });

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      error: 'DID already registered',
      code: 'IDENTITY_DID_EXISTS',
    });
  });
});
