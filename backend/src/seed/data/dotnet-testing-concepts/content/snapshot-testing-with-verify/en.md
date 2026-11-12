---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Some outputs are too big to assert one property at a time: an invoice with a
dozen fields, an HTML page, an error with a type, a message and a parameter
name. A snapshot test records the whole output in a file, and the next run
compares the output with the file. Verify is the usual library for that in .NET.
The idea is old and simple; the work is in three details: scrub what changes on
every run, read the file before approving it, and know which rules a snapshot
must never be trusted with. This concept also covers the license of Verify 33,
because a project that references it fails to build until it declares something.
Versions measured: `Verify.MSTest` 32.0.0 and 33.3.4, `MSTest` 4.5.3, on the .NET 10.0.100 SDK and the
.NET 11.0.100 SDK. No Docker was used.

## Use Cases

- Checking a payload that has many fields: an invoice, an API response, a generated SQL statement.
- Checking rendered text, such as HTML from a view or a Blazor component, in a file an editor can show.
- Checking the exact type, message and parameter name of an exception in one place.
- Putting a safety net around code nobody has tests for before changing it.

## Deep Dive

### What one snapshot test is

The lab has an `InvoiceService` that turns an order into an `Invoice` with a new
`Guid`, the current time, a number built from both, the lines and the tax. The
test:

```csharp
[TestClass]
[UsesVerify]
public partial class InvoiceSnapshotTests
{
    [TestMethod]
    public Task TheInvoiceObjectIsTheSnapshot()
    {
        var invoice = new InvoiceService().Create(Orders.Coffee());

        return Verify(invoice);
    }
}
```

`[UsesVerify]` gives Verify the MSTest `TestContext` (the lab's classes are
`partial`, as the Verify docs show). Without it the first call fails with
`TestContext is null. Ensure test class has a [UsesVerify] attribute (or inherits from VerifyBase)`.

There is no expected value in the test. The first run fails and writes
`InvoiceSnapshotTests.TheInvoiceObjectIsTheSnapshot.received.txt` next to the
source file. That file is the approval request:

```text
{
  Id: Guid_1,
  Number: INV-20261112-b4ec4736,
  IssuedAt: DateTimeOffset_1,
  Customer: Ada Lovelace,
  Lines: [
    { Product: Coffee, Quantity: 3, UnitPrice: 0.50, Total: 1.50 },
    ...
  ],
  Subtotal: 5.50,
  Tax: 1.05,
  Total: 6.55,
  Note: Deliver to the back door
}
```

(The real file puts each property on its own line.) When you agree with it,
rename `.received.txt` to `.verified.txt`. From then on the test is green while
the output is identical, and red with a new `.received` file when it is not.
Commit the `.verified` files. Ignore `*.received.*`. Per the Verify docs, a diff
tool installed on the machine opens on failure; `DiffEngine_Disabled=true` turns
that off for CI.

### Scrubbers: what changes on every run

Look at the file above. `Id` is `Guid_1` and `IssuedAt` is `DateTimeOffset_1`
without any code from the test: Verify replaces `Guid` and `DateTimeOffset`
values by default.
`Number` is `INV-20261112-b4ec4736`. It is a string, built from the date and 8
characters of the Guid, and Verify cannot know that. Run the test twice and the
`.received` file differs both times.

A scrubber rewrites text before the comparison. One regex, registered once for
the whole test assembly:

```csharp
public static class VerifySetup
{
    [ModuleInitializer]
    public static void Initialize() =>
        VerifierSettings.ScrubLinesWithReplace(line =>
            Regex.Replace(line, @"INV-\d{8}-[0-9a-f]{8}", "INV-{date}-{id}"));
}
```

Now `Number` is `INV-{date}-{id}` in every snapshot. For one test only, call
the same method on the `Verify(...)` result. Other scrubbers seen in the lab:
`ScrubInlineDateTimeOffsets("yyyy-MM-dd HH:mm:ss")` for a date inside text (the
HTML says `Issued 2026-11-12 09:20:11 UTC`, which is text, not a
`DateTimeOffset`), and `IgnoreStackTrace()` for exceptions.

The other way to get a stable output is to control the input: the service takes
a `TimeProvider`, so a test can pass a fake clock (the concept on controlling
time with `TimeProvider`). That fixes the date but not the `Guid`, so a scrubber is still needed here.

### Text files with their own extension

```csharp
return Verify(InvoiceHtml.Render(invoice), "html")
    .ScrubInlineDateTimeOffsets("yyyy-MM-dd HH:mm:ss");
```

The second argument is the file extension, so the files are `.received.html` and
`.verified.html`, which an editor shows as HTML and a diff tool compares line by
line. The second HTML test uses a customer called `<b>Acme & Sons</b>` and the
approved file has `&lt;b&gt;Acme &amp; Sons&lt;/b&gt;`: the reason to read the
file is exactly that nobody wrote an assertion about escaping.

### Exceptions

```csharp
return Throws(() => new InvoiceService().Create(new Order("Ada Lovelace", [])))
    .IgnoreStackTrace();
```

The snapshot is `Type: ArgumentException`, `Message: ...`, `ParamName: order`.
Without `IgnoreStackTrace()` the file also holds the stack, including the
compiler-generated name of the lambda (`<>c.<AnEmptyOrderIsRejected>b__0_0`),
which changes when the code around it changes.

### Two things that break a snapshot on another machine

The first `.received.html` of the lab had `9,90` where the output should have
`9.90`. The machine that wrote it uses a culture with a decimal comma, and
`{value:0.00}` formats with the current culture. A snapshot approved there
fails on a CI agent with another culture. The fix is in the production code
(`CultureInfo.InvariantCulture`), and the same culture made `decimal.Parse("0.50")`
throw in the first version of a test. The second is encoding and line endings:
Verify writes the files as UTF-8 with a BOM. The Verify docs recommend a `.gitattributes` with
`*.verified.txt text eol=lf working-tree-encoding=UTF-8` (and the same for
`.html`) so Git does not rewrite them between operating systems.

### Where a snapshot lies

A snapshot records what the code did, not what it should do. The lab's solution
has a rule written as plain assertions next to the snapshots: for the coffee
order the subtotal is 5.50 and the tax is 1.05 (19% of 5.50 is 1.045, rounded away
from zero), a literal worked out by hand. Then the test of the habit that ruins
snapshot suites. Set the tax rate to 0.21 in `InvoiceService`:

- 4 tests fail: the three snapshots with a tax and the hand-written assertion.
- Rename every `.received` file to `.verified`, which is what someone in a hurry
  does, and run again: 1 test fails, the hand-written assertion.

Without that assertion the wrong rate would have shipped with a green suite.
Mutating the production code one change at a time (the table is in the lab
solution) shows the two sides: removing `HtmlEncode` from the customer name is
caught only by the HTML snapshot, because nobody wrote an assertion about
escaping, and the 0.21 rate is caught by both. So use snapshots for shape, and
assertions for the rules that must hold: the total is the subtotal plus the tax
for every input, a number you computed yourself, a limit.

The mutation view of this is in the next concept, mutation testing with Stryker.NET.

### The license of Verify 33

Verify 33 and later check at build time that the project declares its Open
Source Maintenance Fee status. With nothing declared, on both SDKs:

```text
Verify.targets(172,5): SponsorCheck error SC021: No license specified. Package 'Verify' requires a SponsorCheck license property.
```

The message lists the options. They are MSBuild properties, set once in a
`Directory.Build.props` or in the test project. Per the official page, the
fee covers use of the official NuGet packages released after 1 September 2026, by
organizations that generate revenue from them (annual gross revenue of at least
US$10,000) and by government agencies. Individuals, open source projects without
revenue and organizations under the threshold are exempt. The fee is a
GitHub Sponsors tier by organization size, from US$5 per month (fewer than 40
employees) to US$100 per month (more than 1000). What I measured on Verify
33.3.4:

| Declaration | Result |
| --- | --- |
| nothing | `SC021`, build fails |
| `Verify_GitHubSponsorAccount` with the sponsoring account | builds (per the page; not run here, it needs a real sponsor) |
| `Verify_SponsorshipExemption=OpenSource` plus `Verify_SponsorshipExemptionUntil=2027-10` | builds, tests pass (`SmallRevenue` works the same, per the page) |
| the same with `...Until=2028-10` | `SC046: Exemption end date too far in the future (maximum 2027-11)` |
| `Verify_SponsorshipLicenseIgnored=true` | builds with warning `SC023`: "in breach of the package license" |

```xml
<PropertyGroup>
  <Verify_SponsorshipExemption>OpenSource</Verify_SponsorshipExemption>
  <Verify_SponsorshipExemptionUntil>2027-10</Verify_SponsorshipExemptionUntil>
</PropertyGroup>
```

An exemption has to be renewed at most every 12 months, and it is a statement
about who uses the code. Nothing is sent anywhere: the check runs inside the
build. Read the official page before choosing, since it is the source (and this is
not legal advice): [maintenance-fee.md](https://github.com/VerifyTests/Verify/blob/main/docs/maintenance-fee.md).

The lab pins `Verify.MSTest` 32.0.0, published 2026-08-26, before the fee date,
with no SponsorCheck. The reason is not the money: a public lab cannot declare
an exemption on behalf of whoever copies it, and one that expires would break
the lab in a year. Everything it teaches works the same on 33. In your own project
the choice is yours: declare, sponsor, or stay on 32.x and accept that it gets no
fixes.

## Trade-offs

- **Approving is one rename away from not reading.** The whole technique depends
  on opening the `.received` file. Example: the 0.21 tax rate above went green
  with three renames. Keep the rules that matter as assertions.
- **A big snapshot has many reasons to change.** Add a field to `Invoice` and
  every invoice snapshot changes, so a real regression hides in a diff of a
  hundred lines. Snapshot the part you care about, not the whole object.
- **A scrubber is code too.** Build the number from 6 characters of the Guid
  instead of 8 and the regex stops matching: the three snapshots fail, for a
  reason that has nothing to do with invoices.
- **Output depends on the machine.** Culture, time zone, encoding and line
  endings all show up in a text file. Pin them in the code under test or in the
  setup.
- **The version is a decision.** Verify 33 needs a declaration; 32.0.0 builds
  without one and gets no more fixes.
- **A snapshot is a bad fit for rules.** "The total is the subtotal plus the
  tax" holds for every input; a snapshot holds for one.

## Lab

The invoice service and the HTML renderer are already implemented. Your job is to write the snapshot tests, follow the received and verified workflow by hand, and then write the tests no snapshot can replace.

**What you will practice**

- Writing a Verify test, reading the `.received` file and approving it.
- Scrubbing the invoice number with one assembly-wide scrubber, and the date inside HTML text.
- Snapshotting HTML as `.verified.html` and an exception without its stack trace.
- Writing the invariants as plain assertions, and approving a wrong tax rate on purpose to see what is left red.

**Prerequisites:** MSTest Fundamentals: Lifecycle and TestContext, .NET 10 SDK.

**How it works:** the starter has 7 tests that fail with `TODO-NN`, and no `.verified` files. The solution has the files and 10 passing tests. The README of the lab explains the Verify version it pins.

## Documentation Links

- [Verify, GitHub](https://github.com/VerifyTests/Verify) (doc)
- [Open Source Maintenance Fee for Verify](https://github.com/VerifyTests/Verify/blob/main/docs/maintenance-fee.md) (doc)
- [SponsorCheck diagnostic codes (SC021, SC023, SC046)](https://github.com/SimonCropp/SponsorCheck/blob/main/docs/VerifierDiagnosticCodes.md) (doc)
- [Verify.MSTest on NuGet](https://www.nuget.org/packages/Verify.MSTest) (doc)
- [Open Source Maintenance Fee, FAQ for consumers](https://opensourcemaintenancefee.org/consumers/faq/) (doc)
