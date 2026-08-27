import { renderHook } from "@testing-library/react";
import { useSeal, useSealVerification, useJob } from "@/lib/aethelred/react";
import * as sdkReact from "@aethelred/sdk/react";
import { getAethelredClient } from "@/lib/aethelred/client";

jest.mock("@aethelred/sdk/react");
jest.mock("@/lib/aethelred/client");

const client = { id: "client" };

beforeEach(() => {
  (getAethelredClient as jest.Mock).mockReturnValue(client);
  (sdkReact.useSeal as jest.Mock).mockReturnValue({
    status: "idle",
    data: null,
  });
  (sdkReact.useSealVerification as jest.Mock).mockReturnValue({
    status: "idle",
    data: null,
  });
  (sdkReact.useJob as jest.Mock).mockReturnValue({
    status: "idle",
    data: null,
  });
});
afterEach(() => jest.clearAllMocks());

describe("boundary react hooks inject the canonical client", () => {
  it("useSeal forwards the boundary client to the SDK hook", () => {
    renderHook(() => useSeal("s1"));
    expect(sdkReact.useSeal).toHaveBeenCalledWith(client, "s1", undefined);
  });

  it("useSealVerification forwards the boundary client", () => {
    renderHook(() => useSealVerification("s1"));
    expect(sdkReact.useSealVerification).toHaveBeenCalledWith(
      client,
      "s1",
      undefined,
    );
  });

  it("useJob forwards the boundary client and options", () => {
    renderHook(() => useJob("j1", { stopOnTerminal: true }));
    expect(sdkReact.useJob).toHaveBeenCalledWith(client, "j1", {
      stopOnTerminal: true,
    });
  });
});
