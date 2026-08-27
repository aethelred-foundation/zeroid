const mockRedirect = jest.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

jest.mock("next/navigation", () => ({
  redirect: (destination: string) => mockRedirect(destination),
}));

import IntegrationsPage from "../page";

describe("IntegrationsPage", () => {
  it("redirects the static catalogue to the backend-backed enterprise console", () => {
    expect(() => IntegrationsPage()).toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/enterprise");
  });
});
