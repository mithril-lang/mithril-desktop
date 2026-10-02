import { useEffect, useState } from "react";
import { useI18n } from "../../components/useI18n";

interface MemoryProfileProps {
  content: string;
  expected: { memory: string; user: string };
  charLimit: number;
  profile?: string;
  onRefresh: () => void;
}

export function MemoryProfile({
  content: initialContent,
  expected,
  charLimit,
  profile,
  onRefresh,
}: MemoryProfileProps): React.JSX.Element {
  const { t } = useI18n();
  const [editBase, setEditBase] = useState(expected);
  const [userContent, setUserContent] = useState(initialContent);
  const [userEditing, setUserEditing] = useState(false);
  const [userSaved, setUserSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!userEditing) {
      setUserContent(initialContent);
      setEditBase(expected);
    }
  }, [initialContent, expected, userEditing]);

  async function handleSave(): Promise<void> {
    setError("");
    const result = await window.hermesAPI.writeUserProfile(
      userContent,
      profile,
      editBase,
    );
    if (result.success) {
      setUserEditing(false);
      setUserSaved(true);
      setTimeout(() => setUserSaved(false), 2000);
      onRefresh();
    } else {
      setError(result.error || t("memory.saveFailed"));
    }
  }

  return (
    <div className="memory-profile">
      <div className="memory-profile-header">
        <span className="memory-profile-hint">
          {t("memory.userProfileHint")}
        </span>
        {userSaved && (
          <span
            style={{
              color: "var(--success)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t("common.saved")}
          </span>
        )}
      </div>

      {error && (
        <div className="memory-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <textarea
        className="memory-profile-textarea"
        value={userContent}
        onChange={(e) => {
          if (!userEditing) setEditBase(expected);
          setUserContent(e.target.value);
          setUserEditing(true);
        }}
        placeholder={t("memory.userProfilePlaceholder")}
        rows={8}
      />
      <div className="memory-profile-footer">
        <span className="memory-entry-chars">
          {t("memory.chars", { count: userContent.length })} / {charLimit}{" "}
          {t("memory.chars", { count: 1 }).split(" ")[1]}
        </span>
        {userEditing && (
          <button className="btn btn-primary btn-sm" onClick={handleSave}>
            {t("memory.saveProfile")}
          </button>
        )}
      </div>
    </div>
  );
}
