# Assign an escalation

You can ask another moderator to review an ambiguous case by assigning an
escalation, or transfer an existing escalation to a different moderator. An
escalation is a hold that blocks publication until a moderator releases it.
Assigning or transferring it records your reason and keeps the hold active.

## Before you begin

You need a signed-in account with active moderator access and access to the
**Moderation review** screen at your site’s address followed by `/moderation`.
If you cannot access the screen, ask the site
operator to check your access and whether moderation review is available.

The **Moderator** list shows account identifiers rather than names. Your own
identifier has **(you)** beside it. You should confirm the intended person's
identifier with them through your team's private communication channel before
selecting it; do not guess which person an identifier represents. A listed
account does not confirm that its owner can sign in or has received a notice.

You should keep contact details and submitted content out of **Reason**.
The recorded reason is part of the review history. A short explanation such as
“Second review needed for an ambiguous privacy concern” describes the purpose
without copying private content.

## Assign a new escalation

On the **Moderation review** screen, you should follow these steps:

1. Select **Review revision** for the revision you want to escalate.
2. In **Action**, select **Escalate for review**.
3. In **Moderator**, select the confirmed identifier of the moderator who should review the case.
4. Enter a brief explanation in **Reason**.
5. Select **Record action** and wait for “Action recorded. Reload the revision to see its current state.”
6. Select **Review revision** for the same revision again to check **Active holds**.

The new escalation appears with its reason and owner identifier. The hold
blocks publication; assignment does not approve or reject the submission.
You should contact the selected moderator through your team's private channel
to arrange the review; the action does not confirm notification delivery.

## Transfer an escalation

A transfer changes the owner of an existing escalation and keeps its hold
active. On the **Moderation review** screen, you should follow these steps:

1. Select **Review revision** for the revision with the escalation.
2. In **Action**, select **Transfer an escalation**.
3. In **Escalation to transfer**, select the existing escalation by its reason.
4. In **Moderator**, select the confirmed identifier of the new owner.
5. Enter the reason for the handoff in **Reason**.
6. Select **Record action** and wait for the action-recorded message.
7. Select **Review revision** for the same revision again to check **Active holds**.

The escalation shows the new owner and an increased sequence number, which
counts changes to its assignment. You should coordinate the handoff privately
with the previous and new owners rather than assuming they received a notice.

## Recover when an action cannot be completed

You can use the message on the screen to choose the next step.

| What you see | What you can do |
| --- | --- |
| “Sign in with your moderator account to continue.” | Use **Sign in or manage your account**, sign in, and return to the review screen. |
| “Your account does not currently have moderator access.” | Ask the site operator to check your access before trying again. |
| “This review changed. Reload it before deciding what to do next.” | Select **Refresh queue**, reopen the revision, and check its holds and owner before deciding whether another action is needed. |
| “This revision is no longer awaiting review.” | Select **Refresh queue** and check the remaining pending revisions. |
| No moderator or escalation is available to select | Reopen the revision and select the action again; if the expected choice is still missing, ask the site operator to check it. |
| “Enter a reason of at most 1,000 bytes.” | Shorten the reason; some characters take more than one byte, so fewer than 1,000 characters may be needed. |
| “Review is unavailable. Try again later.” | Wait, then reopen the revision and inspect its current holds before retrying; an interrupted response does not establish whether an action was recorded. |

You should use your team's approved escalation contact and procedure for an
emergency or credible threat. This screen does not provide emergency response
or real-time monitoring. Media review is unavailable here, so this screen does
not offer approval or rejection.
