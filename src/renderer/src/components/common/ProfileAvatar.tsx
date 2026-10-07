import {
  DesktopProfileAvatar,
  type ProfileAvatarProps,
} from "@mithril/workspace/profile-avatar";
import HermesLogo from "./HermesLogo";
export default function ProfileAvatar(
  props: Omit<ProfileAvatarProps, "Logo">,
): React.JSX.Element {
  return <DesktopProfileAvatar {...props} Logo={HermesLogo} />;
}
