/**
 * useUAEPass — Unit Tests
 *
 * Tests for the UAE Pass identity verification hook.
 */

import { renderHook, act } from '@testing-library/react';
import { useUAEPass } from '@/hooks/useUAEPass';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ===========================================================================
// useUAEPass
// ===========================================================================

describe('useUAEPass', () => {
  it('starts with idle status and isVerified=false', () => {
    const { result } = renderHook(() => useUAEPass());

    expect(result.current.verificationStatus).toBe('idle');
    expect(result.current.isVerified).toBe(false);
  });

  it('transitions to pending when initiateVerification is called', () => {
    const { result } = renderHook(() => useUAEPass());

    act(() => {
      result.current.initiateVerification();
    });

    expect(result.current.verificationStatus).toBe('pending');
    expect(result.current.isVerified).toBe(false);
  });

  it('transitions to verified after timeout', () => {
    const { result } = renderHook(() => useUAEPass());

    act(() => {
      result.current.initiateVerification();
    });

    expect(result.current.verificationStatus).toBe('pending');

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.verificationStatus).toBe('verified');
    expect(result.current.isVerified).toBe(true);
  });

  it('does not change to verified before 2 seconds', () => {
    const { result } = renderHook(() => useUAEPass());

    act(() => {
      result.current.initiateVerification();
    });

    act(() => {
      jest.advanceTimersByTime(1999);
    });

    expect(result.current.verificationStatus).toBe('pending');
    expect(result.current.isVerified).toBe(false);
  });

  it('initiateVerification is stable across renders (useCallback)', () => {
    const { result, rerender } = renderHook(() => useUAEPass());
    const firstRef = result.current.initiateVerification;
    rerender();
    expect(result.current.initiateVerification).toBe(firstRef);
  });
});
