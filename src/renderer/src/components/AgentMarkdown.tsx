import { memo } from "react";
import { AgentMarkdown as SharedMarkdown } from "@mithril/design-system/react";
import { useI18n } from "./useI18n";
import { MediaImage, DownloadChip } from "./MediaImage";
import { describeImageSrc } from "../screens/Chat/mediaUtils";

/** Desktop policy: native clipboard, in-app web preview and local media. */
export const AgentMarkdown = memo(function AgentMarkdown({
  children,
}: {
  children: string;
}) {
  const { t } = useI18n();
  return (
    <SharedMarkdown
      platform={{
        copyText: (text) => window.hermesAPI.copyToClipboard(text),
        openLink: (href) => {
          const url = new URL(href, "https://placeholder.invalid");
          if (url.protocol === "http:" || url.protocol === "https:") {
            document.dispatchEvent(
              new CustomEvent("web-preview:navigate", { detail: href }),
            );
          } else void window.hermesAPI.openExternal(href);
        },
        renderImage: (src) => {
          const token = describeImageSrc(src);
          return token.isImage ? (
            <MediaImage token={token} />
          ) : (
            <DownloadChip token={token} />
          );
        },
        labels: {
          copy: t("chat.copyMessage"),
          copied: t("common.copied"),
          showMore: t("common.showMore"),
          showLess: t("common.showLess"),
        },
      }}
    >
      {children}
    </SharedMarkdown>
  );
});
export default AgentMarkdown;
