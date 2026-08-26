# Wellth.ai API Documentation

This document provides an overview of all Supabase Edge Functions powering Wellth.ai's backend functionality.

## Overview

Wellth.ai uses **17 serverless edge functions** deployed on Supabase (Deno runtime). All functions implement:

- **Authentication:** JWT token validation
- **CORS:** Environment-based origin validation
- **Error Handling:** PHI-sanitized error responses
- **Type Safety:** TypeScript with strict typing

**Base URL:** `https://your-project-ref.supabase.co/functions/v1/`

## Quick Reference

| Function                                                | Method | Purpose                    | Auth Required |
| ------------------------------------------------------- | ------ | -------------------------- | ------------- |
| [analyze-medical-bill](#analyze-medical-bill)           | POST   | AI bill error detection    | Yes           |
| [check-subscription](#check-subscription)               | POST   | Verify subscription status | Yes           |
| [create-checkout](#create-checkout)                     | POST   | Create Stripe checkout     | Yes           |
| [create-tripwire-checkout](#create-tripwire-checkout)   | POST   | Tripwire offer checkout    | Yes           |
| [customer-portal](#customer-portal)                     | POST   | Stripe customer portal     | Yes           |
| [get-checkout-session](#get-checkout-session)           | POST   | Retrieve checkout session  | Yes           |
| [plaid-create-link-token](#plaid-create-link-token)     | POST   | Generate Plaid Link token  | Yes           |
| [plaid-exchange-token](#plaid-exchange-token)           | POST   | Exchange Plaid token       | Yes           |
| [plaid-sync-transactions](#plaid-sync-transactions)     | POST   | Sync bank transactions     | Yes           |
| [process-receipt-ocr](#process-receipt-ocr)             | POST   | Extract receipt data       | Yes           |
| [redact-phi](#redact-phi)                               | POST   | Redact PHI from text       | Yes           |
| [send-dispute-notification](#send-dispute-notification) | POST   | Send dispute emails        | Yes           |
| [send-nurture-email](#send-nurture-email)               | POST   | Send marketing email       | Yes           |
| [sync-npi-data](#sync-npi-data)                         | POST   | Sync NPI provider data     | Admin         |
| [sync-provider-data](#sync-provider-data)               | POST   | Sync provider database     | Admin         |
| [wellbie-chat](#wellbie-chat)                           | POST   | AI chat assistant          | Yes           |

## Functions by Category

### Billing & Medical Bills

#### analyze-medical-bill

**Purpose:** AI-powered medical bill analysis for error detection

**Description:** Uploads a medical bill (PDF or image), redacts PHI, sends to Gemini AI for analysis, and returns identified errors, overcharges, and potential savings.

**Use Cases:**

- Automatic bill review
- Error detection (duplicates, incorrect codes)
- Savings identification

**[View detailed documentation →](edge-functions/analyze-medical-bill.md)** _(coming soon)_

---

#### send-dispute-notification

**Purpose:** Send email notifications for bill disputes

**Description:** Sends notification emails when a dispute is filed, updated, or resolved.

**Use Cases:**

- Dispute confirmation emails
- Status update notifications
- Resolution alerts

**[View detailed documentation →](edge-functions/send-dispute-notification.md)** _(coming soon)_

---

### Subscriptions & Payments (Stripe)

#### check-subscription

**Purpose:** Verify user's current subscription tier

**Description:** Checks Stripe for the user's active subscription and returns the tier (Free, Plus, Premium).

**Use Cases:**

- Feature gate verification
- UI subscription badge display
- Access control

**[View detailed documentation →](edge-functions/check-subscription.md)** _(coming soon)_

---

#### create-checkout

**Purpose:** Create Stripe checkout session for subscription

**Description:** Generates a Stripe checkout session URL for subscribing to Plus or Premium tier.

**Use Cases:**

- Subscription signup flow
- Tier upgrades

**[View detailed documentation →](edge-functions/create-checkout.md)** _(coming soon)_

---

#### create-tripwire-checkout

**Purpose:** Create checkout for tripwire offer

**Description:** Generates a special discounted checkout session for first-time subscribers.

**Use Cases:**

- Promotional offers
- First-time subscriber discounts

**[View detailed documentation →](edge-functions/create-tripwire-checkout.md)** _(coming soon)_

---

#### customer-portal

**Purpose:** Generate Stripe customer portal link

**Description:** Creates a Stripe customer portal session for managing subscriptions, payment methods, and billing history.

**Use Cases:**

- Subscription management
- Payment method updates
- Billing history access

**[View detailed documentation →](edge-functions/customer-portal.md)** _(coming soon)_

---

#### get-checkout-session

**Purpose:** Retrieve Stripe checkout session details

**Description:** Fetches checkout session information to verify payment success and update user subscription.

**Use Cases:**

- Post-payment verification
- Subscription activation

**[View detailed documentation →](edge-functions/get-checkout-session.md)** _(coming soon)_

---

### Banking Integration (Plaid)

#### plaid-create-link-token

**Purpose:** Generate Plaid Link token for bank connection

**Description:** Creates a Plaid Link token that allows users to securely connect their bank accounts through the Plaid Link UI.

**Use Cases:**

- Initial bank account connection
- Re-authentication after token expiration

**[View detailed documentation →](edge-functions/plaid-create-link-token.md)** _(coming soon)_

---

#### plaid-exchange-token

**Purpose:** Exchange Plaid public token for access token

**Description:** After user completes Plaid Link flow, exchanges the temporary public token for a permanent access token and encrypts it for storage.

**Use Cases:**

- Complete bank connection flow
- Store encrypted access token

**Security:** Access tokens encrypted with AES-256-GCM before storage

**[View detailed documentation →](edge-functions/plaid-exchange-token.md)** _(coming soon)_

---

#### plaid-sync-transactions

**Purpose:** Sync transactions from connected bank accounts

**Description:** Fetches recent transactions from Plaid, decrypts access token, syncs new transactions to database, and categorizes as needed.

**Use Cases:**

- Automatic transaction import
- Daily transaction sync
- Manual refresh

**[View detailed documentation →](edge-functions/plaid-sync-transactions.md)** _(coming soon)_

---

### Document Processing

#### process-receipt-ocr

**Purpose:** Extract data from receipt images using OCR

**Description:** Processes uploaded receipt images, extracts vendor, date, amount, and line items using Gemini AI vision capabilities.

**Use Cases:**

- Quick expense entry from receipt photo
- Automatic expense categorization

**[View detailed documentation →](edge-functions/process-receipt-ocr.md)** _(coming soon)_

---

### Security & Privacy

#### redact-phi

**Purpose:** Redact Protected Health Information from text

**Description:** Uses pattern-based detection and Gemini AI to identify and remove PHI (SSN, phone, email, MRN, patient names, etc.) from medical bills and documents.

**PHI Detected:**

- Social Security Numbers
- Phone numbers
- Email addresses
- Medical Record Numbers (MRN)
- Patient names (AI-based)
- Dates of birth
- Addresses

**[View detailed documentation →](edge-functions/redact-phi.md)** _(coming soon)_

---

### Notifications

#### send-nurture-email

**Purpose:** Send marketing and nurture emails

**Description:** Sends transactional or marketing emails to users based on triggers or campaigns.

**Use Cases:**

- Welcome emails
- Feature announcements
- Re-engagement campaigns

**[View detailed documentation →](edge-functions/send-nurture-email.md)** _(coming soon)_

---

### Provider Data Management

#### sync-npi-data

**Purpose:** Sync National Provider Identifier (NPI) database

**Description:** Admin function that syncs healthcare provider data from the NPI registry to populate the provider directory.

**Use Cases:**

- Initial provider database setup
- Periodic provider data updates

**[View detailed documentation →](edge-functions/sync-npi-data.md)** _(coming soon)_

---

#### sync-provider-data

**Purpose:** General provider data synchronization

**Description:** Admin function for syncing provider information from various sources into the provider directory.

**Use Cases:**

- Provider database maintenance
- Data quality improvements

**[View detailed documentation →](edge-functions/sync-provider-data.md)** _(coming soon)_

---

### AI Features

#### wellbie-chat

**Purpose:** AI-powered healthcare finance assistant

**Description:** Handles chat conversations with Wellbie, the AI assistant. Uses Gemini AI to answer questions about healthcare expenses, HSA accounts, medical bills, and financial optimization.

**Capabilities:**

- HSA/FSA account questions
- Medical bill explanation
- Expense categorization help
- Reimbursement guidance

**[View detailed documentation →](edge-functions/wellbie-chat.md)** _(coming soon)_

---

## Common Patterns

### Authentication

All functions (except admin-only) require JWT authentication:

```typescript
const authHeader = request.headers.get("Authorization");
if (!authHeader) {
  return new Response(JSON.stringify({ error: "Missing auth header" }), {
    status: 401,
  });
}

const token = authHeader.replace("Bearer ", "");
const {
  data: { user },
  error,
} = await supabaseClient.auth.getUser(token);

if (error || !user) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
  });
}
```

**From Frontend:**

```typescript
const { data, error } = await supabase.functions.invoke("function-name", {
  body: {/* your data */},
});
// JWT automatically included by Supabase client
```

---

### CORS

All functions implement environment-based CORS:

```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin":
    Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:5173",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

// OPTIONS preflight handling
if (request.method === "OPTIONS") {
  return new Response("ok", { headers: corsHeaders });
}
```

---

### Error Responses

Standard error format:

```json
{
  "error": "User-friendly message",
  "details": "Additional context",
  "code": "ERROR_CODE"
}
```

**Example:**

```json
{
  "error": "Failed to analyze bill",
  "details": "Invalid file format",
  "code": "INVALID_FILE_FORMAT"
}
```

**PHI Sanitization:** Error messages are sanitized to prevent PHI exposure.

---

### Success Responses

Functions return JSON with appropriate data:

```json
{
  "success": true,
  "data": {/* response data */}
}
```

---

## Testing Locally

### Prerequisites

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
npx supabase start
```

### Serve Function Locally

```bash
# Serve specific function
npx supabase functions serve function-name --env-file .env

# Function runs at:
# http://localhost:54321/functions/v1/function-name
```

### Test with curl

```bash
# Get your JWT token
# (From browser console: supabase.auth.session().access_token)

curl -X POST 'http://localhost:54321/functions/v1/function-name' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"key":"value"}'
```

### Test from Frontend

```typescript
const { data, error } = await supabase.functions.invoke("function-name", {
  body: { key: "value" },
});

console.log(data, error);
```

---

## Deployment

### Deploy All Functions

```bash
npx supabase functions deploy
```

### Deploy Specific Function

```bash
npx supabase functions deploy function-name
```

### Verify Deployment

```bash
# List deployed functions
npx supabase functions list
```

---

## Environment Variables

Functions access environment variables via Supabase secrets:

```bash
# Set secrets for edge functions
npx supabase secrets set STRIPE_SECRET_KEY="sk_test_..."
npx supabase secrets set PLAID_CLIENT_ID="..."
npx supabase secrets set GEMINI_API_KEY="..."

# List all secrets
npx supabase secrets list

# Unset a secret
npx supabase secrets unset KEY_NAME
```

**Required Secrets:**

- `STRIPE_SECRET_KEY` - Stripe API key
- `PLAID_CLIENT_ID` - Plaid client ID
- `PLAID_SECRET` - Plaid secret
- `PLAID_ENV` - Plaid environment (sandbox/development/production)
- `GEMINI_API_KEY` - Gemini AI API key
- `PLAID_ENCRYPTION_KEY` - AES-256 encryption key (32 bytes base64)
- `ALLOWED_ORIGIN` - CORS allowed origin

See [Environment Variables Guide](../getting-started/environment-variables.md).

---

## Rate Limiting

**Current Status:** Not implemented

**Planned:** API rate limiting per user

- Free tier: 100 requests/hour
- Plus tier: 1,000 requests/hour
- Premium tier: 10,000 requests/hour

---

## Monitoring

**Error Tracking:** Planned integration with Sentry

**Logs:** Available in Supabase Dashboard → Edge Functions → Logs

**Metrics:**

- Invocation count
- Error rate
- Execution time
- Memory usage

---

## Security

**Best Practices:**

1. Always validate JWT tokens
2. Sanitize error messages (no PHI)
3. Use environment variables for secrets
4. Implement request validation
5. Return generic error messages to users
6. Log detailed errors only in development

See [Security Policy](../security/SECURITY.md).

---

## Troubleshooting

### "Function not found" (404)

**Cause:** Function not deployed

**Fix:**

```bash
npx supabase functions deploy function-name
```

---

### "Unauthorized" (401)

**Cause:** Missing or invalid JWT token

**Fix:**

1. Verify user is signed in
2. Check JWT token is included in Authorization header
3. Verify token hasn't expired

---

### "CORS error"

**Cause:** `ALLOWED_ORIGIN` mismatch

**Fix:**

```bash
npx supabase secrets set ALLOWED_ORIGIN="http://localhost:5173"
# Or your actual frontend URL
```

---

### "Internal server error" (500)

**Cause:** Various (check function logs)

**Fix:**

1. Check Supabase Dashboard → Edge Functions → Logs
2. Verify all required secrets are set
3. Check external service API keys (Stripe, Plaid, Gemini)

---

## Related Documentation

- [Installation Guide](../getting-started/installation.md) - Setup instructions
- [Environment Variables](../getting-started/environment-variables.md) - Configuration reference
- [Architecture Overview](../architecture/README.md) - System design
- [Security Policy](../security/SECURITY.md) - Security guidelines

---

## Individual Function Documentation

Detailed documentation for each function is coming soon. Each will include:

- Complete request/response schemas
- Code examples (TypeScript/JavaScript)
- Error codes and handling
- Environment variable requirements
- Security considerations
- Testing examples

**Priority order:**

1. Plaid functions (bank integration)
2. AI functions (bill analysis, chat)
3. Stripe functions (subscriptions)
4. Remaining utility functions

---

**Last Updated:** December 6, 2025
**API Version:** 1.0.0
**Total Functions:** 17
