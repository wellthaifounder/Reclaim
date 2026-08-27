# Wellth.ai System Architecture

This document provides a comprehensive overview of Wellth.ai's system architecture, design decisions, and technical implementation.

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Architecture Diagram](#architecture-diagram)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Key Design Decisions](#key-design-decisions)
- [Scalability](#scalability)
- [Technology Stack](#technology-stack)

---

## High-Level Overview

Wellth.ai is a **HIPAA-compliant, cloud-native healthcare expense management platform** built on modern web technologies with security and performance as first principles.

**Architecture Style:** Serverless, event-driven, single-page application (SPA)

**Key Characteristics:**

- **Security-First:** 40+ RLS policies, AES-256 encryption, PHI redaction
- **Serverless:** No server management, auto-scaling edge functions
- **Real-Time:** WebSocket subscriptions for instant data updates
- **Offline-Capable:** Progressive Web App with service worker caching
- **Type-Safe:** End-to-end TypeScript for reliability

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │  React 18 SPA (TypeScript)                         │     │
│  │  - shadcn/ui Components                            │     │
│  │  - React Query (Server State)                      │     │
│  │  - React Router (Client Routing)                   │     │
│  │  - PWA (Service Worker + Offline)                  │     │
│  └────────────────────────────────────────────────────┘     │
│                                                               │
│       │                                                       │
│       │ HTTPS/REST/WebSocket                                 │
│       ▼                                                       │
└───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   SUPABASE PLATFORM                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Auth      │  │  PostgreSQL  │  │  Edge Functions  │   │
│  │  (JWT)      │  │   + RLS      │  │   (Deno)         │   │
│  │             │  │              │  │                  │   │
│  │  - Email    │  │  - 20+ Tables│  │  - 17 Functions  │   │
│  │  - OAuth    │  │  - 40+ RLS   │  │  - Serverless    │   │
│  │  - Session  │  │  - Triggers  │  │  - Auto-scale    │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐                          │
│  │  Storage    │  │  Realtime    │                          │
│  │  (Files)    │  │  (WebSocket) │                          │
│  │             │  │              │                          │
│  │  - Receipts │  │  - Subscr.   │                          │
│  │  - Bills    │  │  - Updates   │                          │
│  └─────────────┘  └──────────────┘                          │
│                                                               │
│       │                                                       │
│       │ External API Calls                                   │
│       ▼                                                       │
└───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  EXTERNAL SERVICES                           │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │  Stripe    │  │   Plaid    │  │     Gemini AI       │   │
│  │            │  │            │  │                     │   │
│  │  - Subscr. │  │  - Banks   │  │  - Bill Analysis    │   │
│  │  - Payments│  │  - Trans.  │  │  - PHI Redaction    │   │
│  │  - Webhook │  │  - Balance │  │  - Wellbie Chat     │   │
│  └────────────┘  └────────────┘  └─────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Frontend (React SPA)

**Technology:** React 18.3 + TypeScript 5.8 + Vite 5.4

**Key Libraries:**

- **UI:** shadcn/ui + Radix UI (accessible components)
- **Styling:** Tailwind CSS 3.4
- **State Management:** React Query 5.83 (server), useState/Context (local)
- **Routing:** React Router 6.30
- **Forms:** React Hook Form + Zod validation
- **Charts:** Recharts 2.15

**Component Structure:**

```
src/
├── components/
│   ├── bills/          # Bill management components
│   ├── dashboard/      # Dashboard widgets
│   ├── expense/        # Expense tracking
│   ├── hsa/            # HSA account management
│   ├── transactions/   # Transaction components
│   └── ui/             # shadcn/ui base components
├── pages/              # Route components
├── hooks/              # Custom React hooks
├── utils/              # Utility functions
└── integrations/       # Supabase client
```

**State Management Pattern:**

- **Server State:** React Query with caching, optimistic updates
- **Local State:** useState for component state
- **Global State:** React Context for theme, auth session
- **Form State:** React Hook Form with Zod schemas

**Key Features:**

- Code splitting via React.lazy()
- Error boundaries for fault isolation
- Suspense for loading states
- PWA with offline support

---

### 2. Backend (Supabase)

#### 2.1 PostgreSQL Database

**Version:** PostgreSQL 15+

**Database Features:**

- **Row Level Security (RLS):** 40+ policies enforcing user-level access
- **Triggers:** Automatic timestamps (created_at, updated_at)
- **Functions:** Custom database functions for complex operations
- **Full-Text Search:** For provider and bill search
- **JSON Support:** Flexible metadata storage

**Schema Overview:**

- **20+ tables** organized by domain
- **Enum types** for type safety (payment_type, reimbursement_strategy, etc.)
- **Foreign keys** maintaining referential integrity
- **Indexes** on hot query paths (10 composite indexes)

**Core Tables:**

```
User & Auth
├── profiles               # User profile data

Financial
├── expenses               # Expense tracking
├── receipts               # Receipt uploads
├── payment_methods        # Credit cards, HSA accounts
├── transactions           # Bank transactions
├── plaid_connections      # Bank account links

HSA/FSA
├── hsa_accounts           # HSA/FSA account management
├── hsa_transactions       # HSA-specific transactions
├── reimbursement_requests # Reimbursement tracking

Medical Bills
├── invoices               # Medical bills
├── bill_reviews           # AI bill analysis
├── bill_errors            # Identified billing errors
├── disputes               # Dispute tracking
├── dispute_communications # Dispute correspondence

Providers
├── providers              # Healthcare provider directory
├── provider_reviews       # Provider ratings/reviews
```

See [Database Schema](../database/schema.md) for complete documentation.

#### 2.2 Authentication (Supabase Auth)

**Method:** JWT-based authentication with automatic token refresh

**Supported Providers:**

- Email/Password (primary)
- Google OAuth
- (Extensible to other OAuth providers)

**Session Management:**

- **Storage:** sessionStorage (more secure than localStorage)
- **Timeout:** 15 minutes inactivity
- **Warning:** 2-minute advance warning
- **Refresh:** Automatic token refresh before expiration

**Security Features:**

- Password minimum 8 characters
- Email verification (configurable)
- Rate limiting on auth endpoints
- Session revocation support

See [Authentication Flow](#authentication-flow) below.

#### 2.3 Edge Functions (Deno Runtime)

**Total Functions:** 17 serverless functions

**Grouped by Domain:**

**Billing & Medical:**

- `analyze-medical-bill` - AI-powered bill error detection
- `send-dispute-notification` - Dispute notifications

**Subscriptions (Stripe):**

- `check-subscription` - Verify subscription status
- `create-checkout` - Create Stripe checkout session
- `customer-portal` - Stripe customer portal access

**Banking (Plaid):**

- `plaid-create-link-token` - Generate Plaid Link token
- `plaid-exchange-token` - Exchange public token for access token
- `plaid-sync-transactions` - Sync bank transactions

**Document Processing:**

- `process-receipt-ocr` - OCR for receipt extraction

**Security:**

- `redact-phi` - PHI redaction (pattern + AI)

**Notifications:**

- `send-nurture-email` - Marketing emails

**Provider Data:**

- `sync-npi-data` - Sync NPI provider database

**AI:**

- `wellbie-chat` - AI assistant chat

**Common Patterns:**

- Environment-based CORS validation
- Error sanitization (no PHI in responses)
- Supabase service role for database access
- Request validation with TypeScript types

See [API Documentation](../api/README.md) for detailed function specs.

#### 2.4 Storage

**Use Cases:**

- Receipt image uploads
- Medical bill PDFs
- Insurance card scans
- EOB (Explanation of Benefits) documents

**Security:**

- Public buckets with RLS policies
- File type validation (MIME + extension)
- Size limits (10MB per file, 100MB per batch)
- Automatic virus scanning (Supabase feature)

**Storage Buckets:**

```
receipts/          # Expense receipts
invoices/          # Medical bills
eobs/              # Explanation of Benefits
insurance-cards/   # Insurance documentation
```

#### 2.5 Realtime

**Technology:** WebSocket subscriptions via Supabase Realtime

**Subscriptions:**

- New expenses created
- Bill review updates
- Reimbursement status changes
- Transaction sync completion
- Subscription tier changes

**Pattern:**

```typescript
const subscription = supabase
  .channel("expenses")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "expenses",
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      // Handle new expense
    },
  )
  .subscribe();
```

---

### 3. External Services

#### 3.1 Stripe (Payments)

**Purpose:** Subscription management and payment processing

**Integration:**

- Checkout sessions for subscription signup
- Customer portal for subscription management
- Webhooks for subscription events
- Product/pricing configuration

**Tiers:**

- Free: Basic features
- Plus ($9.99/month): AI bill review, unlimited HSA accounts
- Premium ($19.99/month): Priority support, custom reports

See [Stripe Integration](../integrations/stripe.md).

#### 3.2 Plaid (Banking)

**Purpose:** Bank account connection and transaction sync

**Integration:**

- Plaid Link for account connection
- Transaction sync (automatic, daily)
- Balance retrieval
- Account metadata

**Security:**

- Access tokens encrypted with AES-256-GCM
- Tokens never exposed to frontend
- Sandbox environment for development

See [Plaid Integration](../integrations/plaid.md).

#### 3.3 Gemini AI (Google)

**Purpose:** AI-powered features

**Use Cases:**

- Medical bill error detection
- PHI redaction in bills
- Wellbie chat assistant
- Receipt data extraction (OCR)

**Models Used:**

- Gemini 2.5 Flash - Fast, cost-effective for chat and analysis

See [Gemini AI Integration](../integrations/gemini-ai.md).

---

## Data Flow

### User Action Flow

```
1. User Action (e.g., "Link Bank Account")
   │
   ▼
2. React Component Event Handler
   │
   ▼
3. React Query Mutation
   │
   ▼
4. Supabase Client (Frontend)
   │
   ▼
5. Edge Function (Backend)
   │  ├─> Validate request
   │  ├─> Check authentication (JWT)
   │  ├─> Call external API (Plaid)
   │  ├─> Encrypt sensitive data
   │  └─> Store in PostgreSQL
   │
   ▼
6. PostgreSQL (with RLS)
   │  ├─> Verify user owns data (RLS)
   │  ├─> Insert/update data
   │  └─> Trigger realtime event
   │
   ▼
7. Response to Frontend
   │
   ▼
8. React Query Cache Update
   │
   ▼
9. UI Re-render with New Data
```

### Authentication Flow

```
1. User enters credentials
   │
   ▼
2. Supabase Auth API
   │  ├─> Validate credentials
   │  ├─> Generate JWT token
   │  └─> Create session
   │
   ▼
3. Frontend receives tokens
   │  ├─> Access token (1 hour TTL)
   │  └─> Refresh token (stored in sessionStorage)
   │
   ▼
4. Subsequent requests include JWT
   │  └─> Authorization: Bearer <token>
   │
   ▼
5. Supabase verifies JWT
   │  ├─> Decode and validate signature
   │  ├─> Check expiration
   │  └─> Extract user_id
   │
   ▼
6. RLS policies use auth.uid()
   │  └─> WHERE user_id = auth.uid()
   │
   ▼
7. Auto-refresh before expiration
   │  └─> Refresh token → New access token
```

### Bill Analysis Flow

```
1. User uploads medical bill (PDF/image)
   │
   ▼
2. Upload to Supabase Storage
   │
   ▼
3. Trigger analyze-medical-bill edge function
   │
   ▼
4. Edge function
   │  ├─> Fetch file from storage
   │  ├─> Redact PHI (pattern + AI)
   │  ├─> Send to Gemini AI for analysis
   │  └─> Parse AI response
   │
   ▼
5. Gemini AI analyzes bill
   │  ├─> Identify line items
   │  ├─> Detect errors (duplicates, overcharges)
   │  ├─> Calculate potential savings
   │  └─> Return structured data
   │
   ▼
6. Store results in database
   │  ├─> bill_reviews table
   │  ├─> bill_errors table (identified issues)
   │  └─> Trigger realtime update
   │
   ▼
7. Frontend receives results
   │  └─> Display errors and savings
```

---

## Security Architecture

Wellth.ai implements **defense-in-depth** security with multiple layers:

### Layer 1: Network Security

- **HTTPS Enforced:** All traffic encrypted in transit (TLS 1.3)
- **CORS:** Strict origin validation (`ALLOWED_ORIGIN`)
- **CSP:** Content Security Policy headers prevent XSS
- **Security Headers:** X-Frame-Options, X-Content-Type-Options, etc.

### Layer 2: Authentication & Authorization

- **JWT Tokens:** Signed, expiring tokens
- **Session Timeout:** 15 minutes inactivity
- **RLS Policies:** 40+ database-level access controls
- **Explicit User Checks:** Defense-in-depth ownership verification

### Layer 3: Data Protection

- **Encryption at Rest:** AES-256 (Supabase default)
- **Encryption for Tokens:** AES-256-GCM for Plaid tokens
- **PHI Redaction:** Pattern + AI-based detection and removal
- **Error Sanitization:** No PHI in logs or user-facing errors

### Layer 4: Input Validation

- **Zod Schemas:** Runtime validation of all user inputs
- **File Validation:** Type, size, and content checks
- **SQL Injection Prevention:** Parameterized queries only
- **XSS Prevention:** CSP + React's built-in escaping

### Layer 5: Monitoring & Audit

- **Error Tracking:** Centralized logging (planned: Sentry)
- **Audit Trail:** created_at, updated_at on all tables
- **Error IDs:** Correlation IDs for support

See [Security Architecture](../security/README.md) for comprehensive details.

---

## Key Design Decisions

### Why Supabase?

**Reasons:**

1. **HIPAA-Compliant Infrastructure** - BAA available for healthcare apps
2. **Built-in RLS** - Database-level security out of the box
3. **Real-Time Subscriptions** - WebSocket support for live updates
4. **PostgreSQL** - Powerful relational database for complex queries
5. **Serverless Functions** - No server management, auto-scaling
6. **Authentication** - Complete auth system included
7. **Cost-Effective** - Pay for what you use, generous free tier

**Alternatives Considered:**

- Firebase (rejected: NoSQL limitations, less HIPAA-friendly)
- AWS Amplify (rejected: complexity, vendor lock-in)
- Custom backend (rejected: maintenance burden, slower development)

---

### Why Serverless Edge Functions?

**Benefits:**

1. **Auto-Scaling** - Handles traffic spikes automatically
2. **Cost-Efficient** - Pay only for execution time
3. **Geographic Distribution** - Functions run close to users
4. **No Server Management** - Focus on business logic
5. **Isolated Execution** - Security through isolation

**Trade-offs:**

- Cold starts (mitigated by Deno's fast startup)
- Timeout limits (10 minutes max, sufficient for our use cases)
- Limited persistent connections (managed via connection pooling)

---

### Why React Query?

**Benefits:**

1. **Automatic Caching** - Reduces unnecessary API calls
2. **Background Refetching** - Keeps data fresh
3. **Optimistic Updates** - Better UX during mutations
4. **Loading/Error States** - Built-in state management
5. **Deduplication** - Multiple components can request same data

**Pattern:**

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ["expenses", userId],
  queryFn: fetchExpenses,
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

---

### Security-First Design

**Principle:** Assume breach, minimize damage

**Implementation:**

1. **RLS on Everything** - Even if service role key leaks, data protected
2. **Explicit User Checks** - Defense-in-depth beyond RLS
3. **PHI Redaction** - Assume logs may leak, redact preemptively
4. **Error Sanitization** - Never expose internals to users
5. **Encryption** - Sensitive data encrypted at rest

---

## Scalability

### Current Capacity

**Database:**

- PostgreSQL handles millions of rows efficiently
- Indexed queries: <100ms p99
- Connection pooling: 100+ concurrent connections

**Edge Functions:**

- Auto-scale to thousands of concurrent executions
- Geographic distribution reduces latency
- Stateless design enables horizontal scaling

**Frontend:**

- Static assets on CDN (Lovable/Vercel)
- Code splitting reduces initial bundle size
- React Query caching reduces API load

### Performance Optimizations

**Query Optimization:**

- N+1 queries eliminated (used JOINs instead)
- Pagination on large datasets (500-1000 items)
- Specific column selection (no SELECT \*)
- Database indexes on hot paths

**Caching Strategy:**

- React Query: 5-minute stale time for most data
- Service Worker: Cache static assets offline
- CDN: Cache HTML/JS/CSS globally

**Metrics:**

- 70-90% reduction in database queries
- 70%+ faster page loads
- 50-90% faster filtered queries

See [Performance Audit](../audits/tier-3-performance.md).

### Scaling Roadmap

**Phase 1 (Current):** Single-region, auto-scaling
**Phase 2 (10K users):** Read replicas, edge caching
**Phase 3 (100K users):** Multi-region, CDN optimization
**Phase 4 (1M+ users):** Database sharding, microservices

---

## Technology Stack

### Frontend

| Technology      | Version | Purpose           |
| --------------- | ------- | ----------------- |
| React           | 18.3    | UI library        |
| TypeScript      | 5.8     | Type safety       |
| Vite            | 5.4     | Build tool        |
| Tailwind CSS    | 3.4     | Styling           |
| shadcn/ui       | Latest  | Component library |
| React Query     | 5.83    | Server state      |
| React Router    | 6.30    | Routing           |
| React Hook Form | 7.64    | Forms             |
| Zod             | 3.25    | Validation        |
| Recharts        | 2.15    | Charts            |

### Backend

| Technology        | Version | Purpose               |
| ----------------- | ------- | --------------------- |
| Supabase          | Latest  | Platform              |
| PostgreSQL        | 15+     | Database              |
| Deno              | Latest  | Edge function runtime |
| Supabase Auth     | Latest  | Authentication        |
| Supabase Storage  | Latest  | File storage          |
| Supabase Realtime | Latest  | WebSockets            |

### External Services

| Service   | Purpose          |
| --------- | ---------------- |
| Stripe    | Subscriptions    |
| Plaid     | Bank integration |
| Gemini AI | AI features      |

### Development Tools

| Tool       | Purpose             |
| ---------- | ------------------- |
| ESLint     | Linting             |
| TypeScript | Type checking       |
| Git        | Version control     |
| GitHub     | Code hosting        |
| Lovable    | Deployment platform |

---

## Related Documentation

- [Database Schema](../database/schema.md) - Complete database documentation
- [API Documentation](../api/README.md) - Edge function reference
- [Security Architecture](../security/README.md) - Security design details
- [Frontend Architecture](frontend-architecture.md) - Component structure (coming soon)

---

**Last Updated:** December 6, 2025
**Architecture Version:** 1.0.0
