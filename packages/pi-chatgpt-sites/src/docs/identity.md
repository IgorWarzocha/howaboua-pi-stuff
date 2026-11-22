# Identity and service access

Preserve Sites-managed authentication. Trust forwarded identity only at the hosted server boundary. Use `oai-authenticated-user-id` as a stable ID within that Site and `oai-authenticated-user-email` for verified email. An optional `oai-authenticated-user-full-name` is display data. Decode it only when the paired `oai-authenticated-user-full-name-encoding` header is `percent-encoded-utf-8`. Public Sites can receive anonymous requests. Authorise protected reads and writes server-side. Sign-in alone does not prove workspace membership.

Use existing framework auth helpers. Sign-in and sign-out use top-level navigation to platform-managed `/signin-with-chatgpt` and `/signout-with-chatgpt`. Keep return paths same-origin and relative. Do not implement those routes or `/callback`, prefetch sign-in links, or cache identity-dependent pages as public output.

Site service access uses a Site-specific `OAI-Sites-Authorization` bearer header. It authenticates a service to that Site; it does not provide a visitor identity or consent to access connected apps. Preserve authorisation for user-owned records. Public write endpoints need their own authorisation. Pi redacts the service credential and does not provision one. Do not rotate credentials or widen access to test a connection.

Set hosted secrets in the Site's Environment variables settings. Keep local values untracked and commit only names in `.env.example`. See `environment` for runtime revisions.
