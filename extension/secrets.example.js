// Copy to secrets.js (or run `bun run scripts/secrets.ts`). Gmail access is downscoped to read-only.
export default {
  google: { client_id: "", client_secret: "", refresh_token: "", token_uri: "https://oauth2.googleapis.com/token" },
  jevKey: "",
  openaiKey: "", // optional: sort ideas written for your inbox
};
