import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/link
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import NotFound from "../not-found";

describe("NotFound", () => {
  it("renders without crashing", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("displays the page not found heading", () => {
    render(<NotFound />);
    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });

  it("shows descriptive message", () => {
    render(<NotFound />);
    expect(
      screen.getByText(/identity you're looking for doesn't exist/),
    ).toBeInTheDocument();
  });

  it("renders Dashboard link pointing to home", () => {
    render(<NotFound />);
    const dashboardLink = screen.getByRole("link", { name: /Dashboard/i });
    expect(dashboardLink).toHaveAttribute("href", "/");
  });

  it("renders Go Back button", () => {
    const historyBackSpy = jest
      .spyOn(window.history, "back")
      .mockImplementation(() => {});
    render(<NotFound />);
    const goBackButton = screen.getByRole("button", { name: /Go Back/i });
    fireEvent.click(goBackButton);
    expect(historyBackSpy).toHaveBeenCalled();
    historyBackSpy.mockRestore();
  });
});
