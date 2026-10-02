import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModelConfig } from "./useModelConfig";
const catalog = vi.hoisted(() => ({
  models: ["qwen/qwen3.8-27b"],
  status: "ok",
}));
vi.mock("../../../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: (args: { provider: string }) => {
    expect(args.provider).toBe("mithril");
    return catalog;
  },
}));
vi.mock("../../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
let changed: () => void;
let select: ReturnType<typeof useModelConfig>["selectModel"];
function Harness(): React.JSX.Element {
  const state = useModelConfig();
  useEffect(() => {
    select = state.selectModel;
  }, [state.selectModel]);
  return <output>{JSON.stringify(state)}</output>;
}
beforeEach(() => {
  catalog.models = ["qwen/qwen3.8-27b"];
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getModelConfig: vi.fn(async () => ({
        provider: "openai-codex",
        model: "gpt-5.5",
        baseUrl: "",
      })),
      listModels: vi.fn(async () => [
        {
          provider: "openai-codex",
          model: "gpt-5.5",
          name: "Legacy Codex",
          baseUrl: "",
        },
      ]),
      onConnectionConfigChanged: vi.fn(() => vi.fn()),
      onModelLibraryChanged: vi.fn((fn) => {
        changed = fn;
        return vi.fn();
      }),
      setModelConfig: vi.fn(async () => true),
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "hermesAPI");
});
describe("Mithril model picker", () => {
  it("ignores old providers and shows only the authoritative Mithril catalog", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Mithril Agent"),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Legacy Codex");
    expect(screen.getByRole("status")).toHaveTextContent("qwen/qwen3.8-27b");
  });
  it("refreshes the catalog on library events and never persists on read", async () => {
    render(<Harness />);
    catalog.models = ["mithril/new-model"];
    await act(async () => changed());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("mithril/new-model"),
    );
    expect(window.hermesAPI.setModelConfig).not.toHaveBeenCalled();
  });
  it("refuses a session-only foreign provider without changing state or sending IPC", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Mithril Agent"),
    );
    await expect(
      select("openai", "gpt-5.5", "", { persist: false }),
    ).rejects.toThrow("only Mithril Agent");
    expect(window.hermesAPI.setModelConfig).not.toHaveBeenCalled();
  });
});
