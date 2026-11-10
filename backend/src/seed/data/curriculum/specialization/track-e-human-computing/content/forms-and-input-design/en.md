---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Sort form advice into measured evidence, normative requirement, and convention.
- State what the studies on label position and inline validation measured, with their limits.
- Separate what `type`, `inputmode`, `autocomplete`, and `pattern` each do in a browser.
- Choose defaults that help without steering people into a wrong answer.
- Write error messages that meet WCAG 2.2, and say what an automated checker cannot verify.

## Context & Motivation

`navigation-menus-windows-and-information-architecture` gets people to the right place, and a form is often what they find there. Form advice is unusually confident and unusually thin on evidence: much of it descends from a handful of small studies, some of which contradict one another. Keep three things apart:

- **Evidence:** a study measured it, under stated conditions.
- **Requirement:** a specification or WCAG says so, and that settles what conformance means, not what is fastest.
- **Convention:** experienced practitioners agree, and users may expect it, but nobody measured it.

## Core Theory

### Labels

Every input needs a label. WCAG 2.2 Success Criterion 3.3.2, Labels or Instructions (Level A), reads: "Labels or instructions are provided when content requires user input." In HTML, that means a `<label for="id">`.

**Position.** The study behind most advice is Penzo (2006), an eye-tracking comparison of forms with labels left-aligned, right-aligned, and above the field, with expert and novice users. The article does not give the number of participants, and warns that the "ad-hoc test setup didn't resemble real-world conditions". The typical eye movement from label to field took about 500 ms for left-aligned labels, about 170 ms (experts) to 240 ms (novices) for right-aligned, and 50 ms for labels above. Right alignment cut fixations and completion times nearly in half compared with left alignment.

Bargas-Avila et al. (2010) turned this into Guideline 5: place labels above fields to fill in a form as fast as possible, citing Penzo. They also report Wroblewski's advice to use left-aligned labels for unfamiliar data, where you want people to slow down. Seckler et al. (2014) then tested the 20 guidelines on three real news-site forms, with 65 participants split between original (32) and improved (33) versions. The improved forms needed fewer submission attempts on all three, and were significantly faster on two. But all guidelines changed at once, so this says nothing about labels alone. Grade the rule as weak evidence and strong convention.

**Placeholders are not labels.** Sherwin (2014, NN/g) reports from user testing that placeholders in place of labels strain memory, because the hint disappears on typing, and stop people from checking their work before submitting. She allows that this matters less on forms of one or two fields. GOV.UK adds that not all screen readers read placeholders and that browser default styles often fail contrast.

### Four attributes, four jobs

| Attribute | What it does | What it does not do |
|---|---|---|
| `type` | Sets semantics, built-in validation, and control | Guarantee a useful keyboard on every device |
| `inputmode` | Hints which virtual keyboard to show | Validate anything |
| `autocomplete` | Names the data, for autofill | Validate, or replace the label |
| `pattern` | Adds a regular-expression constraint | Change the keyboard or explain itself to the user |

MDN states that `inputmode` "doesn't cause any validity requirements to be enforced on input". The HTML specification says `type=number` "is not appropriate for input that happens to only consist of numbers but isn't strictly speaking a number", naming credit card numbers and US postal codes, and suggests asking whether a spinbox would make sense. GOV.UK moved from `type="number"` to `<input type="text" inputmode="numeric" pattern="[0-9]*">` in 2020. Its reasons were accessibility and behavior findings: problems with Dragon and NVDA, letters silently discarded, and values changed by the scroll wheel, even though its 2017 user research had not flagged major issues. Its current text input example sets `inputmode="numeric"` with no `pattern`.

For `tel`, the specification "does not enforce a particular syntax", on purpose. For `email`, it defines its own syntax as a "willful violation" of RFC 5322.

`autocomplete` values are a fixed list in the specification, such as `name`, `email`, `postal-code`, `new-password`, and `one-time-code`. WCAG SC 1.3.5, Identify Input Purpose (Level AA), requires that the purpose of fields collecting information about the user can be programmatically determined, where the technology supports it.

### Defaults

The evidence here is indirect, and from a different domain. Nielsen (2005) reports a Cornell study of search results: 42% of users clicked the top hit, and after the top two hits were secretly swapped, 34% still clicked the top one. People lean on what is presented first, but that is a search page and not a form. His form advice, to pre-populate with the most common value, is an argument: those who must change it would have had to type it anyway. Treat that as convention. A default is also a statement the user may not notice, so be wary of it for answers with consequences, such as consent, where a wrong silent value costs more than one extra click.

Two rules are firmer. WCAG SC 3.3.7, Redundant Entry (Level A), requires information already given in the same process to be auto-populated or available to select, with exceptions. Bargas-Avila's Guideline 15 and GOV.UK's pattern also forbid clearing completed fields after an error.

### When to validate

Here the sources disagree, and you should know that they do.

**Against immediate feedback.** Bargas-Avila et al. (2007) ran two studies, with 77 and 90 participants, and report that showing erroneous fields after the whole form works best and that immediate feedback performed worst, with users often ignoring messages. They propose that people are in either Completion or Revision mode, and are less disposed to fix mistakes during Completion. Their 2010 chapter adds that errors shown on leaving a field led to significantly more errors.

**For inline feedback.** Wroblewski (2009), with the firm Etre, tested 22 users, ages 21 to 49, on six versions of a registration form, one validating only on submit. The best inline version, against that control, gave a 22% increase in success, 22% fewer errors, 31% higher satisfaction, 42% lower completion time, and 47% fewer eye fixations. These figures compare one best variant with the control, and no statistical tests are given. Only 30% to 50% of participants saw messages for easy fields, against 80% to 100% for username and password, and green checks on a name confused people. Validating after a field beat validating during typing by seven to ten seconds, and showing messages from the moment of focus gave longer times, more errors, and worse satisfaction.

**The guidance splits the same way.** Krause (2019, NN/g): "Ideally, all validation should be inline". GOV.UK: "Do not validate when the user moves away from a field." The two experiments used different forms, so neither overturns the other.

**What these sources agree on.** Do not show an error before the person has finished the field. Wroblewski measured the harm, and Krause and GOV.UK both advise against it. The case for live feedback is strongest for answers a person cannot know in advance, such as whether a username is free, though GOV.UK wants user research to justify even that. And client checks are never enough: GOV.UK notes that server side validation is always needed, since the user can bypass the client or JavaScript can fail to load.

### Error messages

WCAG SC 3.3.1, Error Identification (Level A), requires that "the item that is in error is identified and the error is described to the user in text." SC 3.3.3, Error Suggestion (Level AA), requires suggesting a correction when one is known, unless that would jeopardize security or purpose. A red border alone fails the first.

Messages can simply be ignored. On the Süddeutsche form in Seckler et al., 14 consecutive errors in the original condition were resubmissions with no corrections, against none in the improved one, with all guidelines changed at once. Wording is mostly convention, and it conflicts. Bargas-Avila's Guideline 14 says messages should be polite and eventually apologize. GOV.UK says not to use "sorry" or "please". Both agree the message must say what is wrong and how to fix it, and GOV.UK rejects generic text such as "This field is required".

### Evidence or convention

| Advice | Grade |
|---|---|
| Every field has a label | Requirement (SC 3.3.2) |
| Labels above fields are fastest | Weak evidence (Penzo), strong convention |
| Do not replace labels with placeholders | Practitioner research, GOV.UK guidance |
| No error before the field is finished | Measured and widely agreed |
| Inline after each field, or all on submit | Contested |
| Message says what is wrong, in text | Requirement (SC 3.3.1) |
| Apologize in error messages | Convention, sources conflict |

## Worked Examples

### Example 1: a delivery form

```html
<form method="post" action="/entrega">
  <label for="nome">Nome completo</label>
  <input id="nome" name="nome" type="text" autocomplete="name" required>

  <label for="email">E-mail</label>
  <input id="email" name="email" type="email" autocomplete="email" required>

  <label for="tel">Celular com DDD</label>
  <input id="tel" name="tel" type="tel" autocomplete="tel" required>

  <label for="cep">CEP</label>
  <p id="cep-hint">8 dígitos, com ou sem hífen</p>
  <input id="cep" name="cep" type="text" inputmode="numeric"
         autocomplete="postal-code" pattern="[0-9]{5}-?[0-9]{3}"
         aria-describedby="cep-hint" required>

  <button>Continuar</button>
</form>
```

The CEP is a code, so it uses `type="text"`: a leading zero matters, and a spinbox makes no sense. The usual `pattern="[0-9]*"` would reject `01310-100`, which is how Brazilians write it, so the pattern accepts both forms, in the spirit of GOV.UK's advice to accept unambiguous variations. In Chrome 156, `01310-100` and `01310100` are valid, while `01310 100`, `0131`, and `abcde-fgh` give `patternMismatch`. GOV.UK's advice goes further: ignore such stray characters on the server. GOV.UK turns off native validation with `novalidate`, so `required` here is a choice, not a rule.

### Example 2: what the browser actually enforces

Typing with real key events into each input, in headless desktop Chrome 156:

```text
input                      typed                value kept            validity
type=number                12a                  "12"                  valid (a dropped silently)
type=number                1e                   ""                    badInput
type=number                007                  "007"                 valid, number 7
type=number                1234567890123456789  same, then ArrowUp    "1.23456789012345678e+18"
type=email                 ana@                 "ana@"                typeMismatch
type=email                 ana@b                "ana@b"               valid
type=tel                   banana               "banana"              valid
text + inputmode=numeric   abc                  "abc"                 valid
inputmode + pattern [0-9]* 12a                  "12a"                 patternMismatch
```

A silently dropped letter gives no feedback. `ana@b` passes, so a valid `type=email` does not mean a deliverable address. `tel` and `inputmode` validate nothing. The up arrow turned a long identifier into exponential notation, the same failure GOV.UK reported for Chrome 79. The virtual keyboard cannot be tested on a desktop: check it on real devices.

### Example 3: what axe cannot see

Running axe-core 4.14 on small pages in the same browser:

```text
markup                                   axe violations
<label for> + input                      none
input with placeholder only              none
input with no name at all                label
autocomplete="e-mail" (invalid token)    autocomplete-valid
aria-invalid + red border, no message    none
```

The placeholder-only input passes because axe accepts a placeholder as a name, even though the Sherwin and GOV.UK objections still apply. The red-border case passes although it fails SC 3.3.1, since axe cannot know that no error text exists. Example 1 also has zero violations, which shows that it passed the checks axe can run, not that it conforms. A pass is a floor.

### Example 4: choosing a timing, field by field

In Chrome 156, a required email field matched `:invalid` from page load but `:user-invalid` only after the user typed and left it:

```text
state                      :invalid   :user-invalid
page load                  true       false
typing "an", still focused true       false
after leaving the field    true       true
after fixing               false      false
```

So `input:user-invalid` avoids the premature error, though it is on-blur timing and GOV.UK would still object. A defensible plan, as judgment and not a measured result: check name, email, and phone on submit or after the field, give live feedback on password rules and username availability, and validate everything again on the server.

## Common Misconceptions & Pitfalls

- **"Inline validation increases success by 22%."** That is one best variant against one control, with 22 people, on one registration form.
- **"Studies show labels must go on top."** One eye-tracking study with an unreported sample shows speed differences. Wroblewski's advice keeps left alignment for data you want people to consider.
- **"`type="number"` for anything with digits."** The specification says no for identifiers. Example 2 shows why.
- **"Passing axe means the form is accessible."** Example 3 shows two failures it cannot detect.
- **Rules that reject real data.** Hyphens, spaces, accents, and apostrophes in valid answers are the form's problem, not the user's.

## Summary

Labels are required, and their position rests on thin evidence. `type` sets semantics and validation, `inputmode` only hints a keyboard, `autocomplete` names the data, and `pattern` constrains it, while `type=number` is wrong for codes. The case for form defaults is an argument by analogy, not a direct measurement, so be careful with consequential answers. Studies conflict on inline versus submit-time validation, but these sources agree on not reporting an error before the field is finished, and the server must always check. Errors must be identified in text, and a clean axe run does not prove that they are.

## Documentation Links

- [Wroblewski (2009): Inline Validation in Web Forms](https://alistapart.com/article/inline-validation-in-web-forms/): the Etre study of six form variants with 22 users.
- [Bargas-Avila et al. (2007): Usable Error Message Presentation](https://edoc.unibas.ch/8009/): repository record with the abstract of the two studies.
- [Bargas-Avila et al. (2010): Introducing 20 Guidelines for Usable Web Form Design](https://www.intechopen.com/chapters/10814): open chapter with the review and the guidelines.
- [Seckler et al. (2014): Designing Usable Web Forms](https://research.google.com/pubs/archive/42513.pdf): eye-tracking test of the 20 guidelines with 65 participants.
- [Penzo (2006): Label Placement in Forms](https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php): eye-tracking comparison of label positions.
- [Sherwin (2014): Placeholders in Form Fields Are Harmful](https://www.nngroup.com/articles/form-design-placeholders/): why placeholders fail as labels.
- [Krause (2019): 10 Design Guidelines for Reporting Errors in Forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/): practitioner guidance on error flows.
- [Nielsen (2005): The Power of Defaults](https://www.nngroup.com/articles/the-power-of-defaults/): the search study and advice on form defaults.
- [GOV.UK Design System: Validation](https://design-system.service.gov.uk/patterns/validation/): timing, server checks, and `novalidate`.
- [GOV.UK Design System: Text input](https://design-system.service.gov.uk/components/text-input/): numbers, `inputmode`, and placeholders.
- [GOV.UK Design System: Error message](https://design-system.service.gov.uk/components/error-message/): wording rules.
- [Laakso (2020): Why the GOV.UK Design System team changed the input type for numbers](https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/): field problems with `type=number`.
- [WHATWG HTML: The input element](https://html.spec.whatwg.org/multipage/input.html): `number`, `email`, and `tel`.
- [WHATWG HTML: Form control infrastructure](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html): autofill field names.
- [MDN: inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode): values and the absence of validation.
- [MDN: :user-invalid](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:user-invalid): matching after user interaction.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): the normative text of the success criteria cited.
