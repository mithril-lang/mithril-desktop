import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryEntries } from "./MemoryEntries";
import { MemoryProfile } from "./MemoryProfile";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
describe("Native Memory original edit snapshot", () => {
  it("keeps the captured entry base after another writer refreshes the displayed list", async () => {
    const update = vi.fn(async () => ({
      success: false,
      error: "Memory changed",
    }));
    window.hermesAPI = {
      updateMemoryEntry: update,
    } as unknown as typeof window.hermesAPI;
    const expected = { memory: "Original", user: "Person" };
    const { rerender } = render(
      <MemoryEntries
        entries={[{ index: 0, content: "Original" }]}
        expected={expected}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "memory.edit" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Edited" },
    });
    rerender(
      <MemoryEntries
        entries={[{ index: 0, content: "Agent update" }]}
        expected={{ memory: "Agent update", user: "Person" }}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "memory.save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(0, "Edited", undefined, expected),
    );
    expect(screen.getByText("Memory changed")).toBeDefined();
  });
  it("refreshes untouched USER content but preserves an edited draft's original base", async () => {
    const write = vi.fn(async () => ({
      success: false,
      error: "Memory changed",
    }));
    window.hermesAPI = {
      writeUserProfile: write,
    } as unknown as typeof window.hermesAPI;
    const { rerender } = render(
      <MemoryProfile
        content="Original"
        charLimit={100}
        expected={{ memory: "Notes", user: "Original" }}
        onRefresh={vi.fn()}
      />,
    );
    const expected = { memory: "Notes", user: "Newer" };
    rerender(
      <MemoryProfile
        content="Newer"
        charLimit={100}
        expected={expected}
        onRefresh={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Newer",
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Draft" },
    });
    rerender(
      <MemoryProfile
        content="Another writer"
        charLimit={100}
        expected={{ memory: "Notes", user: "Another writer" }}
        onRefresh={vi.fn()}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Draft",
    );
    fireEvent.click(screen.getByRole("button", { name: "memory.saveProfile" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("Draft", undefined, expected),
    );
  });
});
