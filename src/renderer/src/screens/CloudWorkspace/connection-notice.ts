/** Scoped authorization is distinct from account sign-in and network recovery. */
export function connectionNotice(
  error: unknown,
  locale: string,
): { message: string; action: string; retry: boolean } {
  const message = error instanceof Error ? error.message : "";
  const ja = locale.startsWith("ja");
  if (/Cloud connection requires explicit/.test(message))
    return {
      message: ja
        ? "サインイン済みです。Chat・Workspace の利用をパスキーで承認してください。"
        : "You are signed in. Approve Chat and Workspace access with your passkey.",
      action: ja ? "アクセスを承認" : "Approve access",
      retry: false,
    };
  if (
    /Sign in to your Mithril account first|sign.in expired|access refused/i.test(
      message,
    )
  )
    return {
      message: ja
        ? "Mithril の接続を確認してください。"
        : "Check your Mithril account connection.",
      action: ja ? "接続を確認" : "Check connection",
      retry: false,
    };
  return {
    message: ja
      ? "接続できません。もう一度お試しください。"
      : "Connection unavailable. Try again.",
    action: ja ? "再試行" : "Retry connection",
    retry: true,
  };
}
