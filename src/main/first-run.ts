// @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
import type { MithrilFirstRunState } from "../shared/account";
import { readMithrilToken } from "./mithril-token-store";

/** Local-only: never touches the network, so an offline launch is not blocked. */
export function mithrilFirstRunState(profile?: string): MithrilFirstRunState {
  return { connected: readMithrilToken(profile) !== null };
}
