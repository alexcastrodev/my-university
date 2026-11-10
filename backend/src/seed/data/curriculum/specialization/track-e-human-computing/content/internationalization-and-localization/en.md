---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Separate internationalization from localization, and say which work belongs to each.
- Format dates and numbers with `Intl`, with `timeZone` fixed and the CLDR version named, and explain why tests must not compare those strings literally.
- Select plural forms through CLDR categories, including a language with six categories, and explain why `one` does not mean "the number 1".
- Predict how the bidirectional algorithm orders mixed text, and isolate inserted text with markup.
- Use a sourced figure for text expansion with its limits, and test layout instead of trusting the figure.

## Context & Motivation

`accessibility-and-wcag` required the language of a page to be programmatically determined (3.1.1, Level A), and of passages within it (3.1.2, Level AA). That is the smallest piece of a larger problem. An interface that assumes English word order, one plural form, month-first dates, and left-to-right layout carries those assumptions into every string and stylesheet. Removing them late means changing code, because they do not live in a translation file.

## Core Theory

### Two words, two jobs

The W3C gives working definitions and admits that "Everyone has their own preferred definitions". **Localization** (l10n) is "the adaptation of a product, application or document content to meet the language, cultural and other requirements of a specific target market (a locale)". **Internationalization** (i18n) is "the design and development of a product, application or document content that enables easy localization for target audiences that vary in culture, region, or language."

So i18n is engineering done once: separating strings from code, using locale-aware formatting, and building layouts that survive other text and directions. L10n is repeated per locale: translation, but also formats, examples, images, and references that do not travel.

A locale is more than a language. Later examples show `pt` and `pt-PT` differing on plural rules, and `ar-EG` and `ar-AE` differing on digits.

### CLDR, ICU, and Intl

**Unicode CLDR** is the data: plural rules, date patterns, separators, and names, per locale. **ICU** is a library that applies such data. JavaScript's `Intl` is the interface a programmer sees, and Node.js reports what it embeds. All output below comes from this run:

```text
node 22.14.0   icu 76.1   cldr 46.0   unicode 16.0
```

The version matters because locale data changes between releases, and a string that was right under one CLDR can differ under the next. Two rules follow. Always pass `timeZone` when the output is a date, since the default is the machine's. And avoid asserting a formatted string letter by letter in a test unless the runtime is pinned: check structure with `formatToParts`, or compare with a formatter built the same way.

### Plural categories

CLDR defines six categories: `zero`, `one`, `two`, `few`, `many`, and `other`, with `other` always required. Its documentation warns: "These categories are only mnemonics". The name does not state the content. In the CLDR 46 chart, English `one` is `i = 1 and v = 0` (integer part 1, no visible fraction digits), while `pt` `one` is `i = 0..1`, which includes 0 and 1.5. Example 3 runs these rules.

### Messages are single units

ICU's guidance is that "a message has to be written and translated as a single unit", because translators cannot rearrange concatenated fragments. It also recommends putting a plural or select argument at the outermost level and writing full sentences inside it. So `"Selected " + n + " " + noun` is an i18n defect even when every word is translated.

### Bidirectional text

Text is stored in **logical order**, the order of reading, and displayed in **visual order**. The Unicode Bidirectional Algorithm (UAX #9) computes the second from the first. Letters are strongly typed: Hebrew and Arabic letters are right-to-left, and Latin letters left-to-right. Punctuation and spaces are neutral, and numbers are weak, so both take a direction from their surroundings. The **base direction** of the block, set in HTML by `dir`, decides how runs are ordered and where neutrals at the edges land.

W3C guidance reduces to a few rules:

- Set `dir="rtl"` on `html` for right-to-left pages. "Never use CSS to apply the base direction."
- Use `dir="auto"` on text supplied at run time, or wrap it in `<bdi>`. Either isolates it from its neighbors and takes the direction from its first strong character.
- Use logical CSS values and properties, such as `margin-inline-start` and `text-align: start`.

Isolation matters most for data: a user name or a product title of unknown direction, inserted in a sentence (Example 4).

### Mirroring

An RTL layout is, broadly, the mirror of an LTR layout, but not everything flips. Firefox's RTL guidelines mirror back and forward buttons and progress bars, and do not mirror text, numbers, checkmarks, video and audio controls, or product logos. Material Design's legacy guidance adds that clocks still turn clockwise, so a clock or a clockwise refresh icon stays as it is. Those are two products' rules, useful as a checklist but not a standard.

### Text expansion

The W3C article "Text size in translation" gives one measured example and one table. In a Flickr interface, English "views" (5 letters) became Portuguese "visualizações" (13, ratio 2.6) and Italian "visualizzazioni" (15, ratio 3). It then reports average rates that it attributes to IBM's *Guidelines to design global solutions*, for English into European languages:

| Characters in English source | Average expansion |
|---|---|
| Up to 10 | 200 to 300% |
| 11 to 20 | 180 to 200% |
| 21 to 30 | 160 to 180% |
| 31 to 50 | 140 to 160% |
| 51 to 70 | 151 to 170% |
| Over 70 | 130% |

Read these carefully. The article uses "300%" for a ratio of 3, so the figures read as translated length over source length: "200%" means double, not triple. The table is not monotonic at 51 to 70, so it is a rough guide. The useful part is the shape: short strings grow most, and short strings are the ones in tight buttons and tabs.

## Worked Examples

### Example 1: one instant, several dates

```js
const t = new Date('2026-03-04T15:30:00Z');
new Intl.DateTimeFormat(l, { dateStyle: 'short', timeZone: 'UTC' }).format(t);
```

```text
en-US  3/4/26                                 gregory
en-GB  04/03/2026                             gregory
pt-BR  04/03/2026                             gregory
de-DE  04.03.26                               gregory
ja-JP  2026/03/04                             gregory
th-TH  4/3/69                                 buddhist
fa-IR  \u{6F1}\u{6F4}\u{6F0}\u{6F4}/\u{6F1}\u{6F2}/\u{6F1}\u{6F3} persian
```

`3/4` reads as March in `en-US` and as April to a Brazilian reader of the same string, so a hand-written format fails silently. Thai defaults to the Buddhist calendar, hence year 69, short for 2569. The Persian line is shown as escapes, and it is year 1404 in Extended Arabic-Indic digits.

The same instant in `pt-BR`, changing only `timeZone`:

```text
UTC                04/03/2026, 15:30
America/Sao_Paulo  04/03/2026, 12:30
America/New_York   04/03/2026, 10:30
Asia/Tokyo         05/03/2026, 00:30
```

The calendar date itself differs in Tokyo. Omit `timeZone`, and a test passes on one machine and fails on another.

### Example 2: numbers, and invisible characters

`new Intl.NumberFormat(l).format(1234567.891)`, with non-ASCII characters escaped:

```text
en-US  1,234,567.891
pt-BR  1.234.567,891
de-CH  1\u{2019}234\u{2019}567.891
fr-FR  1\u{202F}234\u{202F}567,891
en-IN  12,34,567.891
ar-EG  \u{661}\u{66C}\u{662}\u{663}\u{664}\u{66C}\u{665}\u{666}\u{667}\u{66B}\u{668}\u{669}\u{661}
ar-AE  1,234,567.891
```

Grouping is not always by thousands (`en-IN`), and the separator can be a narrow no-break space (`fr-FR`). Arabic is not one format: `ar-EG` uses Arabic-Indic digits and `ar-AE` Latin ones. The currency case hides a trap, for 1234.5:

```text
en-US USD $1,234.50                 en-US BRL R$1,234.50
pt-BR BRL R$\u{A0}1.234,50          pt-BR USD US$\u{A0}1.234,50
de-DE EUR 1.234,50\u{A0}\u{20AC}    ja-JP JPY \u{FFE5}1,235
```

The space after `R$` is U+00A0, so the formatted value compared with the literal `'R$ 1.234,50'` with an ordinary space gives `false`. Formatting does not convert money: `pt-BR` with USD is the same number in dollars, written the Brazilian way. The currency also sets the digits, and JPY rounds to 1,235.

### Example 3: more plural forms than English

```text
en     one other
pt     many one other
pt-PT  many one other
pl     few many one other
ar     few many one two zero other
ja     other
```

Arabic has all six categories, and Japanese has one. `select(n)` on `Intl.PluralRules` gives:

```text
n        en     pt     pt-PT  pl     ar
0        other  one    other  many   zero
1        one    one    one    one    one
2        other  other  other  few    two
5        other  other  other  many   few
12       other  other  other  many   many
22       other  other  other  few    many
102      other  other  other  few    other
1.5      other  one    other  other  other
1000000  other  many   many   many   other
```

Three things stand out. `pt` puts 0 and 1.5 in `one`, and `pt-PT` does not, so an `if (n === 1)` branch disagrees with CLDR for `pt` even in a two-form message. Polish depends on the last digits: 22 and 102 are `few`, but 12 is `many`. Display matters in English too: `select(1)` gives `one`, but with `minimumFractionDigits: 1`, which displays "1.0", it gives `other`.

An ICU message carries the forms. This run used `intl-messageformat` 12.1.4, with CLDR's own Polish forms for "month":

```text
{n, plural, one {# miesiąc} few {# miesiące} many {# miesięcy} other {# miesiąca}}
1 miesiąc | 2 miesiące | 5 miesięcy | 12 miesięcy | 22 miesiące | 102 miesiące | 1,5 miesiąca
```

A message with only `one` and `other`, as an English source would have, fails without an error, because every missing category falls to `other`:

```text
{n, plural, one {# miesiąc} other {# miesiące}}
1 miesiąc | 2 miesiące | 5 miesiące | 12 miesiące | 22 miesiące
```

Here 5 and 12 are wrong. As ICU's documentation notes, the translation system and the translator must add the categories the target language needs.

### Example 4: bidirectional text, measured

Hebrew shown directly in this lesson would be reordered by your own browser, so the letters are named. The strings used real Hebrew (alef, bet, gimel, U+05D0 to U+05D2) in Chrome 156. Each character's horizontal position was read with a DOM `Range`, and sorting by position gives the visual order, left to right.

```text
markup                       logical order        visual order, left to right
<p dir=ltr>                  alef bet gimel - 3   3 - gimel bet alef reviews
                             reviews
<p dir=ltr><bdi>..</bdi>     alef bet gimel - 3   gimel bet alef - 3 reviews
                             reviews
<p dir=rtl>                  Hello!               !Hello
<p dir=ltr>                  Hello!               Hello!
<p dir=ltr>                  alef bet gimel !     gimel bet alef !
<p dir=auto>                 alef bet gimel !     ! gimel bet alef
```

Line 1 is the classic defect in "`name` - `count` reviews": the number joins the Hebrew run and jumps to the left of the name. This is what the W3C calls a spillover effect, and `<bdi>` removes it (line 2). Lines 3 and 4 show that base direction moves the neutral "!": the stored string is identical. In the last two lines, a right-to-left string in an `ltr` block gets its "!" on the wrong side, and `dir="auto"` fixes that by taking `rtl` from the first strong character.

### Example 5: layout, sorting, and case

A page with `dir="rtl"`, in a 400px body, holding two 100px boxes:

```text
margin-left: 16px           box spans 700..800   (flush against the right edge)
margin-inline-start: 16px   box spans 684..784   (16px from the start edge)
```

In `ltr` both span 16..116, so the bug is invisible until RTL. Under `dir="rtl"`, `display: flex` also reversed its children with no change of CSS.

For expansion, a 64px button with `white-space: nowrap` holding each string gave a `clientWidth` and `scrollWidth` of 64 and 64 for "views", and 64 and 79 for "visualizações", in Chrome's default sans-serif at 16px. Comparing those two properties is an automatic overflow check, and pseudolocalization (replacing strings with longer accented versions) lets it run before any translation exists.

Sorting and case need the locale too:

```text
sort()  Apfel Zebra Ärger Öl
de      Apfel Ärger Öl Zebra
sv      Apfel Zebra Ärger Öl
sort()  casa dado Ávila água
pt      água Ávila casa dado
```

German and Swedish order the same words differently, and the default `sort()` compares UTF-16 code units, which puts "água" after "dado". Case mapping also varies: `'i'.toUpperCase()` gives `I`, and `'i'.toLocaleUpperCase('tr')` gives `İ`.

## Common Misconceptions & Pitfalls

- **"i18n means translating the strings."** Translation is l10n. i18n is what makes translation possible without changing code.
- **"`one` means the number 1."** In `pt` it also covers 0 and 1.5.
- **"Two forms are enough for a plural."** Polish and Arabic need more, and missing forms fail silently.
- **"RTL means flipping the whole page."** Numbers, media controls, and clocks stay, and the rule differs by object.
- **"Text grows 30 percent."** That fits only the longest row of the table above. Short strings can reach 300 percent of the source.
- **"The `Intl` output is a constant."** It depends on the CLDR version, so name the version and do not hard-code it in tests.

## Summary

Internationalization removes assumptions from the code, and localization adapts the result for each locale. CLDR supplies the data, ICU applies it, and `Intl` exposes it, so outputs depend on the CLDR version and must not be pinned as literals. Fix `timeZone` in dates, and expect no-break spaces in formatted numbers. Plural forms come from categories that are mnemonics: Arabic uses six, Polish depends on final digits, and Brazilian `one` includes 0 and 1.5. The bidirectional algorithm reorders logical text at display time, and inserted data needs isolation with `<bdi>` or `dir="auto"`. Expansion figures are rough, IBM's table as reported by the W3C covers English into European languages, and an overflow check tells you more than a percentage.

## Documentation Links

- [W3C: Localization vs. Internationalization](https://www.w3.org/International/questions/qa-i18n): the working definitions of both terms.
- [W3C: Text size in translation](https://www.w3.org/International/articles/article-text-size): the Flickr example and the IBM expansion table.
- [W3C: Unicode Bidirectional Algorithm basics](https://www.w3.org/International/articles/inline-bidi-markup/uba-basics): base direction, directional runs, and character types.
- [W3C: Inline markup and bidirectional text in HTML](https://www.w3.org/International/articles/inline-bidi-markup/): `bdi`, `dir="auto"`, and spillover effects.
- [W3C: Structural markup and right-to-left text in HTML](https://www.w3.org/International/questions/qa-html-dir): where to set `dir`, and logical CSS.
- [Unicode: UAX #9, Unicode Bidirectional Algorithm](https://www.unicode.org/reports/tr9/): the normative algorithm.
- [Unicode CLDR: Plural Rules](https://cldr.unicode.org/index/cldr-spec/plural-rules): the six categories and how they are defined.
- [Unicode CLDR 46: Language Plural Rules chart](https://www.unicode.org/cldr/charts/46/supplemental/language_plural_rules.html): the rules per language, with examples.
- [ICU User Guide: Formatting Messages](https://unicode-org.github.io/icu/userguide/format_parse/messages/): messages as single units, and plural arguments.
- [MDN: Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules): the API used in Example 3.
- [Mozilla: Firefox RTL Guidelines](https://firefox-source-docs.mozilla.org/code-quality/coding-style/rtl_guidelines.html): what one product mirrors and what it does not.
- [Material Design (legacy): Bidirectionality](https://m1.material.io/usability/bidirectionality.html): mirroring rules, including clocks and media controls.
