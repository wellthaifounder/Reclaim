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

### Gaps, roughly in dependency order

| Decision          | Gap                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D5                | Medical-lane groups cannot be opened at all. Only the OTC lane expands.                                                                                                                                             |
| D6                | Split is only offered in the OTC lane.                                                                                                                                                                              |
| D7, D8, D9        | Copy says "Medical / Not medical"; the negative reads as a verdict; no undo on dismiss.                                                                                                                             |
| D10               | `review_feed_groups` orders by `COUNT(*) DESC, SUM(amount) DESC`. Needs dollars first.                                                                                                                              |
| D11–D13           | Decided rows, group counts and empty groups behave per-lane and are not specified.                                                                                                                                  |
| D14               | **Unverified** — whether a split parent leaves the queue cleanly and its children stay out. The group query excludes children (`split_parent_id IS NULL`); the parent's state after a split has not been confirmed. |
| D15               | `SubstantiateDialog` opens as a modal over the feed. Needs to become a fading bottom prompt.                                                                                                                        |
| D16               | No receipt offer at all after a bulk decision.                                                                                                                                                                      |
| D17, D18          | Rule prompt fires only on a bulk decision, and never in the OTC lane.                                                                                                                                               |
| D19               | Not exercised today — single-transaction merchants get no rule offer.                                                                                                                                               |
| D20               | Prompt leads with the backfill count, so the most useful rule (a brand-new practice) announces itself as changing nothing.                                                                                          |
| D21               | Prompts cannot coexist.                                                                                                                                                                                             |
| D22, D23          | One name operator only. **Cost:** the matcher exists in three copies that must agree byte for byte — database, bank-import code, browser (`src/lib/merchantNormalize.ts:1-14`). A pinned test guards them.          |
| D24               | `CategorizationRulesManager` is mounted twice (Settings and the Transactions page) and has **no create path**.                                                                                                      |
| D25               | No indication anywhere that a rule, rather than the user, filed a transaction.                                                                                                                                      |
| D2, D26, D27, D29 | Three peer tabs instead of one filtered list with named views.                                                                                                                                                      |
| D28               | No surfacing of the auto-filed pile.                                                                                                                                                                                |
| D30–D33           | Generating a record locks its expenses immediately. No "sent to custodian" state exists; "void" is the user-facing word.                                                                                            |
| D34               | Three buttons wrap onto two lines at 390px.                                                                                                                                                                         |
| D3                | The OTC lane renders fully expanded, below the medical lane.                                                                                                                                                        |
| D4                | `DuplicateWarnings` is a banner above the feed and is not counted in the queue total.                                                                                                                               |

### Open questions, to be answered by checking rather than deciding

1. **Does a split's parent leave the queue, and do its children stay out?** (D14)
2. **Can one document substantiate several expenses?** This was planned but it is not
   confirmed as shipped. It changes the wording of D16.
3. **Does the eligibility engine ever disagree with a user's "healthcare" answer, and what
   does the user see when it does?** Not raised in the session; the spec assumes the
   existing behaviour.

---

## 4. Deliberately not in this spec

- **Swipe-to-triage** (D35) — its own piece of work.
- **An amount condition on rules** ("Walgreens under $15 is probably a snack"). Expressible
  and plausible, but nobody has asked for it. Wait for a real case.
- **An "always ask me about this merchant" pin.** Same reasoning.
- **Removing category-code rules**, which are blunt enough to be quietly dangerous — a rule
  on "pharmacy" sweeps in every pharmacy. The app already ranks that matcher last when
  suggesting one, which is sufficient for now.
- **Any change to the classifier itself.** This spec is about what the user does with what
  the classifier produces.
- **The service-worker / offline-cache decision**, still open from a previous session and
  unrelated to this page.

---

_Agreed 2026-09-14. Supersedes the transactions-page portions of the earlier phased plan._
