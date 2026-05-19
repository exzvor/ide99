import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineEditor } from "./InlineEditor";

describe("InlineEditor", () => {
  it("renders initial value as text when not editing", () => {
    render(<InlineEditor value="users" onCommit={() => {}} />);
    expect(screen.getByText("users")).toBeInTheDocument();
  });

  it("clicking switches to input + auto-focuses", () => {
    render(<InlineEditor value="users" onCommit={() => {}} />);
    fireEvent.click(screen.getByText("users"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.value).toBe("users");
  });

  it("Enter commits new value and exits editing", () => {
    const onCommit = vi.fn();
    render(<InlineEditor value="users" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("users"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "members" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("members");
    expect(screen.getByText("members")).toBeInTheDocument();
  });

  it("ESC reverts and exits editing without commit", () => {
    const onCommit = vi.fn();
    render(<InlineEditor value="users" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("users"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "members" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("users")).toBeInTheDocument();
  });

  it("blur commits non-empty value", () => {
    const onCommit = vi.fn();
    render(<InlineEditor value="users" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("users"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "members" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("members");
  });

  it("empty submission stays in editing mode (no commit)", () => {
    const onCommit = vi.fn();
    render(<InlineEditor value="users" onCommit={onCommit} />);
    fireEvent.click(screen.getByText("users"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it("disabled mode shows static text, no click handler", () => {
    render(<InlineEditor value="users" onCommit={() => {}} disabled />);
    fireEvent.click(screen.getByText("users"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
