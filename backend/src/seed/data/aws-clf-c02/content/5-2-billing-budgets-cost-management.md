---
version: 1.0
updatedAt: 2026-11-21
---
# Billing, Budgets and Cost Management: Budgets, Cost Explorer, CUR, Tags, Pricing Calculator and Organizations

> Exam domain: **Billing, Pricing, and Support (12%)**, task statement 4.2 *Understand resources for billing, budget, and cost management*.

---

## What the exam wants

The guide lists **billing support and information**, **pricing information for services**, **AWS Organizations**, **cost allocation tags**, and the skills to use **AWS Budgets**, **AWS Cost Explorer**, the **AWS Pricing Calculator**, **consolidated billing and cost allocation**, and the **types of cost allocation tags and their relation to billing reports** such as the **AWS Cost and Usage Report**. The questions are almost all "which tool does this job", so the decision table below is the core of the lesson.

---

## Which cost tool answers which question

| Question you are asked | Tool | When in the life cycle |
|------------------------|------|------------------------|
| "What will this design cost per month before we build it?" | **AWS Pricing Calculator** | Before deploying |
| "Warn me when actual or forecasted spend passes a threshold" | **AWS Budgets** | While running, ahead of the bill |
| "Which services drove last quarter's increase? What is next month's forecast?" | **AWS Cost Explorer** | After the fact, visual analysis |
| "Give me every line item, hourly, by resource and tag, for my own queries" | **AWS Cost and Usage Report (CUR)** | After the fact, raw data in S3 |
| "How much have we spent so far this month?" | **Billing and Cost Management home page** | At a glance |
| "Split the bill by project or department" | **Cost allocation tags** (activated) | Feeds Cost Explorer and CUR |
| "Which instances are oversized or idle?" | **AWS Compute Optimizer** (also Trusted Advisor cost checks) | While running |

AWS Cost Anomaly Detection (not named in the exam guide) uses machine learning to alert on unusual spend.

---

## Billing and Cost Management home page

The console home page shows widgets such as **Cost summary** (month-to-date cost, the same period last month, and the forecasted total for this month), Cost monitor, Cost breakdown (last six months by service, Region, member account or tag), Recommended actions and Savings opportunities. It is the quickest answer to "what have we spent so far this month". Its data comes from Cost Explorer.

---

## AWS Budgets

- Six budget types: **cost**, **usage**, **RI utilization**, **RI coverage**, **Savings Plans utilization** and **Savings Plans coverage**.
- Alerts on **actual** or **forecasted** amounts, sent by **email**, an **Amazon SNS topic**, or both. Utilization and coverage budgets alert when you fall **below** a target.
- **Budget actions** can respond automatically, for example by applying an IAM policy or an SCP that denies launching more resources.
- Budget data is refreshed up to three times a day, so an alert can arrive after the threshold has already been passed.
- Monitoring budgets are free; action-enabled budgets beyond the first two per month have a small daily cost (as of 2026-11-21).

```json
{
  "BudgetName": "team-data-monthly",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "BudgetLimit": { "Amount": "4000", "Unit": "USD" }
}
```

---

## AWS Cost Explorer

- Visualizes and filters costs and usage by service, account, Region, tag and more.
- Shows up to the **last 13 months**, the current month, and a **forecast for the next 18 months** (as of 2026-11-21; one setup page still says 12 months).
- Data refreshes at least once every 24 hours.
- Gives **reservation and Savings Plans recommendations** based on your recent On-Demand usage (7, 30 or 60 days).
- You enable it by opening it in the console; once enabled it cannot be disabled. The console use is free.

---

## AWS Cost and Usage Report (CUR)

- The **most comprehensive** cost and usage data AWS provides.
- Delivered as files to an **Amazon S3 bucket you own**, at hourly, daily or monthly granularity, by product, resource and **your tags**.
- Updated at least once a day. Query it with **Amazon Athena**, load it into **Amazon Redshift**, or visualize it with **Amazon Quick**.

> Older study material says to visualize CUR data with Amazon QuickSight; the current official documentation calls the service **Amazon Quick**.

---

## Cost allocation tags

| Type | Prefix | Created by |
|------|--------|-----------|
| **AWS-generated** | `aws:` (for example `aws:createdBy`) | AWS |
| **User-defined** | `user:` | You |

- Both types must be **activated** in the Billing console before they appear in Cost Explorer and billing reports. A newly activated tag can take up to 24 hours to show.
- Only the **management account** of an organization (or a standalone account) can activate them.
- Tags are labels. They do not stop resources and do not change prices; they let Cost Explorer and the CUR break costs down by project, team or environment.
- **Cost Categories** group costs with rules (accounts, tags, services) when tags alone are not enough.

---

## AWS Pricing Calculator

- A free, web-based planning tool (calculator.aws) to **estimate** the cost of a planned architecture; no AWS experience is needed.
- Estimates can be grouped, shared by link, and exported as **CSV or PDF**.
- The result is an **estimate, not a quote**: it excludes taxes, and if it differs from a service's pricing page, the pricing page wins.

---

## AWS Organizations and consolidated billing

```text
            Management account  (pays the whole bill, the payer)
             /         |          \
   OU: Prod       OU: Dev       OU: Sandbox
   member accts   member accts  member accts
```

- Every organization has one **management account**, which has the role of the **payer account** and pays the charges of all member accounts. It cannot be changed to another account.
- **Consolidated billing** benefits: one bill, per-account tracking, **combined usage** for volume pricing tiers, and **shared RI and Savings Plans discounts**, at no extra charge.
- Feature sets: **All features** (the default, with policies such as SCPs) or **Consolidated billing** only.
- AWS Support fees are calculated **per member account**. Buying a paid plan in one account does not cover the whole organization.
- Consolidated billing shows cost **per account**. To split cost **inside** an account by project, use cost allocation tags.

---

## Pricing information and AWS Marketplace on the bill

- Each service has a public **pricing page**; the Pricing Calculator uses the same price list.
- **AWS Marketplace** purchases (third-party software, SaaS, AMIs, data products) are charged on your **AWS bill**, so they show up in your cost tools. Sellers can offer free trials, hourly, monthly, annual or multi-year pricing, BYOL, and private offers with custom terms.
- **AWS License Manager** tracks software licenses (including BYOL and licenses bought in Marketplace) across accounts and can enforce limits.

---

## Watch out

- **Budgets alerts and can act; it does not shut down resources unless you configure a budget action.** Cost Explorer and the CUR never act.
- **Before vs after:** the Pricing Calculator estimates before you build; Cost Explorer and the CUR look back; Budgets watches the future against a threshold.
- **The Pricing Calculator is an estimate,** not a binding price, and excludes taxes.
- **Management account, not "master account".** The management account is the payer. "Consolidated billing" is a feature set of Organizations, not an old name for it.
- **Tags must be activated** before they show in billing reports, and only the management account can do it.
- **Consolidated billing does not upgrade support** for member accounts, does not raise service quotas, and does not split cost by project.
- **RI and Savings Plans utilization or coverage targets** are AWS Budgets types. They alert when you fall below the target, not above it.

---

## Quick check

1. Finance wants an email when the **forecasted** monthly cost for a team will exceed USD 8,000. **AWS Budgets, cost budget with a forecasted alert.**
2. Analysts want hourly line-item cost data in S3 to query with Athena. **AWS Cost and Usage Report.**
3. EC2 and S3 costs in one account must be split by department. **Activate user-defined cost allocation tags and group by tag.**
4. Three accounts pay separately and one holds unused Reserved Instances. What lowers cost with no re-architecture? **Join them in an AWS Organization with consolidated billing.**
5. How far back can Cost Explorer show costs? **Up to 13 months, plus the current month.**

---

## Official documentation

- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- [AWS Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
- [AWS Cost and Usage Report](https://docs.aws.amazon.com/cur/latest/userguide/what-is-cur.html)
- [Cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
- [AWS Pricing Calculator](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html)
- [Consolidated billing for AWS Organizations](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/consolidated-billing.html)
- [AWS Organizations terminology and concepts](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html)
- [Billing and Cost Management home page](https://docs.aws.amazon.com/cost-management/latest/userguide/view-billing-dashboard.html)
