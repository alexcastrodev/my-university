---
version: 1.0
updatedAt: 2026-11-04
title: "Internacionalização e Localização"
summary: "Internacionalização versus localização, expansão de texto, layout da direita para a esquerda e regras de data, número e plural com Unicode CLDR e ICU."
---
## Objetivos de Aprendizagem

- Separar internacionalização de localização, e dizer que trabalho pertence a cada uma.
- Formatar datas e números com `Intl`, com `timeZone` fixo e a versão do CLDR nomeada, e explicar por que testes não devem comparar essas strings literalmente.
- Selecionar formas de plural pelas categorias do CLDR, incluindo um idioma com seis categorias, e explicar por que `one` não significa "o número 1".
- Prever como o algoritmo bidirecional ordena texto misto, e isolar texto inserido com marcação.
- Usar um número com fonte para expansão de texto, com seus limites, e testar o layout em vez de confiar no número.

## Contexto e Motivação

`accessibility-and-wcag` exigiu que o idioma da página fosse determinável por programa (3.1.1, Nível A), assim como o de trechos dentro dela (3.1.2, Nível AA). Essa é a menor peça de um problema maior. Uma interface que supõe ordem de palavras do inglês, uma só forma de plural, datas com o mês primeiro e layout da esquerda para a direita carrega essas suposições em cada string e folha de estilo. Removê-las tarde significa mudar código, porque elas não moram num arquivo de tradução.

## Teoria Central

### Duas palavras, dois trabalhos

O W3C dá definições de trabalho e admite que "Everyone has their own preferred definitions". **Localização** (l10n) é "the adaptation of a product, application or document content to meet the language, cultural and other requirements of a specific target market (a locale)". **Internacionalização** (i18n) é "the design and development of a product, application or document content that enables easy localization for target audiences that vary in culture, region, or language."

Assim, i18n é engenharia feita uma vez: separar strings do código, usar formatação ciente de locale e construir layouts que sobrevivem a outros textos e direções. L10n se repete por locale: tradução, mas também formatos, exemplos, imagens e referências que não viajam.

Locale é mais do que idioma. Os exemplos mostram `pt` e `pt-PT` diferindo em regras de plural, e `ar-EG` e `ar-AE` diferindo em dígitos.

### CLDR, ICU e Intl

O **Unicode CLDR** é o dado: regras de plural, padrões de data, separadores e nomes, por locale. O **ICU** é uma biblioteca que aplica esse dado. O `Intl` do JavaScript é a interface que o programador vê, e o Node.js informa o que embute. Toda saída abaixo vem desta execução:

```text
node 22.14.0   icu 76.1   cldr 46.0   unicode 16.0
```

A versão importa porque o dado de locale muda entre releases, e uma string certa num CLDR pode diferir no seguinte. Daí duas regras. Passe sempre `timeZone` quando a saída for data, pois o padrão é o da máquina. E evite conferir uma string formatada letra por letra num teste, a menos que o runtime esteja fixado: verifique a estrutura com `formatToParts`, ou compare com um formatador construído do mesmo jeito.

### Categorias de plural

O CLDR define seis categorias: `zero`, `one`, `two`, `few`, `many` e `other`, com `other` sempre exigida. Sua documentação avisa: "These categories are only mnemonics". O nome não diz o conteúdo. No quadro do CLDR 46, o `one` do inglês é `i = 1 and v = 0` (parte inteira 1, sem dígitos de fração visíveis), enquanto o `one` de `pt` é `i = 0..1`, que inclui 0 e 1,5. O Exemplo 3 roda essas regras.

### Mensagens são unidades inteiras

A orientação do ICU é que "a message has to be written and translated as a single unit", porque tradutores não conseguem reordenar fragmentos concatenados. Ele também recomenda pôr o argumento de plural ou select no nível mais externo e escrever frases completas dentro dele. Portanto `"Selected " + n + " " + noun` é um defeito de i18n mesmo com cada palavra traduzida.

### Texto bidirecional

O texto é guardado em **ordem lógica**, a ordem de leitura, e exibido em **ordem visual**. O Unicode Bidirectional Algorithm (UAX #9) calcula a segunda a partir da primeira. Letras têm direção forte: hebraico e árabe são da direita para a esquerda, e latinas da esquerda para a direita. Pontuação e espaços são neutros, e números são fracos, então ambos tomam a direção do entorno. A **direção base** do bloco, definida no HTML por `dir`, decide como as sequências se ordenam e onde caem os neutros das pontas.

A orientação do W3C se resume a poucas regras:

- Defina `dir="rtl"` no `html` em páginas da direita para a esquerda. "Never use CSS to apply the base direction."
- Use `dir="auto"` em texto vindo em tempo de execução, ou envolva-o em `<bdi>`. Os dois o isolam dos vizinhos e tomam a direção do primeiro caractere forte.
- Use valores e propriedades lógicas de CSS, como `margin-inline-start` e `text-align: start`.

O isolamento importa mais em dados: um nome de usuário ou título de produto de direção desconhecida, inserido numa frase (Exemplo 4).

### Espelhamento

Um layout RTL é, em linhas gerais, o espelho de um layout LTR, mas nem tudo inverte. As diretrizes de RTL do Firefox espelham botões de voltar e avançar e barras de progresso, e não espelham texto, números, marcas de seleção, controles de vídeo e áudio nem logotipos. A orientação legada do Material Design acrescenta que relógios continuam girando no sentido horário, então um ícone de relógio ou de atualizar em sentido horário fica como está. São regras de dois produtos, úteis como checklist, mas não uma norma.

### Expansão de texto

O artigo do W3C "Text size in translation" traz um exemplo medido e uma tabela. Numa interface do Flickr, o inglês "views" (5 letras) virou o português "visualizações" (13, razão 2,6) e o italiano "visualizzazioni" (15, razão 3). Depois ele relata taxas médias que atribui às *Guidelines to design global solutions* da IBM, de inglês para idiomas europeus:

| Caracteres na origem em inglês | Expansão média |
|---|---|
| Até 10 | 200 a 300% |
| 11 a 20 | 180 a 200% |
| 21 a 30 | 160 a 180% |
| 31 a 50 | 140 a 160% |
| 51 a 70 | 151 a 170% |
| Acima de 70 | 130% |

Leia com cuidado. O artigo usa "300%" para uma razão de 3, então os números se leem como comprimento traduzido sobre comprimento de origem: "200%" é o dobro, não o triplo. A tabela não é monotônica em 51 a 70, então é guia aproximado. A parte útil é a forma: strings curtas crescem mais, e são elas que ficam em botões e abas apertados.

## Exemplos Resolvidos

### Exemplo 1: um instante, várias datas

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

`3/4` se lê como março em `en-US` e como abril para quem lê a mesma string no Brasil, então um formato escrito à mão falha em silêncio. O tailandês usa por padrão o calendário budista, daí o ano 69, abreviação de 2569. A linha persa aparece em escapes, e é o ano 1404 em dígitos arábico-índicos estendidos.

O mesmo instante em `pt-BR`, mudando só o `timeZone`:

```text
UTC                04/03/2026, 15:30
America/Sao_Paulo  04/03/2026, 12:30
America/New_York   04/03/2026, 10:30
Asia/Tokyo         05/03/2026, 00:30
```

A própria data do calendário muda em Tóquio. Omita `timeZone` e um teste passa numa máquina e reprova em outra.

### Exemplo 2: números e caracteres invisíveis

`new Intl.NumberFormat(l).format(1234567.891)`, com caracteres fora do ASCII em escape:

```text
en-US  1,234,567.891
pt-BR  1.234.567,891
de-CH  1\u{2019}234\u{2019}567.891
fr-FR  1\u{202F}234\u{202F}567,891
en-IN  12,34,567.891
ar-EG  \u{661}\u{66C}\u{662}\u{663}\u{664}\u{66C}\u{665}\u{666}\u{667}\u{66B}\u{668}\u{669}\u{661}
ar-AE  1,234,567.891
```

O agrupamento nem sempre é de milhar (`en-IN`), e o separador pode ser um espaço estreito sem quebra (`fr-FR`). Árabe não é um formato só: `ar-EG` usa dígitos arábico-índicos e `ar-AE`, latinos. O caso de moeda esconde uma armadilha, para 1234,5:

```text
en-US USD $1,234.50                 en-US BRL R$1,234.50
pt-BR BRL R$\u{A0}1.234,50          pt-BR USD US$\u{A0}1.234,50
de-DE EUR 1.234,50\u{A0}\u{20AC}    ja-JP JPY \u{FFE5}1,235
```

O espaço depois de `R$` é U+00A0, então comparar o valor formatado com o literal `'R$ 1.234,50'` com espaço comum dá `false`. Formatar não converte dinheiro: `pt-BR` com USD é o mesmo número em dólares, escrito do jeito brasileiro. A moeda também define os dígitos, e JPY arredonda para 1,235.

### Exemplo 3: mais formas de plural que o inglês

```text
en     one other
pt     many one other
pt-PT  many one other
pl     few many one other
ar     few many one two zero other
ja     other
```

O árabe tem as seis categorias, e o japonês, uma. `select(n)` em `Intl.PluralRules` dá:

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

Três coisas chamam atenção. `pt` põe 0 e 1,5 em `one`, e `pt-PT` não, então um `if (n === 1)` discorda do CLDR para `pt` mesmo numa mensagem de duas formas. O polonês depende dos últimos dígitos: 22 e 102 são `few`, mas 12 é `many`. A exibição importa até em inglês: `select(1)` dá `one`, mas com `minimumFractionDigits: 1`, que exibe "1.0", dá `other`.

Uma mensagem ICU carrega as formas. Esta execução usou `intl-messageformat` 12.1.4, com as formas polonesas do próprio CLDR para "mês":

```text
{n, plural, one {# miesiąc} few {# miesiące} many {# miesięcy} other {# miesiąca}}
1 miesiąc | 2 miesiące | 5 miesięcy | 12 miesięcy | 22 miesiące | 102 miesiące | 1,5 miesiąca
```

Uma mensagem só com `one` e `other`, como teria uma origem em inglês, falha sem erro, porque toda categoria ausente cai em `other`:

```text
{n, plural, one {# miesiąc} other {# miesiące}}
1 miesiąc | 2 miesiące | 5 miesiące | 12 miesiące | 22 miesiące
```

Aqui 5 e 12 estão errados. Como a documentação do ICU observa, o sistema de tradução e o tradutor precisam acrescentar as categorias que o idioma de destino exige.

### Exemplo 4: texto bidirecional, medido

Hebraico escrito direto nesta lição seria reordenado pelo seu próprio navegador, então as letras aparecem por nome. As strings usaram hebraico real (alef, bet, gimel, U+05D0 a U+05D2) no Chrome 156. A posição horizontal de cada caractere foi lida com um `Range` do DOM, e ordenar por posição dá a ordem visual, da esquerda para a direita.

```text
marcação                     ordem lógica         ordem visual, esquerda para direita
<p dir=ltr>                  alef bet gimel - 3   3 - gimel bet alef reviews
                             reviews
<p dir=ltr><bdi>..</bdi>     alef bet gimel - 3   gimel bet alef - 3 reviews
                             reviews
<p dir=rtl>                  Hello!               !Hello
<p dir=ltr>                  Hello!               Hello!
<p dir=ltr>                  alef bet gimel !     gimel bet alef !
<p dir=auto>                 alef bet gimel !     ! gimel bet alef
```

A linha 1 é o defeito clássico em "`nome` - `contagem` reviews": o número entra na sequência hebraica e pula para a esquerda do nome. É o que o W3C chama de spillover, e `<bdi>` o remove (linha 2). As linhas 3 e 4 mostram que a direção base move o "!" neutro: a string guardada é idêntica. Nas duas últimas linhas, uma string da direita para a esquerda num bloco `ltr` fica com o "!" no lado errado, e `dir="auto"` corrige isso tomando `rtl` do primeiro caractere forte.

### Exemplo 5: layout, ordenação e caixa

Uma página com `dir="rtl"`, num body de 400px, com duas caixas de 100px:

```text
margin-left: 16px           caixa em 700..800   (colada na borda direita)
margin-inline-start: 16px   caixa em 684..784   (16px da borda inicial)
```

Em `ltr` as duas ficam em 16..116, então o bug é invisível até o RTL. Sob `dir="rtl"`, `display: flex` também inverteu os filhos sem mudança de CSS.

Para expansão, um botão de 64px com `white-space: nowrap` deu `clientWidth` e `scrollWidth` de 64 e 64 para "views", e 64 e 79 para "visualizações", na sans-serif padrão do Chrome em 16px. Comparar as duas propriedades é uma verificação automática de transbordo, e a pseudolocalização (trocar strings por versões mais longas e acentuadas) permite rodá-la antes de existir tradução.

Ordenação e caixa também precisam do locale:

```text
sort()  Apfel Zebra Ärger Öl
de      Apfel Ärger Öl Zebra
sv      Apfel Zebra Ärger Öl
sort()  casa dado Ávila água
pt      água Ávila casa dado
```

Alemão e sueco ordenam as mesmas palavras de modo diferente, e o `sort()` padrão compara unidades de código UTF-16, o que põe "água" depois de "dado". A troca de caixa também varia: `'i'.toUpperCase()` dá `I`, e `'i'.toLocaleUpperCase('tr')` dá `İ`.

## Equívocos Comuns e Armadilhas

- **"i18n é traduzir as strings."** Tradução é l10n. i18n é o que torna a tradução possível sem mudar código.
- **"`one` significa o número 1."** Em `pt` cobre também 0 e 1,5.
- **"Duas formas bastam para um plural."** Polonês e árabe precisam de mais, e as formas ausentes falham em silêncio.
- **"RTL é inverter a página inteira."** Números, controles de mídia e relógios ficam, e a regra muda por objeto.
- **"Texto cresce 30 por cento."** Isso só serve para a linha mais longa da tabela acima. Strings curtas podem chegar a 300 por cento da origem.
- **"A saída de `Intl` é constante."** Depende da versão do CLDR, então nomeie a versão e não a fixe em testes.

## Resumo

A internacionalização tira suposições do código, e a localização adapta o resultado a cada locale. O CLDR fornece o dado, o ICU o aplica e o `Intl` o expõe, então as saídas dependem da versão do CLDR e não devem ser fixadas como literais. Fixe `timeZone` em datas e espere espaços sem quebra em números formatados. As formas de plural vêm de categorias que são mnemônicos: o árabe usa seis, o polonês depende dos dígitos finais e o `one` de `pt` inclui 0 e 1,5. O algoritmo bidirecional reordena o texto lógico na exibição, e dados inseridos precisam de isolamento com `<bdi>` ou `dir="auto"`. Números de expansão são aproximados, a tabela da IBM relatada pelo W3C cobre inglês para idiomas europeus, e uma verificação de transbordo diz mais que uma porcentagem.

## Documentation Links

- [W3C: Localization vs. Internationalization](https://www.w3.org/International/questions/qa-i18n): as definições de trabalho dos dois termos.
- [W3C: Text size in translation](https://www.w3.org/International/articles/article-text-size): o exemplo do Flickr e a tabela de expansão da IBM.
- [W3C: Unicode Bidirectional Algorithm basics](https://www.w3.org/International/articles/inline-bidi-markup/uba-basics): direção base, sequências direcionais e tipos de caractere.
- [W3C: Inline markup and bidirectional text in HTML](https://www.w3.org/International/articles/inline-bidi-markup/): `bdi`, `dir="auto"` e efeitos de spillover.
- [W3C: Structural markup and right-to-left text in HTML](https://www.w3.org/International/questions/qa-html-dir): onde definir `dir`, e CSS lógico.
- [Unicode: UAX #9, Unicode Bidirectional Algorithm](https://www.unicode.org/reports/tr9/): o algoritmo normativo.
- [Unicode CLDR: Plural Rules](https://cldr.unicode.org/index/cldr-spec/plural-rules): as seis categorias e como são definidas.
- [Unicode CLDR 46: Language Plural Rules chart](https://www.unicode.org/cldr/charts/46/supplemental/language_plural_rules.html): as regras por idioma, com exemplos.
- [ICU User Guide: Formatting Messages](https://unicode-org.github.io/icu/userguide/format_parse/messages/): mensagens como unidades inteiras, e argumentos de plural.
- [MDN: Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules): a API usada no Exemplo 3.
- [Mozilla: Firefox RTL Guidelines](https://firefox-source-docs.mozilla.org/code-quality/coding-style/rtl_guidelines.html): o que um produto espelha e o que não espelha.
- [Material Design (legacy): Bidirectionality](https://m1.material.io/usability/bidirectionality.html): regras de espelhamento, incluindo relógios e controles de mídia.
