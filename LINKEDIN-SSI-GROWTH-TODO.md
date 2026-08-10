# LinkedIn SSI Growth Assistant - Business Implementation Summary

## Summary

We are building a LinkedIn SSI growth assistant based on the provided guide. This document describes the business implementation: what features the product should support, what should run through Unipile API, what requires human-in-the-loop review, and what risks need attention. It is not a ready technical architecture.

The guide is the behavioral source of truth. The system should support profile improvement, content publishing, meaningful comments, reactions, saves, network growth, replies, and weekly review. It should help operators follow that process without turning it into a generic autonomous engagement bot.

LinkedIn actions should be executed through Unipile API only. Dolphin/browser automation should not be used for LinkedIn actions. Existing infrastructure can still help with account records, scheduling, queues, logs, text generation, approvals, and metrics tracking.

## API Coverage

Use Unipile for LinkedIn actions where API coverage exists:

- LinkedIn account connection and status.
- Reading profiles, own posts, comments, replies, and reactions.
- Creating posts and reposts.
- Commenting and replying.
- Reacting to posts and comments.
- Searching or fetching candidate posts.
- Sending messages and invitations.
- Detecting accepted invitations.
- Editing the user's own LinkedIn profile where supported.

Profile editing note:

- Unipile appears to support editing the authenticated user's own profile, but each field should be validated in practice before relying on it.
- Official public LinkedIn API does not generally allow normal apps to edit a user's profile.
- Official LinkedIn profile-edit APIs exist only in restricted or partner-gated contexts.

## Autonomous API Actions

The system can do these tasks autonomously when bounded by guide-based limits and account-health rules:

- Fetch LinkedIn account state.
- Fetch own posts and incoming comments.
- Fetch candidate posts from feed, search, user, or company sources.
- Deduplicate seen posts, authors, comments, and contacts.
- Track engagement history.
- Track weekly guide progress.
- Draft suggested comments, replies, posts, and profile updates for review.
- Execute already-approved actions through Unipile.
- Collect available metrics.
- Run profile-readiness checks against the guide.

## Engagement Actions From The Guide

The product should support these guide-aligned action categories:

- Publish original text posts.
- Publish or prepare PDF/carousel-style content.
- Repost with a personal opinion or added context.
- Comment on relevant professional posts.
- Reply to comments on our own posts.
- React to relevant posts and comments.
- Save useful posts into a topic/content bank.
- Follow relevant specialists, recruiters, companies, and technical voices.
- Grow the network with relevant recruiters, engineers, hiring managers, and people connected to target topics.
- Review performance and adjust the next content and engagement direction.

## HITL Actions

Human approval is required for reputation-sensitive or quality-sensitive decisions:

- Final approval before publishing posts.
- Final approval before profile edits.
- Approving or editing generated comments.
- Approving replies to comments on our own posts.
- Choosing whether a candidate post deserves a comment, reaction, save, or skip.
- Reviewing generated content plans.
- Reviewing weekly metrics and choosing the next business direction.
- Handling warnings, disconnects, checkpoints, suspicious states, or unusual Unipile failures.

## Connection Growth Resolver

Adding connections should not require manual approval for every single candidate. Instead, build a specific connection resolver task that decides whether a candidate is relevant enough to create an invitation task.

The resolver should select candidates according to the guide's logic:

- Recruiters relevant to location, market, stack, or hiring area.
- Talent acquisition profiles connected to target roles.
- Engineers from target companies or similar technical areas.
- People who posted or commented on relevant topics.
- People with a concrete reason for contact: shared topic, post, technology, role, event, or mutual context.

The resolver should reject weak candidates:

- No clear professional relevance.
- Too distant from the target stack or market.
- Repeated same-company over-selection.
- Already contacted.
- Low-quality or suspicious profiles.
- No concrete reason for connection.

The resolver can create approved connection tasks automatically when confidence is high. Lower-confidence candidates should go to HITL review.

## Main Problems

- Unipile profile editing needs real field-by-field validation.
- Some LinkedIn actions may be available only through brittle routes instead of clean first-class endpoints.
- Saves, SSI, and some metrics may not have full API coverage.
- The current system does not yet have LinkedIn-specific budgets, cooldowns, account health state, or kill switches.
- Connection requests are sensitive and need careful resolver rules.
- Generic comments or repetitive timing can make even low-volume activity look bad.
- SSI should guide business decisions, not force extra volume.
