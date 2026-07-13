# ADR-0006: Localhost Actor Boundary and Human Confirmation

- Status: Accepted
- Date: 2026-07-14
- Goals: DF-G7, DF-G10, DF-G11

## Context

Last Say is a localhost single-user app without authentication. A request field
such as `actor_type=human` proves nothing. High-impact operations still need a
workflow guard so normal AI operators cannot accidentally cross human-only
boundaries.

## Decision

High-risk actions use a registry-specific pending proposal and one-time human
confirmation receipt:

1. Server creates a proposal with action kind, typed resource, canonical
   payload/impact hash, expected resource version, expiry, and random secret
   hash.
2. Only the browser confirmation flow can confirm the proposal and receive the
   short-lived opaque receipt. The secret/receipt is never returned by
   capabilities, Skill examples, general reads, logs, or AI preview responses.
3. Commit validates registered action, confirmed status, expiry, unused state,
   constant-time secret hash, exact payload/impact hash, and exact version in
   one transaction; success marks it consumed and appends audit evidence.
4. Receipt lifetime defaults to 10 minutes and is one-time. Replay, expiry,
   payload/version change, unknown action, or plain `actor_type=human` fails
   closed with a stable error.

Initial high-risk registry includes `declared_complete`, typed identity merge,
committed-run reversal, and active DB replacement. Restore itself remains a
local CLI operation; active replacement also requires stopped service and
explicit operator flags.

Browser flow uses same-origin/SameSite protections and no receipt in URLs.
Optimistic version remains mandatory; confirmation does not waive conflicts.

## Threat Boundary

This is workflow protection, **not user authentication** and not a defense
against malicious local processes. Code that can read browser state, process
memory, or local files is outside this phase's threat model. Documentation must
not claim otherwise.

## Verification

Phase 1 tests must reject actor-label spoofing, unconfirmed proposal, replay,
expiry, changed payload, changed expected version, unknown action, and
concurrent consumption. They must prove successful consumption + audit is
atomic.
