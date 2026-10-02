import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Providers from "./Providers";
const select = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ locale: "ja" }),
}));
vi.mock("../../components/MithrilAccountSection", () => ({
  default: () => <div>Mithril account fixture</div>,
}));
vi.mock("../Chat/hooks/useModelConfig", () => ({
  useModelConfig: () => ({
    currentModel: "mithril/a",
    displayModel: "a",
    reload: vi.fn(),
    selectModel: select,
    modelGroups: [
      {
        provider: "mithril",
        models: [
          { model: "mithril/a", label: "A" },
          { model: "mithril/b", label: "B" },
        ],
      },
    ],
  }),
}));
afterEach(() => {
  cleanup();
  select.mockClear();
});
describe("Mithril Agent settings", () => {
  it("offers account and Mithril models without provider/key/custom/OAuth controls or writes on visit", async () => {
    render(<Providers visible profile="work" />);
    expect(screen.getByRole("heading", { name: "Mithril Agent" })).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getAllByRole("option").map((e) => e.textContent)).toEqual([
      "A",
      "B",
    ]);
    expect(screen.queryByText("OpenRouter")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(select).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "mithril/b" },
    });
    await waitFor(() =>
      expect(select).toHaveBeenCalledWith(
        "mithril",
        "mithril/b",
        "https://api.mithril.fund/v1",
      ),
    );
  });
});
