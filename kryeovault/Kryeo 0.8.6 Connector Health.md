# Kryeo 0.8.6 Connector Health

- Treat failed or timed-out MCP requests as a lost Affinity connection.
- Release the stale transport immediately after a connector failure.
- Poll the current connector state in the desktop UI so transport disconnect events are reflected while a workflow is running.
- Clear stale workflow data and disable workflow cards when Affinity is offline.
