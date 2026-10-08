# Tool settings

Tool selection belongs to the selected connection and one profile. It describes configuration, not verified tool execution or permission to use a provider.

## Remote settings isolation

Direct HTTP settings use the remote dashboard's profile-scoped read and per-name mutation APIs. An unsupported or unavailable remote fails visibly; it never reads or writes local configuration.

[[src/main/tool-settings.ts#getSelectedToolsets]] preserves dynamic names, platform, configured status and concrete tool names. Explicit default profile scoping avoids the dashboard's sticky active profile. [[src/main/tool-settings.ts#setSelectedToolsetEnabled]] requires an acknowledgement matching the operation name and enabled value. Provider post-setup can still be asynchronous; this acknowledgement does not establish runtime readiness.

Local and SSH settings retain their own adapters. IPC routes both read and write through this owner boundary; secrets stay in the main-process dashboard transport, including OAuth cookie authentication.

## Connection changes during requests

A request captures its connection and profile before dispatch. Responses are rejected when the active connection, credentials or implicit active profile change during the request.

A submitted mutation may already have completed on the original target. The adapter never retries it automatically, and asks for a refresh of that target. Tests cover changed connection, credentials and profile, malformed metadata, unsupported endpoints and mismatched acknowledgements.
