import { useState } from "react";
import { createRoot } from "react-dom/client";
import CloudWorkspace from "../../src/renderer/src/screens/CloudWorkspace/CloudWorkspace";
import { ThemeProvider } from "../../src/renderer/src/components/ThemeProvider";
import { FontProvider } from "../../src/renderer/src/components/FontProvider";
import { ChatPreferencesProvider } from "../../src/renderer/src/components/ChatPreferencesProvider";
import { I18nContext } from "../../src/renderer/src/components/I18nContext";
function QAProjects(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <nav>
        <button onClick={() => setOpen(false)}>Close page</button>
        <button onClick={() => setOpen(true)}>Open Projects</button>
      </nav>
      {open && (
        <CloudWorkspace
          profile="default"
          initialView="projects"
          locale="ja"
          embedded
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <FontProvider>
      <ChatPreferencesProvider>
        <I18nContext.Provider value={{ locale: "ja", setLocale: () => {} }}>
          <QAProjects />
        </I18nContext.Provider>
      </ChatPreferencesProvider>
    </FontProvider>
  </ThemeProvider>,
);
