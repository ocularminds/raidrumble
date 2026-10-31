# Twitch boundary

`HelixReader` performs GET requests only. `SubscriptionPlan` and `TwitchWrites`
return `{ method, path, body?, query? }` descriptors. Submit each descriptor to
`PolicyExecutor.executeHelix` after authorizing its action. No descriptors perform
network traffic themselves.

`EventSubClient` manages sockets and calls:

```ts
const events = new EventSubClient({
  onSession: async (sessionId, { reconnected }) => {
    if (reconnected) return; // Twitch transferred existing subscriptions.
    // Authorize events.subscribe, then execute each descriptor through policy.
    const plan = SubscriptionPlan.host(sessionId, hostId, botId);
  },
  onNotification: async (event) => {
    // Discriminated union: raid, chat, shared, redemption.
    // Chat text and ungated display names stay on the server.
  },
  onRevocation: (subscription) => {
    // Surface missing authorization to the dashboard; do not silently resubscribe.
  },
  onError: (error) => {
    // Report a transport failure without ending the active match.
  },
});
events.start();
// Call events.stop() during server shutdown.
```

A cold connection receives `reconnected: false` and requires subscriptions within
Twitch's welcome deadline. A server-directed migration keeps the old socket open
until the new welcome arrives and reports `reconnected: true`. Keepalive expiry,
unexpected close, and welcome expiry retry with bounded exponential delay.
Notifications are deduplicated across connection migrations for ten minutes,
with a 10,000-ID memory cap. The optional `url` supports a local Twitch CLI mock;
server-supplied reconnect URLs must have the same origin as the configured URL.

Subscriptions use WebSocket user access tokens. Register chat with the bot token
and broadcaster/user conditions; register broadcaster-only subscriptions with
the broadcaster's token where Twitch requires it. `channel:bot` permission on
its own is not a replacement for the bot's chat scopes. Optional reward
subscriptions require the broadcaster's `channel:read:redemptions` or
`channel:manage:redemptions` authorization.

`OAuthStateStore.issue` binds a random state to an opaque browser cookie, role,
and optional expected Twitch ID. The callback must consume that state with the
same browser ID, then use `OAuthClient.exchange` and `validate`. Check
`expectedUserId` against the validated identity before accepting a Warlord login.
Store tokens only on the server. `TokenSession.accessToken()` coalesces concurrent
refreshes; use its latest snapshot when persistence is explicitly configured.
The app should validate tokens at startup and hourly, as Twitch requires.

The transport is covered with local mocked tests. Live account authorization,
scope grants, and subscription delivery require verification on real channels.

API references consulted during implementation:

- [EventSub WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Subscription types and conditions](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)
- [Twitch API reference](https://dev.twitch.tv/docs/api/reference/)
- [OAuth authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- [Token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/)
