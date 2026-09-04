/*
 * Binds the freshness guard's precondition to the REAL circuit registry.
 *
 * zk-predicate refuses a proof unless the policy's freshness signal is one the
 * circuit declares. Its own unit tests supply that declared list as a fixture,
 * which is the right shape for exercising the guard but proves nothing about
 * production: if the registry entry and the fixture drift apart, the guard is
 * checking the policy against a copy of itself and every test still passes.
 *
 * This asserts the three real objects agree — the shipped policy, the resolver
 * the routes actually construct, and the registry entry it reads. Runtime is
 * mocked only to keep Prisma and redis out of a unit test; the registry and the
 * resolver are the production ones.
 */

jest.mock('../../src/runtime', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  redis: { get: jest.fn(), set: jest.fn() },
}));

import { ZKProofService } from '../../src/services/zkproof';
import { createZkProofServiceSignalResolver } from '../../src/services/oid4vp/zk-proofservice-verifier';
import { getPresentationPolicy } from '../../src/services/oid4vp/policy-presentation';

const POLICY_ID =
  'zeroid://policy/regulated-digital-services/age-jurisdiction@2026.06.1';

describe('freshness signal against the real circuit registry', () => {
  const policy = getPresentationPolicy(POLICY_ID);
  const resolve = createZkProofServiceSignalResolver(new ZKProofService());

  it('the shipped policy declares a freshness binding', () => {
    expect(policy.zk?.freshness?.signal).toBeTruthy();
  });

  it('resolves the policy circuit through the production resolver', () => {
    expect(resolve(policy.zk!.circuitId)).not.toBeNull();
  });

  it('the registry declares the very signal the policy pins freshness to', () => {
    // The assertion that makes the guard meaningful in production rather than
    // only against its own fixture.
    expect(resolve(policy.zk!.circuitId)).toContain(policy.zk!.freshness.signal);
  });
});
