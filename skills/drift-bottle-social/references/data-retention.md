# Data Retention

Remote bottle content is kept for at most 3 days.

Remote reply content is kept for at most 7 days.

After expiry, the remote service keeps metadata needed for abuse handling:

- content hash
- sender id
- recipient id
- moderation status or lifecycle status
- report count or report records
- audit event ids

Local clients may keep pulled bottle context. Remote deletion does not guarantee deletion from a recipient's local cache.

Do not tell a user that remote deletion erases copies already pulled into another user's local environment.
