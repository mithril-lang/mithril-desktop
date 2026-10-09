import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatGatewayConnection } from "./ChatGatewayConnection";
const read = vi.fn(),
  review = vi.fn();
beforeEach(() => {
  read.mockReset();
  review.mockReset();
  review.mockResolvedValue(undefined);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      cloudChat: { gatewaySelection: read, reviewGateway: review },
    },
  });
});
afterEach(cleanup);
const props = {
  userId: "owner",
  profile: "default",
  sessionId: "s1",
  locale: "en",
};
// @lat: [[mithril-code#Mithril Code#Native tool connection consumer]]
it("reads owned selection and opens Web review only after the person's click", async () => {
  read.mockResolvedValue({
    userId: "owner",
    sessionId: "s1",
    binding: { storedSessionId: "stored", revision: 1, active: true },
  });
  render(<ChatGatewayConnection {...props} />);
  await screen.findByText("A Hermes conversation is selected.");
  expect(read).toHaveBeenCalledExactlyOnceWith({
    userId: "owner",
    profile: "default",
    sessionId: "s1",
  });
  expect(review).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review tool connection in browser" }),
  );
  expect(review).toHaveBeenCalledExactlyOnceWith({
    userId: "owner",
    profile: "default",
    sessionId: "s1",
  });
});
// @lat: [[mithril-code#Mithril Code#Native tool connection consumer isolation]]
it("discards old conversation metadata after selection changes and refuses mismatched ownership", async () => {
  let resolve!: (value: unknown) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<ChatGatewayConnection {...props} />);
  read.mockResolvedValue({ userId: "owner", sessionId: "s2", binding: null });
  view.rerender(<ChatGatewayConnection {...props} sessionId="s2" />);
  await screen.findByText("No Hermes conversation is selected.");
  resolve({ userId: "owner", sessionId: "s1", binding: { active: true } });
  await Promise.resolve();
  expect(screen.queryByText("A Hermes conversation is selected.")).toBeNull();
  read.mockResolvedValue({
    userId: "foreign",
    sessionId: "s3",
    binding: { active: true },
  });
  view.rerender(<ChatGatewayConnection {...props} sessionId="s3" />);
  await screen.findByText("Tool connection could not be checked.");
  expect(screen.queryByText("A Hermes conversation is selected.")).toBeNull();
  expect(review).not.toHaveBeenCalled();
});
