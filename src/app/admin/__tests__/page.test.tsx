const mockRedirect = jest.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

jest.mock("next/navigation", () => ({
  redirect: (destination: string) => mockRedirect(destination),
}));

import AdminPage from "../page";

describe("AdminPage", () => {
  it("redirects the unsupported static admin surface to the enterprise console", () => {
    expect(() => AdminPage()).toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/enterprise");
  });
});
