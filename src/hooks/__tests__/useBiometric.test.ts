/**
 * useBiometric — Unit Tests
 *
 * Tests for the simple biometric scanning hook.
 */

import { renderHook, act } from '@testing-library/react';
import { useBiometric } from '@/hooks/useBiometric';

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
// useBiometric
// ===========================================================================

describe('useBiometric', () => {
  it('starts with idle status and isScanned=false', () => {
    const { result } = renderHook(() => useBiometric());

    expect(result.current.scanStatus).toBe('idle');
    expect(result.current.isScanned).toBe(false);
  });

  it('transitions to scanning state when startScan is called', async () => {
    const { result } = renderHook(() => useBiometric());

    act(() => {
      result.current.startScan();
    });

    expect(result.current.scanStatus).toBe('scanning');
    expect(result.current.isScanned).toBe(false);
  });

  it('transitions to success state after timeout', async () => {
    const { result } = renderHook(() => useBiometric());

    act(() => {
      result.current.startScan();
    });

    expect(result.current.scanStatus).toBe('scanning');

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.scanStatus).toBe('success');
    expect(result.current.isScanned).toBe(true);
  });

  it('startScan is stable across renders (useCallback)', () => {
    const { result, rerender } = renderHook(() => useBiometric());
    const firstStartScan = result.current.startScan;
    rerender();
    expect(result.current.startScan).toBe(firstStartScan);
  });
});
