# The transaction review page — agreed specification

Settled with the founder on 2026-09-14 in a structured design session. This document is the
reference for every future change to `/expenses` (the Transactions page) and the review feed
inside it. **Where this document and the current code disagree, this document is the
intent and the code is the gap.**

The session was called because the page had drifted: features had been added one request at
a time, to whichever part of the screen the founder happened to be pointing at. The result
was two lists that looked identical and behaved differently. Nothing below is a new idea —
it is the model the page was always reaching for, written down so it stops being
re-litigated one message at a time.

---

## 1. The model

**This page is an inbox.** You come here because transactions need your answer, you answer
them, the queue reaches zero, and you leave. It is not a ledger you browse. Browsing exists,
but behind the queue, not beside it.

**The unit of decision is the merchant.** Grouping is what makes a backlog of 200
transactions clearable at all — one answer covers eighteen Walgreens trips. But **every
group opens**, because exceptions are real: airfare is not normally healthcare, but one
flight was for surgery.

**We ask about intent, not tax law.** The user knows what they bought; they do not know
Publication 502. Whether a purchase actually qualifies is judged later, by the eligibility
engine and by substantiation. This page only asks which pile it goes in.

**Nothing interrupts the emptying.** The queue's job is to reach zero in one sitting. Every
follow-on offer — attach a receipt, make a rule — is an offer, never a gate.

---

## 2. Decisions

### 2.1 Structure

| #   | Decision                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The page is an inbox. The queue is the page's purpose; browsing is secondary.                                                                               |
| D2  | The three browse tabs (All / Medical / Non-Medical) collapse into **one** All-transactions list with named views.                                           |
| D3  | The "might contain over-the-counter items" lane stays on this page, **collapsed by default** behind a single summary line. It is not moved to its own page. |
| D4  | Duplicate-charge warnings become the **first group inside the queue** and count toward the queue total — not a banner floating above it.                    |

**On D3.** The two lanes are different kinds of work. The medical lane is a handful of
merchants you recognise instantly. The OTC lane is potentially forty grocery and big-box
trips, none answerable without remembering a nine-month-old shopping basket. Stacked openly,
the tedious maybes outnumber the real decisions on screen. Moved to its own page, nobody
ever does them — and that lane is where the genuinely surprising money hides.

**On D4.** A queue that reads "nothing to review" while a duplicate warning sits above it
demanding an answer is lying about being empty. If it needs your answer, it is inbox work and
it counts as inbox work. Keeping it first preserves the priority (a duplicate is money
already at risk; an unreviewed transaction is only money not yet found) without breaking the
promise that zero means done.

### 2.2 The decision itself

| #   | Decision                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D5  | Every group opens, **in both lanes**, with the same controls inside. The current asymmetry is the drift.                                      |
| D6  | **Split appears on every row, in both lanes.** A hospital bill with parking on it is the same shape of problem as a Walmart basket.           |
| D7  | The word **"medical" is retired from user-facing copy** in favour of **"healthcare."**                                                        |
| D8  | Buttons are self-describing: **Healthcare / Not healthcare**, and at group level **All 18 are healthcare / None of these are**.               |
| D9  | The negative is a dismissal, not a verdict. Its confirmation reads _"Dismissed — we won't ask again"_, with a visible undo for a few seconds. |
| D10 | Queue order is **most money first**.                                                                                                          |

**On D7.** "Medical" sounds like a clinical or tax judgement the user is not qualified to
make. "Healthcare" is the same idea in a word nobody thinks they can get wrong.

**On D8.** Self-describing labels beat a question-in-the-header with Yes/No buttons, because
on the fortieth row of an open Costco group the header has scrolled off screen.

**On D10.** Most people will not finish this queue in one sitting. Whatever the ordering is,
it decides what got done before they stopped. Dollars-first means they captured the value
even if they abandon it halfway. The current ordering (most transactions first) optimises for
rows-cleared, a scoreboard number nobody wants.

### 2.3 What happens when a row is answered

| #   | Decision                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D11 | A decided row **leaves the open group**, fading over ~200ms rather than vanishing instantly — rows that snap away shift the next row under a moving cursor. |
| D12 | The group's bulk button **re-labels to what remains**: after pulling three exceptions out of eighteen it says "All 15 are healthcare," never "All 18."      |
| D13 | When the last row is answered, the **group disappears** — no empty shell reading "0 transactions."                                                          |
| D14 | **A split counts as deciding the row.** A split transaction leaves the group the same way, and its pieces do not re-enter the queue.                        |

The point of opening a group is to pull the exceptions out so the remainder becomes
answerable in one click. Rows that linger defeat that.

### 2.4 Receipts

| #   | Decision                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D15 | Confirming a transaction as healthcare **must not open a modal.** The offer is a **fading prompt at the bottom of the screen** carrying "Add a receipt." |
| D16 | For a **bulk** answer, the prompt scales: _"18 expenses need receipts"_, linking to the Substantiate page filtered to exactly those.                     |

**On D15.** A modal per confirmation was the right instinct for one transaction in isolation
and the wrong one for an inbox: forty transactions means forty interruptions, and the receipt
is almost never to hand — it is in an email or a drawer. But the moment where the receipt
_is_ open in another tab is real, and making the user find that expense again later is wasted
work. So: offer, don't gate.

**On D16.** One file does not substantiate eighteen separate charges, and the copy must not
imply it does.

### 2.5 Rules

| #   | Decision                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D17 | **The rule offered always follows the answer just given.** "All Walgreens is healthcare" offers _"Always treat Walgreens as healthcare."_ "None of these Costco trips had anything" offers _"Stop flagging Costco."_ |
| D18 | The rule prompt fires when **every transaction from that merchant has the same answer** — whether reached by one bulk click or by answering eighteen rows one at a time.                                             |
| D19 | A merchant with **one** transaction is fully answered by answering that transaction, so it gets a rule offer like any other. No special case.                                                                        |
| D20 | The rule prompt **leads with the forward promise** — _"From now on, charges from Advanced Dermatology are healthcare"_ — and mentions the backfill count only when there is one.                                     |
| D21 | Receipt and rule prompts may appear **side by side**. They rarely collide: the receipt offer follows one transaction, the rule offer follows a finished merchant.                                                    |
| D22 | Name matching gains three operators: **is exactly / starts with / contains.** When the app suggests a rule it defaults to **starts with** (today's behaviour).                                                       |
| D23 | A **contains** rule's preview shows up to five **actual merchant names it would catch**, not only a count.                                                                                                           |
| D24 | Rules live in **one** place — Settings — and that panel gains a **Create** action.                                                                                                                                   |
| D25 | When a user changes a decision that a **rule** made, the confirmation says so: _"A rule filed this one. Review it?"_ with a link.                                                                                    |

**On D17.** An earlier proposal offered rules only on whole-group answers and never in the
OTC lane. That was rejected, correctly: "rule here, no rule there" is a rule the _user_ has
to learn. Following-the-answer is consistent, the control is always present, and the
dangerous rule — _"every Costco trip is healthcare"_ — never appears anyway, because an OTC
group has no all-of-these-are-healthcare button in the first place. The model polices itself
without a special case.

**Superseded 2026-09-16.** The last sentence above was wrong on its own terms: a trip can be
entirely OTC medical items (a basket of only Tylenol and bandages), so withholding the
healthcare button there was itself the special case D17 says to avoid, not an avoidance of
one. The button is now offered in the OTC lane exactly as in the medical lane, bulk and solo
alike, and the "every Costco trip is healthcare" rule this paragraph called dangerous is
simply the rule that fires when the user has, in fact, said every Costco trip is healthcare —
same as it would for any other merchant. Left here for the record, not as current behavior.

**On D18.** Offering "always treat Walgreens as healthcare" while sixteen Walgreens rows sit
undecided two inches below is the app claiming to know something the user has not said. This
is a truthfulness constraint, not a safety veto — the button is always reachable, it just
waits until the merchant is actually finished.

**On D22.** Today there is one behaviour: a word-boundary prefix match on the normalized
name, so `walgreens` catches "walgreens store" but not "cvs walgreens". The normalizer
already strips processor prefixes and trailing store numbers, so `SQ *ADVANCED DERM 8827`
becomes `advanced derm` and ordinary payment plans already work. What prefix matching cannot
reach is **healthcare billing middlemen**, who put their own name first:
`ATHENAHEALTH*SMITH FAMILY MED`, `MEDICAL BILLING SVC - ADVANCED DERM`. The practice the user
recognises is buried mid-string. That is the case "contains" exists for.

**On D23.** _Contains: med_ matches Mediterranean Grill and Medina Bakery. A count cannot warn
you about that; a list of names can.

**On D24.** Where does someone go looking? When one transaction is filed wrong they fix the
transaction — they do not hunt for a rule. The trip to the rules list is the rarer, more
deliberate one: _what have I told this thing to do automatically?_ That is a Settings
question. D25 is the connective tissue, and is worth more than a second copy of the panel.

### 2.6 Already-decided transactions

| #   | Decision                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D26 | Decided transactions live in the **All-transactions** view on this page, not in a new nav destination.                                                             |
| D27 | That view offers **named views** in one control: _Everything · Healthcare · Filed automatically · Needs a receipt · Dismissed_, alongside search and a date range. |
| D28 | The "you're all done" screen carries a line: _"We also filed 1,840 charges as not healthcare. Worth a look?"_ linking to the **Filed automatically** view.         |
| D29 | That view is reachable **at all times**, not only by clearing the queue.                                                                                           |

**On D26.** The nav spine — Dashboard · Expenses · Substantiate · Reimburse — is four steps
that mean something in order. A browse view is not a fifth step and would dilute it. And the
moment you most need this list is ten seconds after dismissing something by mistake: one tab
away, not one page away.

**On D28.** Transactions that clearly are not healthcare are auto-filed and never reach the
queue. That is correct — nobody wants to be asked about Netflix. But on one real account the
classifier flagged **0 of 208**, and if nothing ever surfaces what was auto-dismissed, a miss
like that is invisible forever. One sentence, at the exact moment the user has attention
free, is the honest counterweight to a deliberately narrow classifier. A recurring nudge
would be nagging.

**D27 and D28 superseded 2026-09-17 — see §2.9.** Both were right about the symptom and wrong
about the cause. D27's five named views mixed two questions (what did we decide about this
charge, versus what is missing downstream) and left the app's own filing indistinguishable
from the user's; D28 tried to compensate with a sentence for a classifier that was silently
swallowing uncertainty, rather than stopping it from swallowing. §2.9 fixes the division of
labour instead, and the named views fall out of it. The paragraph above is kept as the record
of why a door onto the auto-filed pile has to exist at all — that argument survives intact,
and D44 is its new form.

### 2.7 Changing your mind, and submission

| #   | Decision                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- |
| D30 | Generating a reimbursement record is **a draft, not a commitment**. It does not lock the expenses inside it.     |
| D31 | A new state — **"sent to my custodian"** — is the real commitment, marked by the user, and _that_ is what locks. |
| D32 | Rebuilding a draft record is a **prominent one-click action**.                                                   |
| D33 | The word **"voided" never appears in user-facing copy.** It is "rebuild this record."                            |

**On D30–D31.** The app cannot observe whether someone actually mailed a claim to their HSA
custodian. Today, generating the PDF and sending it are the same state, and generating locks —
so the honest workflow of _generate → spot something indefensible → pull it → regenerate_ is
blocked by a lock that has not earned its authority yet.

The underlying machinery already exists and does not need rebuilding: records carry
`generated` / `reimbursed` / `voided`, items inherit the record's state, expenses are locked
while in any non-voided record, and voiding releases them
(`supabase/migrations/20260817140000_claim_lock_on_inclusion.sql`). What is missing is the
distinction between _made the PDF_ and _sent it_.

The sent flag earns its keep beyond the lock: **"money I'm waiting on"** is a different number
from **"money I could still claim,"** and the dashboard cannot tell them apart today.

### 2.8 Phone

| #   | Decision                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| D34 | At narrow widths a row shows **two buttons plus an overflow menu** — Healthcare / Not healthcare visible, Split behind "⋯". |
| D35 | **Swipe-to-triage is the right long-term gesture but is its own piece of work**, not part of this.                          |

Swipe (right for healthcare, left to dismiss, tap for detail) is what would make this feel
fast on a couch, which is where a queue like this actually gets worked. It is deferred because
it needs a coach mark to be discoverable and a keyboard equivalent to stay accessible — a
bigger build than it looks, and not a reason to leave buttons wrapping onto two lines in the
meantime.

### 2.9 What the engine decides on its own

Agreed 2026-09-17. Supersedes D27 and D28, and overrides §4's "any change to the classifier
itself" exclusion. The browse view was never really a browse-view problem: what it was
struggling to describe is the division of labour between the engine and the user, so that is
what gets decided here, and the views fall out of it.

| #   | Decision                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D36 | **The engine never files anything it is not confident about.** "No medical signal in the merchant name or category" is the absence of a judgment, not a judgment. It stops being a filing decision; those charges reach the queue.                        |
| D37 | **Confidence means Plaid's own confidence grade.** A charge may be auto-filed only at `HIGH` or `VERY_HIGH` personal-finance-category confidence. `LOW`, `MEDIUM` and uncategorized always reach the queue.                                               |
| D38 | **Four categories are never auto-filed at any confidence** — general merchandise, groceries, personal care, insurance — because each can hold a qualifying item.                                                                                          |
| D39 | **A dollar backstop overrides the category list.** Nothing above **~$200** is auto-filed, whatever its category or confidence.                                                                                                                            |
| D40 | **The classifier re-runs over transactions already imported** whenever its rules change, and on demand from Settings. It never touches a transaction a person or a rule decided, and it only ever **adds** to the queue — never silently removes from it. |
| D41 | **The queue keeps two lanes.** The second merges the basket cases and the unknowns under one heading — _"Worth a look"_ — each row carrying its own one-line reason.                                                                                      |
| D42 | **The All-transactions list has one narrowing control**: a Status filter carrying counts — _Healthcare · Not healthcare · Needs review · Filed automatically · Transfers_. "Dismissed" is retired as a label; it always meant "not healthcare".           |
| D43 | **"Healthcare" means confirmed.** A charge the engine suggested but nobody has approved appears under _Needs review_, never under _Healthcare_.                                                                                                           |
| D44 | **"Filed automatically" keeps a permanent door with a count on it.** That count replaces D28's one-time nudge line, which is dropped.                                                                                                                     |
| D45 | The All tab adds **group by** (none / merchant / month), **sort** (date / amount), **filter** (date / merchant / amount) and search. It lands **ungrouped, newest first**.                                                                                |
| D46 | **"Needs a receipt" leaves this page's filter.** It belongs to Substantiate, whose own queue is keyed on the same column.                                                                                                                                 |

**On D36.** Measured on a real account, 2026-09-17: **231 charges across 81 merchants**
carried `classification_reason = 'none'` — "no medical signal" — and were filed as
not-healthcare without ever being seen. One of those merchants was Paramount Accept, a
medical payment-plan servicer, invisible for nine months. The engine had nothing to say about
it and the app rendered that silence as a decision.

Note the asymmetry D36 preserves rather than invents: every tier that concludes a charge _is_
healthcare already sets `needsReview = true` and waits for approval
(`supabase/functions/_shared/medicalClassifier.ts`). The engine has only ever decided alone in
the negative direction. D36 narrows that to the cases where it can actually defend the answer.

**On D37–D39.** Plaid grades its own certainty and the app already stores it
(`transactions.pfc_confidence`), unused. On the same account ~139 of those 231 charges carried
`HIGH` or `VERY_HIGH`, and ~59 across 34 merchants carried `LOW` or nothing at all — so the
uncertainty signal was sitting in the database the whole time.

D38 is the list of places eligibility actually hides: a blood pressure monitor is general
merchandise, a gym membership with a letter of medical necessity is personal care, and COBRA,
long-term-care and Medicare premiums are insurance. Groceries were already the OTC lane's
reason for existing.

D39 exists because no such list is ever complete, and the error is asymmetric: being wrong
about a $9 lunch costs nothing, being wrong about a $1,400 charge costs a claim the user will
never know they missed. The threshold is a starting guess and should be revisited against
what it actually catches.

**On D40.** The classifier runs once, at import, and never again. The OTC lane shipped
2026-09-05; on that same account **51 charges imported before that date are superstore,
grocery and convenience purchases that today's classifier would route straight to the
queue** — invisible in the auto-filed pile purely because of when they arrived. Every future
improvement has this hole unless a re-run exists.

The "only ever adds" half is D36 applied to time. Taking a charge off the user's screen
because the engine changed its mind is the same silent dismissal, just later.

**On D41.** From the user's side, _this basket might have Tylenol in it_ and _we have no idea
what this is_ are the same sentence: **we are not sure, you tell us.** Two lanes for one ask
is the app showing its own plumbing. The cost is that the basket-specific heading has to
become neutral, which the per-row reasons already cover.

**On D42–D44.** Every non-transfer charge is in exactly one of four states, and they form a
2×2 of _who decided_ against _what they decided_: you-yes, you-no, engine-no, nobody-yet.
Engine-yes does not exist, by D36's asymmetry. Naming those states on screen is the point —
today "the engine filed this" and "this is waiting on you" are indistinguishable and mean
entirely different things.

D44 keeps D28's purpose and drops its mechanism. A count sitting permanently beside a filter
is a better counterweight than a sentence shown once: it cannot nag, it is stumbled onto by
someone who does not already know the pile exists, and it stays true as the pile changes.
A nested "decided by" filter was considered and rejected for exactly that reason — the person
who most needs that pile is the one who does not know to look for it.

**On D46.** It is the only named view answering a question from a different step of the
spine: the other four are all _what did we decide about this charge_, and this one is _what is
missing downstream_. Two doors onto one queue is how the two drift apart.

---

## 3. Gap list — this spec versus what is built

### Already built and correct

- Merchant grouping and bulk decide (`review_feed_groups`, `bulk_review_merchant`)
- Two lanes: confident-medical and possible-OTC
- OTC group expansion, with per-row decide and split (PRs #31, #34)
- Rules: three match types, creation via prompt, and a manager that can flip, delete,
  re-apply and undo a rule's effects
- Rule preview counts that reflect real changes (PR #30)
- Claim locking, record states, and release-on-void
- `SubstantiateDialog`, `ExpenseSplitDialog`, `DuplicateWarnings`
- A real Substantiate page (`/substantiate`) — step two of the product's spine, separate from
  this review queue. It is where a document gets attached and where eligibility actually gets
  confirmed; the review queue only ever says "this is a healthcare purchase," never "this
  qualifies." See §3.1.
- One document substantiating several expenses (`receipt_invoices` join table, wired through
  documentation state, the Pub 502 gate, the packet manifest, and duplicate-expense merging).
  See §3.1.

### Gaps, roughly in dependency order

| Decision          | Gap                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D5                | Medical-lane groups cannot be opened at all. Only the OTC lane expands.                                                                                                                                                                                                                                                                                              |
| D6                | Split is only offered in the OTC lane.                                                                                                                                                                                                                                                                                                                               |
| D7, D8, D9        | Copy says "Medical / Not medical"; the negative reads as a verdict; no undo on dismiss.                                                                                                                                                                                                                                                                              |
| D10               | `review_feed_groups` (`supabase/migrations/20260906120000_approval_creates_expense.sql:182`, the current definition — supersedes the one this spec first cited) orders by `lane DESC, COUNT(*) DESC, SUM(amount) DESC`. Still count-first within a lane; needs dollars first.                                                                                        |
| D11–D13           | Decided rows, group counts and empty groups behave per-lane and are not specified.                                                                                                                                                                                                                                                                                   |
| D14               | **Answered, no gap.** Splitting a transaction in this app does not create child transaction rows at all — see §3.1 below. `needs_review` is set straight to `false` on the one row being split, which is the same exit path a plain Healthcare/Not healthcare decision uses. `split_parent_id` belongs to a different, unrelated feature. Nothing to build.          |
| D15               | `SubstantiateDialog` opens as a modal over the feed. Needs to become a fading bottom prompt.                                                                                                                                                                                                                                                                         |
| D16               | No receipt offer at all after a bulk decision. The wording this spec already asked for — don't claim one file covers eighteen charges — is now provably the right caution: one document CAN legitimately cover several expenses (confirmed, §3.1), so the prompt's job is to link to Substantiate filtered to that merchant, not to suggest a single upload will do. |
| D17, D18          | Rule prompt fires only on a bulk decision, and never in the OTC lane.                                                                                                                                                                                                                                                                                                |
| D19               | Not exercised today — single-transaction merchants get no rule offer.                                                                                                                                                                                                                                                                                                |
| D20               | Prompt leads with the backfill count, so the most useful rule (a brand-new practice) announces itself as changing nothing.                                                                                                                                                                                                                                           |
| D21               | Prompts cannot coexist.                                                                                                                                                                                                                                                                                                                                              |
| D22, D23          | One name operator only. **Cost:** the matcher exists in three copies that must agree byte for byte — database, bank-import code, browser (`src/lib/merchantNormalize.ts:1-14`). A pinned test guards them.                                                                                                                                                           |
| D24               | `CategorizationRulesManager` is mounted twice (Settings and the Transactions page) and has **no create path**.                                                                                                                                                                                                                                                       |
| D25               | No indication anywhere that a rule, rather than the user, filed a transaction.                                                                                                                                                                                                                                                                                       |
| D2, D26, D27, D29 | Three peer tabs instead of one filtered list with named views.                                                                                                                                                                                                                                                                                                       |
| D28               | No surfacing of the auto-filed pile.                                                                                                                                                                                                                                                                                                                                 |
| D30–D33           | Generating a record locks its expenses immediately. No "sent to custodian" state exists; "void" is the user-facing word.                                                                                                                                                                                                                                             |
| D34               | Three buttons wrap onto two lines at 390px.                                                                                                                                                                                                                                                                                                                          |
| D3                | The OTC lane renders fully expanded, below the medical lane.                                                                                                                                                                                                                                                                                                         |
| D4                | `DuplicateWarnings` is a banner above the feed and is not counted in the queue total.                                                                                                                                                                                                                                                                                |
| D36–D39           | The classifier files every unrecognised charge as not-healthcare (`reason = 'none'`) without ever surfacing it, and reads none of Plaid's own confidence grade. No category exclusion list beyond money movement and vet; no dollar backstop.                                                                                                                        |
| D40               | The classifier runs once, at import, and never again — so every improvement leaves history behind. No re-run exists, automatic or manual. Measured cost on a real account: 51 charges the current classifier would queue, invisible because they predate the OTC lane.                                                                                               |
| D41               | Two lanes, but the second is basket-specific (`possible_otc`) and has no room for "we simply do not know". `review_feed_groups` derives the lane from `classification_reason = 'possible_otc'`.                                                                                                                                                                      |
| D42–D44           | **Built 2026-09-17 (slice 2).** One Status filter carrying live counts, over the five states in `src/lib/transactionStatus.ts`. "Healthcare" is confirmed-only, "Dismissed" is retired, transfers are their own state. D28's one-time nudge is gone with `useAutoFiledCount`.                                                                                        |
| D45               | **Built 2026-09-17 (slice 2).** Group by none / merchant / month, sort by date or amount in either direction (`src/lib/transactionGrouping.ts`), and an exact-merchant condition in the filter panel. Still lands ungrouped, newest first.                                                                                                                            |
| D46               | **Built 2026-09-17 (slice 2).** Gone from the filter, and the `invoices` join that fed it is off the page's query.                                                                                                                                                                                                                                                   |

### 3.1 The three open questions, answered

Checked against the code on 2026-09-14 (Phase A1) rather than decided. All three change what
later sessions need to build.

**1. Does a split's parent leave the queue, and do its children stay out?**

The question was wrongly framed — it assumed splitting creates child transaction rows, and it
doesn't. **Answered: yes, cleanly, and there was never really a risk here.**

Two unrelated features share the word "split" in this codebase:

- **HSA-account splitting** (`TransactionSplitDialog`, `transaction_splits` table) — divides
  one transaction's payment across several HSA accounts. This is the feature that owns
  `transactions.split_parent_id`, and it genuinely does create linked rows. It has nothing to
  do with the review queue.
- **Expense splitting** (`ExpenseSplitDialog`, the Split button this spec is about) — pulls a
  medical part out of a mixed basket, e.g. $12 of Tylenol from an $87 Walmart run. This is what
  D6/D14 actually mean. It does **not** touch `split_parent_id` at all. It creates one or more
  rows in `invoices` (one per expense), then updates the **single transaction row** in place:
  `is_medical = true, needs_review = false, is_split = true`
  (`src/components/transactions/ExpenseSplitDialog.tsx:139-149`).

Because `needs_review` flips straight to `false`, the row leaves `review_feed_groups` and
`review_feed_group_transactions` through the exact same door a plain Healthcare/Not healthcare
decision uses — both already filter on `needs_review IS TRUE`. Verified the group actually
re-renders without it: inside the review feed, `ExpenseSplitDialog`'s `onSplit` callback is
wired to the same `invalidate()` used by every other decision
(`src/components/transactions/ReviewFeed.tsx:568`), which refreshes both the group list and the
open group's transaction list. The new expenses created by the split go into `invoices`, which
the transaction review queue never reads — so there is no "child" that could re-enter this
queue even in principle. **No gap. Nothing to build for D14.**

**2. Can one document substantiate several expenses?**

**Answered: yes, and it already shipped**, in `supabase/migrations/20260905120000_receipt_invoices_join_table.sql`
(2026-09-05). `receipt_invoices` is a proper many-to-many join table between `receipts` and
`invoices`, RLS-scoped to the owner. It is the one place documentation state, the Pub 502
letter-of-medical-necessity gate, the reimbursement packet's document manifest
(`claimable_expenses()`), and duplicate-expense merging all read from — not a partial feature,
a fully wired one. `AttachDocumentDialog` (`src/components/documents/AttachDocumentDialog.tsx`)
already lets a user attach an existing document to a second expense without detaching it from
the first, and shows "Already attached to N other expenses" as a hint, not a warning.

This doesn't change D16's wording — it confirms the caution in it was correctly placed. See
the updated D16 row above.

**3. Does the eligibility engine ever disagree with a user's "healthcare" answer, and what does
the user see when it does?**

**Answered: not at the moment of the review-queue answer itself — that moment makes no
eligibility claim at all — but yes, later, and it is visibly surfaced.**

The review queue's "Healthcare" button (and the split flow above) only ever creates an expense
with `eligibility_state = 'unknown'`
(`supabase/migrations/20260906120000_approval_creates_expense.sql:113`, comment: _"Eligibility
is NOT decided here... The expense starts 'unknown' and substantiation resolves it"_). So there
is no instant where a user says "healthcare" and the app immediately contradicts them.

The real disagreement happens **on the Substantiate page**, once a date of service, a patient,
or a Pub 502 category is on record — via `classify-expense` or the three eligibility gates
(timing, dependency, Pub 502). At that point `recompute_expense_eligibility` can set
`eligibility_state = 'ineligible'` even though the transaction was answered "healthcare" back
in the queue — for example, care that predates the HSA's establishment date, or a patient who
isn't a tax dependent. **This is visible**, not silent: `EligibilityGates`
(`src/components/hsa/EligibilityGates.tsx`), shown inside `SubstantiationPanel` from both
`BillDetail` and `SubstantiateDialog`, renders each of the three gates with its own icon and
reason — a red alert icon and destructive-colored text for a refusal, amber for "conditional,
claimable once you attach the letter." Critically, **only Gate 3 (Pub 502 judgment) can be
overruled by the user's own confirmation** — Gates 1 and 2 are facts (a date, a dependent
status) and stand regardless of what the user already said. This is a sound design already in
place, not a gap — it just was not written into this spec's model. **Nothing to build**, but
worth stating plainly in §1: _"intent, not tax law"_ is true of the review queue's own
question, and the eligibility engine is where tax law actually gets applied, on its own
timeline, with its own visible disagreement surface.

---

## 4. Deliberately not in this spec

- **Swipe-to-triage** (D35) — its own piece of work.
- **An amount condition on rules** ("Walgreens under $15 is probably a snack"). Expressible
  and plausible, but nobody has asked for it. Wait for a real case.
- **An "always ask me about this merchant" pin.** Same reasoning.
- **Removing category-code rules**, which are blunt enough to be quietly dangerous — a rule
  on "pharmacy" sweeps in every pharmacy. The app already ranks that matcher last when
  suggesting one, which is sufficient for now.
- ~~**Any change to the classifier itself.** This spec is about what the user does with what
  the classifier produces.~~ **Overridden 2026-09-17 by §2.9.** The exclusion held right up
  until the question became _which charges reach the user at all_ — at which point what the
  classifier files on its own stopped being upstream of this spec and became the first
  decision in it. §2.9 changes only what the engine may decide **alone**; how it recognises a
  medical charge in the first place is still out of scope.
- **Settings as tabbed sections.** The page is a long scroll and the rules panel is buried at
  the bottom of it. Real, agreed 2026-09-17, and its own slice. **Built 2026-09-17 (slice
  3):** four tabs -- Account, Household & HSA, Banks & rules, App -- with the open tab in
  `?section=` and every `/settings#...` deep link resolved to the tab that owns it.
- **The service-worker / offline-cache decision**, still open from a previous session and
  unrelated to this page.

---

_Agreed 2026-09-14. Supersedes the transactions-page portions of the earlier phased plan._

_§2.9 agreed 2026-09-17, after D1–D35 shipped. It supersedes D27 and D28 and overrides one
§4 exclusion; every other decision above stands as written._

_D36–D41 built 2026-09-17 (PR #55). D42–D46 built 2026-09-17 (PR #56). Settings tabs
built 2026-09-17 (slice 3). Every item in §2.9's plan is now built._
