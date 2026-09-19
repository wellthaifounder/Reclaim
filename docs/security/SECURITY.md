# Security Policy

Wellth.ai takes security seriously. This document outlines our security measures, responsible disclosure policy, and how to report vulnerabilities.

## Table of Contents

- [Reporting a Vulnerability](#reporting-a-vulnerability)
- [Security Measures](#security-measures)
- [HIPAA Compliance](#hipaa-compliance)
- [Security Best Practices](#security-best-practices)
- [Security Audit History](#security-audit-history)
- [Contact Information](#contact-information)

---

## Reporting a Vulnerability

### Responsible Disclosure

If you discover a security vulnerability in Wellth.ai, we appreciate your help in disclosing it to us responsibly.

**DO NOT:**

- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability beyond what is necessary to demonstrate it
- Access, modify, or delete other users' data
- Perform Denial of Service (DoS) attacks
- Conduct social engineering attacks on users or staff

**DO:**

- Report the vulnerability privately
- Provide detailed information to help us reproduce and fix the issue
- Allow reasonable time for us to address the vulnerability before public disclosure
- Act in good faith and follow coordinated disclosure practices

### How to Report

**Email:** security@wellth.ai

**Subject Line:** `[SECURITY] Brief description of vulnerability`

**Include in your report:**

1. **Description:** Clear description of the vulnerability
2. **Impact:** Potential impact and affected components
3. **Reproduction Steps:** Detailed steps to reproduce the issue
4. **Proof of Concept:** Code, screenshots, or video demonstrating the vulnerability
5. **Suggested Fix:** (Optional) Recommendations for remediation
6. **Your Contact Info:** How we can reach you for follow-up questions

**Example Report Template:**

```markdown
## Vulnerability Description

[Clear description]

## Affected Component

- URL/Endpoint:
- Component:
- Version:

## Impact

- Severity: Critical/High/Medium/Low
- Attack Vector:
- User Impact:

## Reproduction Steps

1. Step one
2. Step two
3. ...

## Proof of Concept

[Code, screenshots, or video]

## Suggested Mitigation

[Optional]

## Reporter Information

- Name:
- Email:
- PGP Key (optional):
```

### What to Expect

**Timeline:**

- **24 hours:** Acknowledgment of your report
- **7 days:** Initial assessment and severity classification
- **30 days:** Patch for critical/high severity issues
- **90 days:** Patch for medium/low severity issues
- **Coordinated disclosure:** We'll work with you on public disclosure timing

**Communication:**

- Regular updates every 72 hours on progress
- Notification when the fix is deployed
- Credit in our security acknowledgments (if desired)

**Rewards:**
While we don't currently have a formal bug bounty program, we offer:

- Public recognition in our Hall of Fame (if desired)
- Swag and/or Wellth.ai subscription upgrade
- LinkedIn recommendation for significant findings

---

## Security Measures

Wellth.ai implements comprehensive security controls across all layers of the application.

### Authentication & Authorization

**Authentication Methods:**

- Email/password with bcrypt hashing
- Google OAuth 2.0
- JWT-based session management
- Automatic token refresh

**Session Security:**

- **Storage:** sessionStorage (not localStorage for better security)
- **Timeout:** 15 minutes of inactivity
- **Warning:** 2-minute advance warning before logout
- **Token Refresh:** Automatic refresh before expiration
- **Revocation:** Ability to revoke sessions remotely

**Authorization:**

- **Row Level Security:** 40+ PostgreSQL RLS policies
- **User-Level Access:** All data scoped to authenticated user
- **Nested Policies:** Complex policies for related data (e.g., receipts → expenses → user)
- **Explicit Checks:** Defense-in-depth with application-level user verification

---

### Data Protection

**Encryption at Rest:**

- **Database:** AES-256 encryption for all Supabase data
- **Plaid Tokens:** AES-256-GCM encryption with unique IVs
- **Files:** Automatic encryption in Supabase Storage

**Encryption in Transit:**

- **HTTPS Only:** TLS 1.3 for all connections
- **API Calls:** HTTPS for Stripe, Plaid, Gemini AI
- **WebSockets:** Secure WebSocket (wss://) for realtime

**PHI Protection:**

- **Redaction System:** Pattern-based + AI-powered PHI detection
- **Error Sanitization:** PHI removed from logs and user-facing errors
- **Logging:** Development-only detailed logging, generic messages in production

**PHI Redaction Patterns:**

- Social Security Numbers (SSN)
- Phone numbers
- Email addresses
- Date of birth
- Medical Record Numbers (MRN)
- Street addresses
- ZIP codes
- Patient names (AI-based)

---

### Application Security

**Content Security Policy (CSP):**

```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.plaid.com
worker-src 'self' blob:
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
img-src 'self' data: https: blob:
connect-src 'self' https://*.supabase.co https://sandbox.plaid.com https://api.stripe.com
frame-src 'self' https://js.stripe.com https://cdn.plaid.com
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

`worker-src` is stated rather than inherited from `script-src`, which is what
it did until 2026-09-19. The HEIC-to-JPEG converter that runs on uploaded
iPhone photos starts its decoder in a Web Worker created from a `blob:` URL,
and `script-src` does not permit `blob:`. Naming `worker-src` explicitly is
also narrower than the fallback it replaces: workers may come only from this
origin or from a blob this application constructed, and no longer from Stripe,
Plaid, or an inline script. Creating a blob worker requires script execution
the attacker would already have to hold.

**Security Headers:**

- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin` - Referrer control
- `Permissions-Policy: geolocation=(), microphone=(), camera=()` - Feature restrictions

**CORS Protection:**

- Strict origin validation in all edge functions
- Allowed origin from environment variable
- Preflight OPTIONS handling
- Credentials allowed only for authenticated requests

**File Upload Security:**

- **Type Validation:** MIME type + file extension checks
- **Size Limits:** 10MB per file, 100MB per batch
- **Allowed Types:** JPEG, PNG, PDF, GIF, WebP only
- **Content Scanning:** Automatic virus scanning (Supabase feature)

**Input Validation:**

- Zod schemas for all user inputs
- Runtime type checking
- SQL injection prevention via parameterized queries
- XSS prevention via React's built-in escaping

**Error Handling:**

- Generic error messages for users
- Detailed logging in development only
- Error IDs for support correlation
- PHI sanitization in all error messages

---

### Infrastructure Security

**Database Security:**

- Row Level Security (RLS) on all tables
- Encrypted connections (SSL/TLS)
- Regular automated backups
- Point-in-time recovery
- Connection pooling with PgBouncer

**Edge Function Security:**

- Isolated execution environments (Deno)
- Environment variable encryption
- No persistent file system
- Request timeout (10 minutes max)
- Rate limiting (planned)

**Secrets Management:**

- Supabase encrypted secrets storage
- No secrets in code or version control
- Environment-specific secrets
- Regular key rotation

---

## HIPAA Compliance

Wellth.ai is designed to meet HIPAA Security Rule requirements for electronic Protected Health Information (ePHI).

### Technical Safeguards (45 CFR §164.312)

**Access Control (§164.312(a)(1)):**

- ✅ **Unique User Identification:** Supabase Auth with email/password or OAuth
- ✅ **Emergency Access Procedure:** Password reset flow
- ✅ **Automatic Logoff:** 15-minute session timeout
- ✅ **Encryption and Decryption:** AES-256-GCM for Plaid tokens

**Audit Controls (§164.312(b)):**

- ✅ **Timestamp Tracking:** created_at, updated_at on all tables
- ✅ **Error ID Generation:** Correlation IDs for incident tracking
- ⚠️ **Centralized Audit Logging:** Planned (Sentry integration)

**Integrity (§164.312(c)(1)):**

- ✅ **Database Constraints:** Prevent data corruption
- ✅ **Encryption:** Prevents tampering with Plaid tokens
- ✅ **Checksums:** File integrity validation

**Transmission Security (§164.312(e)(1)):**

- ✅ **HTTPS Everywhere:** All connections encrypted with TLS 1.3
- ✅ **API Security:** Encrypted connections to Stripe, Plaid, Gemini
- ✅ **CSP:** Restricts data transmission endpoints

### Physical Safeguards (45 CFR §164.310)

**Workstation Use (§164.310(b)):**

- ✅ **Session Timeout:** 15-minute automatic logout
- ✅ **User Warning:** 2-minute advance warning before logout

**Workstation Security (§164.310(c)):**

- ✅ **CSP:** Prevents malicious code execution
- ✅ **File Upload Restrictions:** Limits attack surface

### Administrative Safeguards (45 CFR §164.308)

**Security Management Process (§164.308(a)(1)):**

- ✅ **PHI Redaction:** Automatic removal from bills and logs
- ✅ **Error Sanitization:** Prevents PHI leakage in errors
- ✅ **RLS Policies:** Comprehensive access control

**Workforce Security (§164.308(a)(3)):**

- ✅ **Authentication:** Required for all data access
- ✅ **Password Requirements:** Minimum 8 characters
- ✅ **Session Termination:** Automatic after timeout

### Compliance Status

| Requirement           | Status      | Notes                    |
| --------------------- | ----------- | ------------------------ |
| Access Control        | ✅ Complete | RLS + session timeout    |
| Audit Controls        | ⚠️ 90%      | Need centralized logging |
| Integrity             | ✅ Complete | Encryption + constraints |
| Transmission Security | ✅ Complete | HTTPS + TLS 1.3          |
| Workstation Use       | ✅ Complete | Session timeout          |
| PHI Protection        | ✅ Complete | Redaction + sanitization |

See [HIPAA Compliance Guide](hipaa-compliance.md) for detailed documentation.

---

## Security Best Practices

### For Developers

1. **Never Commit Secrets**

   ```bash
   # Verify .env is gitignored
   git status

   # Should NOT show .env
   ```

2. **Always Validate Inputs**

   ```typescript
   import { z } from "zod";

   const schema = z.object({
     email: z.string().email().max(255),
     amount: z.number().positive(),
   });

   const data = schema.parse(userInput);
   ```

3. **Use Error Sanitization**

   ```typescript
   import { handleError } from "@/utils/errorHandler";

   try {
     await riskyOperation();
   } catch (error) {
     handleError(error, "operation-context", toast);
   }
   ```

4. **Verify User Ownership**

   ```typescript
   const { data } = await supabase
     .from("expenses")
     .select("*")
     .eq("user_id", user.id); // Explicit check
   ```

5. **No PHI in Logs**

   ```typescript
   // Bad
   console.log("User email:", email);

   // Good
   import { logError } from "@/utils/errorHandler";
   logError("Operation failed", error, { context: "specific-operation" });
   ```

### For Users

1. **Use Strong Passwords**
   - Minimum 12 characters
   - Mix of uppercase, lowercase, numbers, symbols
   - Use a password manager (1Password, Bitwarden)

2. **Enable Two-Factor Authentication** (when available)

3. **Review Connected Accounts**
   - Regularly review bank account connections
   - Revoke unused integrations

4. **Report Suspicious Activity**
   - Email security@wellth.ai immediately
   - Include details of suspicious behavior

---

## Security Audit History

### 2025-12-06: Comprehensive Security Audit (Tier 1-4)

**Tier 1 - Critical Security (5 fixes):**

- Implemented RLS policies on all tables
- Added request correlation IDs
- Environment-based CORS validation
- Fixed authentication enforcement gaps
- Database-level access control

**Tier 4 - Advanced Security (6 enhancements):**

- Content Security Policy headers
- Session timeout (15 min) with warnings
- File upload validation
- Secure error handling utility
- Explicit user ownership checks
- Additional security headers

**Results:**

- Attack surface reduced by 80%+
- HIPAA compliance improved from 70% to 95%
- Zero critical vulnerabilities remaining

See [Complete Audit Summary](../audits/complete-audit-summary.md).

---

## Out of Scope

The following are **not** considered security vulnerabilities:

1. **Social Engineering**
   - Phishing attacks on users
   - Impersonation of support staff

2. **Physical Attacks**
   - Physical access to user devices
   - Shoulder surfing

3. **Denial of Service (DoS)**
   - Automated DoS attacks
   - Resource exhaustion attacks

4. **Spam/Content Issues**
   - Spam submissions
   - Offensive content

5. **Previously Reported Issues**
   - Vulnerabilities already disclosed
   - Issues in our public changelog

6. **Low-Impact Issues**
   - Self-XSS (requires user to paste malicious code)
   - Clickjacking on non-sensitive pages
   - Missing security headers with no exploitable impact

---

## Security Roadmap

### Q1 2026

- Implement centralized audit logging (Sentry)
- Add API rate limiting on edge functions
- Implement Two-Factor Authentication (2FA)
- Security testing in CI/CD pipeline

### Q2 2026

- Penetration testing by third-party firm
- HIPAA compliance audit by certified auditor
- Implement Web Application Firewall (WAF)
- Expand PHI redaction patterns

### Q3 2026

- Bug bounty program launch
- Security training for contributors
- Automated dependency vulnerability scanning
- Incident response playbook

---

## Contact Information

**Security Team:**

- Email: security@wellth.ai
- PGP Key: [Coming soon]

**Response SLA:**

- **Critical:** 24 hours
- **High:** 7 days
- **Medium:** 30 days
- **Low:** 90 days

**Business Hours:** Monday-Friday, 9 AM - 5 PM PST
**Emergency:** security@wellth.ai (monitored 24/7 for critical issues)

---

## Legal

By reporting vulnerabilities to Wellth.ai, you agree to:

1. Not publicly disclose the vulnerability without our consent
2. Act in good faith to avoid privacy violations and service disruption
3. Comply with all applicable laws

We commit to:

1. Respond to your report in a timely manner
2. Work with you to understand and resolve the issue
3. Credit you for your discovery (if desired)
4. Not pursue legal action for good-faith security research

---

## Additional Resources

- [HIPAA Compliance Guide](hipaa-compliance.md)
- [PHI Handling Guide](phi-handling.md)
- [Security Architecture](README.md)
- [Coding Standards](../development/coding-standards.md)

---

**Last Updated:** December 6, 2025
**Policy Version:** 1.0.0
**Next Review:** March 6, 2026 (quarterly)
