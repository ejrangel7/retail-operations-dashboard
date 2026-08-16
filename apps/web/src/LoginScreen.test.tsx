// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "./LoginScreen";

afterEach(() => cleanup());

describe("LoginScreen", () => {
  it("submits demo credentials", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginScreen submitting={false} error="" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Email"), "viewer@retail.local");
    await user.type(screen.getByLabelText("Password"), "RetailView!2026");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSubmit).toHaveBeenCalledWith("viewer@retail.local", "RetailView!2026");
  });

  it("shows authentication feedback and submitting state", () => {
    render(<LoginScreen submitting error="Invalid email or password" onSubmit={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "name@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByText(/viewer@retail.local/)).not.toBeInTheDocument();
    expect(screen.queryByText(/RetailView!2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/operator@retail.local/)).not.toBeInTheDocument();
  });
});
