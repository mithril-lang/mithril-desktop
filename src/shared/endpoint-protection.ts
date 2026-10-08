export interface EndpointAlert {
  id: string;
  time: string;
  rule: string;
  severity: "medium" | "high";
  subject: string;
}
export interface EndpointConnection {
  pid: number | null;
  process: string;
  local: string;
  remote: string;
  state: string;
}
export interface EndpointStatus {
  enabled: boolean;
  running: boolean;
  folders: string[];
  definitions: {
    version: number;
    source: "bundled" | "signed-update";
    expires: string | null;
  };
  lastPoll: string | null;
  lastUpdate: string | null;
  scannedFiles: number;
  connections: EndpointConnection[];
  alerts: EndpointAlert[];
  gaps: string[];
  updateError: string | null;
}
export interface EndpointAPI {
  status(): Promise<EndpointStatus>;
  setEnabled(enabled: boolean): Promise<EndpointStatus>;
  chooseFolder(): Promise<EndpointStatus>;
  removeFolder(folder: string): Promise<EndpointStatus>;
  scanFile(): Promise<EndpointStatus>;
  updateDefinitions(): Promise<EndpointStatus>;
}
