---
version: 1.0
updatedAt: 2026-11-21
---
# Access Management: IAM, the Root User, MFA, Roles, Identity Center and Cognito

> Exam domain: **Security and Compliance (30%)**, task statement 2.3 *Identify AWS access management capabilities*.

---

## IAM in four facts

**AWS Identity and Access Management (IAM)** decides who is **authenticated** (signed in) and **authorized** (has permissions) to use AWS resources.

- **No additional charge** for IAM, IAM Identity Center or AWS STS. You pay only for the resources your identities use.
- **Global:** IAM is a Region-based service that is available globally. Identities you create are replicated to every enabled Region, so a new Region needs no IAM work.
- **Default deny:** a request is allowed only when a policy allows it.
- **Least privilege:** grant only the actions, on the specific resources, under the conditions a task needs. Start from AWS managed policies, refine into your own customer managed policies, and remove access that "last accessed" information shows is unused.

---

## The building blocks

| Identity | What it is | Credentials |
|----------|-----------|-------------|
| **Root user** | The identity created with the account, with complete access | Email and password (protect with MFA) |
| **IAM user** | A person or workload with long-term credentials in one account | Password (console) and/or up to **two** access keys (CLI, SDK, API) |
| **IAM group** | A collection of users that share attached policies | **None.** A group cannot sign in and cannot be a principal in a policy |
| **IAM role** | A set of permissions **anyone authorized can assume** | **No long-term credentials.** Assuming it returns **temporary** credentials from AWS STS |

Group rules: a user can belong to many groups; groups **cannot be nested**; there is no default group.

Who can assume a role (defined in the role's **trust policy**): IAM users in the same or **another account**, other roles, **AWS services** such as EC2 and Lambda, and users **federated** through a SAML 2.0 or OIDC identity provider. Roles are the primary way to grant **cross-account** access, and the way to give an EC2 instance or Lambda function AWS access **without storing keys** in code.

---

## Policies and how they combine

| Policy type | Who writes it | Notes |
|-------------|---------------|-------|
| **AWS managed** | AWS | Reusable, **you cannot edit it** (for example `AdministratorAccess`) |
| **Customer managed** | You | Reusable, editable, the tool for least privilege |
| **Inline** | You | Embedded in one identity, deleted with it |

A least-privilege identity policy that lets an analyst read one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::finance-reports", "arn:aws:s3:::finance-reports/*"]
  }]
}
```

Evaluation in one account:

1. Everything starts **denied**.
2. Identity-based and resource-based (for example a bucket policy) **allows add up**.
3. An **explicit deny in any policy wins** over every allow.
4. Guardrails such as **SCPs** and permissions boundaries do not grant anything; the action must also be allowed by them.

---

## The root user

Root-only tasks (the official list today):

- Change the root user's email, password or root access keys, and **close** a standalone account (or reopen a closed one)
- **Restore IAM permissions** when the only administrator locked themselves out
- **Activate IAM access** to the Billing and Cost Management console; some billing tasks and certain tax invoices
- Sign up for AWS GovCloud (US); register as a seller in the **Reserved Instance Marketplace**
- Recover an unmanageable KMS key through AWS Support
- Enable **S3 MFA Delete**
- Edit or delete an S3 bucket policy or SQS queue policy that **denies all principals**

Not root-only: the **account name**, contact information, alternate contacts, payment currency, Regions, and **changing the AWS Support plan** (IAM permissions in the Support Plans console are enough).

Protect it: strong password, **MFA** (now enforced for root users of all account types), **no root access keys**, a group email address, monitored use, and IAM or Identity Center identities for daily work. In AWS Organizations, member account root credentials can be removed centrally, and SCPs restrict member account root users.

> Older study material says changing the account name or the Support plan requires the root user; the current official documentation says both can be done with IAM permissions.

---

## Credentials, MFA and password policy

| Entry point | Credential |
|-------------|-----------|
| AWS Management Console | User name and password, plus MFA |
| AWS CLI, SDKs, API | **Access key ID + secret access key** (the secret is shown only once, at creation) |
| SSH to an EC2 instance | SSH keys; AWS recommends EC2 Instance Connect for handling them |
| HTTPS on your site | An SSL/TLS **server certificate** (ACM). It is **not** a sign-in credential |

**MFA types:** passkeys and security keys (FIDO, phishing resistant, recommended), virtual authenticator apps and hardware TOTP tokens. Up to **8** MFA devices per root or IAM user. A long-term access key carries no MFA by itself; MFA-protected API access works through **temporary credentials** from STS with an MFA code and a policy condition.

> Older study material lists SMS text messages as an MFA option; the current official documentation says SMS MFA can no longer be enabled.

**Password policy.** Without a custom policy, IAM user passwords need 8 to 128 characters and at least three of four character types (uppercase, lowercase, numbers, symbols), and they **never expire**. A custom policy can set a minimum length, required character types, expiration (1 to 1,095 days), reuse prevention and whether users change their own password. There is no account lockout setting, and the policy applies neither to the root user nor to access keys.

---

## Workforce, customers and directories

| Who signs in | Use |
|--------------|-----|
| Employees, once, into **many AWS accounts** and AWS managed apps | **AWS IAM Identity Center** (its own directory or an external IdP through SAML 2.0) |
| Customers of your **web or mobile app** (sign-up, Google or Apple sign-in, guests) | **Amazon Cognito**: user pools sign users in and issue tokens; identity pools trade tokens for temporary AWS credentials |
| Microsoft Active Directory workloads | **AWS Directory Service** (lesson 2.4) |

AWS recommends **federation** with an identity provider and temporary credentials for human users, and IAM Identity Center for central access across accounts.

> Older study material says "AWS Single Sign-On (AWS SSO)"; the current official documentation says it was renamed **AWS IAM Identity Center** on July 26, 2022. IAM itself is not a single sign-on service.

---

## Storing credentials for applications

| Need | Use |
|------|-----|
| Database passwords, API keys, OAuth tokens with **automatic rotation** | **AWS Secrets Manager** (billed per secret and per API call) |
| Configuration values, optionally encrypted (SecureString with KMS), no rotation | **AWS Systems Manager Parameter Store** (standard tier free) |
| AWS access for code running on AWS | An **IAM role**, not a stored key |

---

## Access reports and S3 access

- **Credential report:** a CSV of every IAM user and the status of their passwords, access keys, MFA and certificates.
- **IAM Access Analyzer:** finds resources shared with **external** entities (S3 buckets, roles, KMS keys, Lambda functions, Secrets Manager secrets and more), unused access, and validates policies.
- **Last accessed information:** shows unused users, roles, permissions and credentials, so you can trim them.
- **S3:** new buckets and objects are **not public by default**; **Block Public Access** overrides policies and ACLs; ACLs are **disabled by default** (Object Ownership "Bucket owner enforced"), so access is managed with IAM policies and bucket policies.

---

## Watch out

- **Groups have no credentials.** Rule: groups organize permissions, users and roles authenticate.
- **Workload on AWS needs AWS access: role.** Rule: never embed access keys in code or on an instance.
- **Explicit deny wins.** Rule: one deny anywhere beats any number of allows.
- **Root-only list.** Rule: account name and Support plan changes are no longer on it; closing a standalone account and MFA Delete are.
- **Identity Center vs Cognito.** Rule: your employees into AWS accounts is Identity Center; your app's customers is Cognito.
- **Secrets Manager vs Parameter Store.** Rule: "rotate automatically" means Secrets Manager.

---

## Quick check

1. An EC2 app needs to read S3. **Attach an IAM role to the instance.**
2. A partner account needs read access to one bucket for a week. **A cross-account IAM role with a trust policy for that account.**
3. Can you change the account name without the root user? **Yes, with IAM permissions.**
4. Where does a mobile game get temporary AWS credentials for guests? **Amazon Cognito identity pools.**
5. Which tool shows that a KMS key is shared with an outside account? **IAM Access Analyzer.**

---

## Official documentation

- [What is IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)
- [Tasks that require root user credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-tasks.html)
- [IAM security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [MFA in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa.html)
- [What is IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [What is Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html)
- [What is AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
