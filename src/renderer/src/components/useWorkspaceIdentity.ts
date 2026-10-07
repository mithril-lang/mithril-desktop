import { useCallback, useEffect, useRef, useState } from "react";

/** Validate canonical identity without upgrading existing authorization grants. */
export function useWorkspaceIdentity(scope: string): {
  owner: string | null;
  error: string;
  signedOut: boolean;
  checking: boolean;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState({
    owner: null as string | null,
    error: "",
    signedOut: false,
    checking: true,
  });
  const generation = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const captured = ++generation.current;
    setState({ owner: null, error: "", signedOut: false, checking: true });
    try {
      let status = await window.hermesAPI.cloudWorkspace.status();
      if (captured !== generation.current) return;
      if (status.userId && !status.enabled) {
        status = await window.hermesAPI.cloudWorkspace.enable();
        if (captured !== generation.current) return;
      }
      if (status.userId && !status.enabled)
        throw Error("Workspace connection unavailable");
      setState({
        owner: status.userId,
        error: "",
        signedOut: !status.userId,
        checking: false,
      });
    } catch (error) {
      if (captured === generation.current)
        setState({
          owner: null,
          error:
            error instanceof Error
              ? error.message
              : "Workspace connection unavailable",
          signedOut: false,
          checking: false,
        });
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = window.hermesAPI.onCloudWorkspaceAccountChanged?.(
      () => {
        void refresh();
      },
    );
    return () => {
      invalidate();
      unsubscribe?.();
    };
  }, [refresh, invalidate, scope]);
  return { ...state, refresh };
}
