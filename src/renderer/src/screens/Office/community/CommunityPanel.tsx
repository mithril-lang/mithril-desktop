import { useEffect, useRef, useState } from "react";
import { Globe, LogOut, Send, Settings, Users, X } from "lucide-react";
import { useI18n } from "../../../components/useI18n";
import type { CommunityApi } from "./useCommunity";
import type { CommunitySettings } from "./useCommunitySettings";
import { normalizeRelayUrl } from "./protocol";
import { COMMUNITY_ROOMS, MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH } from "./types";

interface CommunityPanelProps {
  open: boolean;
  onClose: () => void;
  settings: CommunitySettings;
  api: CommunityApi;
}

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Community: the convention center's shared chat. Rooms map to halls of the
 * building; the member list is whoever is present on the same relay. The
 * connection itself lives in Office (so avatars show with the panel closed).
 */
export default function CommunityPanel({
  open,
  onClose,
  settings,
  api,
}: CommunityPanelProps): React.JSX.Element | null {
  const { t } = useI18n();
  const { name, relayUrl, roomId, joined } = settings;
  const [nameDraft, setNameDraft] = useState(name);
  const [relayDraft, setRelayDraft] = useState(relayUrl ?? "");
  const [relayError, setRelayError] = useState(false);
  const [showSettings, setShowSettings] = useState(!name);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const { state, selfId, messages, peers, send } = api;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const saveSettings = (): void => {
    const nextName = nameDraft.trim().slice(0, MAX_NAME_LENGTH);
    const nextRelay = relayDraft.trim() ? normalizeRelayUrl(relayDraft) : null;
    if (relayDraft.trim() && !nextRelay) {
      setRelayError(true);
      return;
    }
    setRelayError(false);
    if (!nextName) return;
    settings.setIdentity(nextName, nextRelay);
    setShowSettings(false);
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (send(draft)) setDraft("");
  };

  const room =
    COMMUNITY_ROOMS.find((r) => r.id === roomId) ?? COMMUNITY_ROOMS[0];
  const stateColor =
    state === "online"
      ? "#22c55e"
      : state === "connecting"
        ? "#f59e0b"
        : "#ef4444";

  return (
    <aside
      role="dialog"
      aria-label={t("office.community")}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        maxWidth: "100%",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        background: "var(--card, rgba(20,24,33,0.97))",
        color: "#fff",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "-12px 0 32px rgba(0,0,0,0.28)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Globe size={18} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {t("office.community")}
          </div>
          <div
            style={{
              fontSize: 11,
              opacity: 0.7,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                background: stateColor,
              }}
            />
            {t(`office.communityState_${state}`)}
            {" · "}
            {relayUrl
              ? t("office.communityRelay")
              : t("office.communityLocalOnly")}
          </div>
        </div>
        {joined && (
          <button
            type="button"
            onClick={() => settings.setJoined(false)}
            title={t("office.communityLeave")}
            aria-label={t("office.communityLeave")}
            style={iconButton}
          >
            <LogOut size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          title={t("office.communitySettings")}
          aria-label={t("office.communitySettings")}
          style={iconButton}
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("office.close")}
          aria-label={t("office.close")}
          style={iconButton}
        >
          <X size={16} />
        </button>
      </header>

      {showSettings && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 16,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {t("office.communityDisplayName")}
            <input
              value={nameDraft}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setNameDraft(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {t("office.communityRelayUrl")}
            <input
              value={relayDraft}
              placeholder="wss://…"
              spellCheck={false}
              onChange={(e) => setRelayDraft(e.target.value)}
              style={inputStyle}
            />
          </label>
          {relayError && (
            <span style={{ color: "#f87171" }}>
              {t("office.communityRelayInvalid")}
            </span>
          )}
          <button
            type="button"
            onClick={saveSettings}
            disabled={!nameDraft.trim()}
            style={{ ...primaryButton, opacity: nameDraft.trim() ? 1 : 0.5 }}
          >
            {t("office.communitySave")}
          </button>
        </div>
      )}

      <nav
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 16px",
          flexWrap: "wrap",
        }}
      >
        {COMMUNITY_ROOMS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => {
              settings.setRoomId(r.id);
            }}
            style={{
              ...chip,
              background: r.id === roomId ? "#fff" : "rgba(255,255,255,0.08)",
              color: r.id === roomId ? "#000" : "#fff",
            }}
          >
            {t(`office.communityRoom_${r.id}`, { defaultValue: r.label })}
          </button>
        ))}
      </nav>

      <div
        style={{
          padding: "0 16px 8px",
          fontSize: 11,
          opacity: 0.75,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Users size={12} aria-hidden="true" />
        {t("office.communityOnline", { count: peers.length })}
        {peers.length > 0 && (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {": "}
            {peers
              .map((p) =>
                p.id === selfId
                  ? `${p.name} (${t("office.communityYou")})`
                  : p.name,
              )
              .join(", ")}
          </span>
        )}
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ opacity: 0.6, fontSize: 13, marginTop: 8 }}>
            {name
              ? t("office.communityEmpty", {
                  room: t(`office.communityRoom_${room.id}`, {
                    defaultValue: room.label,
                  }),
                })
              : t("office.communityNeedName")}
          </div>
        )}
        {messages.map((m) => {
          const mine = m.senderId === selfId;
          return (
            <div
              key={m.id}
              style={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "85%",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.6,
                  textAlign: mine ? "right" : "left",
                }}
              >
                {mine ? t("office.communityYou") : m.senderName} ·{" "}
                {formatTime(m.ts)}
              </div>
              {/* Plain text only: message bodies come from other users. */}
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.4,
                  background: mine ? "#2563eb" : "rgba(255,255,255,0.1)",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={submit}
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <input
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={!name || !joined}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("office.communityPlaceholder")}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="submit"
          disabled={!name || !draft.trim() || state !== "online"}
          aria-label={t("office.communitySend")}
          title={t("office.communitySend")}
          style={{
            ...primaryButton,
            width: 40,
            padding: 0,
            opacity: !name || !draft.trim() || state !== "online" ? 0.5 : 1,
          }}
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}

const iconButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 6,
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.75)",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  fontSize: 13,
  outline: "none",
};

const primaryButton: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const chip: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 999,
  border: "none",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
