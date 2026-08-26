---
version: 1.0
updatedAt: 2026-08-14
title: Convenções de Nomenclatura em Java
summary: As regras tipográficas do Java (capitalização de pacotes, classes, métodos, campos e parâmetros de tipo) e as regras gramaticais (frases nominais para classes, frases verbais para métodos de ação, is/has para booleanos) que mantêm o código legível e previsível.
---
## Objective

A plataforma Java tem um conjunto bem estabelecido de convenções de nomenclatura, muitas delas presentes na própria Java Language Specification. As convenções de nomenclatura se dividem em duas categorias: tipográficas (como um identificador é capitalizado e pontuado) e gramaticais (que classe gramatical — substantivo, verbo, adjetivo — um identificador assume, com base no que ele representa). As duas importam: uma API que viola as convenções tipográficas pode ser difícil de usar, e uma implementação que as viola pode ser difícil de manter — em ambos os casos, violações podem confundir e irritar outros programadores e levar a suposições equivocadas que causam erros.

## Use Cases

- Nomear um novo pacote de forma que ele não colida com pacotes de outras organizações e sinalize claramente a autoria.
- Nomear uma classe, interface, enum ou tipo de anotação de modo que seu papel fique óbvio à primeira vista.
- Decidir se o nome de um método deve começar com letra minúscula, receber um prefixo `get`/`is`/`has`, ou ser uma frase nominal ou verbal simples.
- Nomear corretamente um campo `static final` como constante, em contraste com um campo de instância comum.
- Escolher nomes curtos e convencionais para variáveis locais e parâmetros de tipo genéricos sem sacrificar a clareza.
- Nomear um método ou campo booleano de forma que quem o chama saiba, no próprio ponto de chamada, o que `true` significa.
- Nomear um método de conversão de tipo ou de fábrica estática de forma que seu comportamento seja previsível só pelo nome.

## Deep Dive

### Convenções tipográficas

Existe apenas um punhado de convenções tipográficas de nomenclatura, cobrindo pacotes, classes, interfaces, métodos, campos e variáveis de tipo. Você deve raramente violá-las, e nunca sem um bom motivo.

**Pacotes** devem ser hierárquicos, com componentes separados por pontos. Os componentes devem consistir em caracteres alfabéticos minúsculos e, raramente, dígitos. O nome de qualquer pacote usado fora da sua organização deve começar com o domínio de internet da organização, com o domínio de nível superior primeiro — por exemplo, `edu.cmu`, `com.sun`, `gov.nsa`. As bibliotecas padrão e os pacotes opcionais, cujos nomes começam com `java` e `javax`, são exceções a essa regra — usuários não devem criar pacotes cujos nomes comecem com `java` ou `javax`.

O restante do nome de um pacote deve consistir em um ou mais componentes que descrevem o pacote. Os componentes devem ser curtos, geralmente com oito ou menos caracteres. Abreviações significativas são incentivadas, por exemplo `util` em vez de `utilities`. Siglas são aceitáveis, por exemplo `awt`. Os componentes geralmente devem consistir em uma única palavra ou abreviação.

Muitos pacotes têm nomes com apenas um componente além do domínio de internet. Componentes adicionais são apropriados para grandes conjuntos de funcionalidades cujo tamanho exige que sejam divididos em uma hierarquia informal — por exemplo, `javax.swing` tem uma rica hierarquia de subpacotes como `javax.swing.plaf.metal`, embora não haja suporte linguístico para hierarquias de pacotes como tal.

**Classes e interfaces**, incluindo nomes de enum e de tipos de anotação, devem consistir em uma ou mais palavras, com a primeira letra de cada palavra capitalizada — por exemplo, `Timer` ou `FutureTask`. Abreviações devem ser evitadas, exceto siglas e certas abreviações comuns como `max` e `min`. Não há consenso sobre se siglas devem ficar em maiúsculas ou ter apenas a primeira letra capitalizada — embora maiúsculas sejam mais comuns, há um argumento forte a favor de capitalizar apenas a primeira letra: mesmo quando várias siglas aparecem em sequência, ainda dá para saber onde uma palavra termina e a próxima começa. Compare `HTTPURL` com `HttpUrl`.

**Métodos e campos** seguem as mesmas convenções tipográficas de classes e interfaces, exceto que a primeira letra deve ser minúscula, por exemplo `remove` ou `ensureCapacity`. Se uma sigla ocorre como a primeira palavra do nome de um método ou campo, ela deve ficar em minúsculas.

A única exceção diz respeito aos **campos constantes**, cujos nomes devem consistir em uma ou mais palavras em maiúsculas separadas por underscore, por exemplo `VALUES` ou `NEGATIVE_INFINITY`. Um campo constante é um campo `static final` cujo valor é imutável: se um campo `static final` tem um tipo primitivo ou um tipo de referência imutável, ele é um campo constante (constantes de enum se qualificam). Um campo `static final` com um tipo de referência mutável ainda pode ser um campo constante se o próprio objeto referenciado for imutável. Campos constantes constituem o único uso recomendado de underscores.

**Variáveis locais** têm convenções tipográficas semelhantes às de membros, exceto que abreviações são permitidas, assim como caracteres individuais e sequências curtas de caracteres cujo significado depende do contexto em que a variável ocorre, por exemplo `i`, `xref`, `houseNumber`.

**Nomes de parâmetros de tipo** costumam consistir em uma única letra. Os mais comuns são cinco: `T` para um tipo arbitrário, `E` para o tipo de elemento de uma coleção, `K` e `V` para os tipos de chave e valor de um mapa, e `X` para uma exception. Uma sequência de tipos arbitrários pode ser `T, U, V` ou `T1, T2, T3`.

Tabela de referência rápida:

| Tipo de identificador | Exemplos |
|---|---|
| Pacote | `com.google.inject`, `org.joda.time.format` |
| Classe ou Interface | `Timer`, `FutureTask`, `LinkedHashMap`, `HttpServlet` |
| Método ou Campo | `remove`, `ensureCapacity`, `getCrc` |
| Campo Constante | `MIN_VALUE`, `NEGATIVE_INFINITY` |
| Variável Local | `i`, `xref`, `houseNumber` |
| Parâmetro de Tipo | `T`, `E`, `K`, `V`, `X`, `T1`, `T2` |

### Convenções gramaticais

As convenções gramaticais de nomenclatura são mais flexíveis e mais controversas do que as tipográficas. Não há praticamente convenções gramaticais de nomenclatura para pacotes.

**Classes**, incluindo tipos enum, geralmente são nomeadas com um substantivo singular ou frase nominal, por exemplo `Timer`, `BufferedWriter` ou `ChessPiece`. **Interfaces** são nomeadas como classes, por exemplo `Collection` ou `Comparator`, ou com um adjetivo terminado em `able` ou `ible`, por exemplo `Runnable`, `Iterable` ou `Accessible`. Como tipos de anotação têm tantos usos, nenhuma classe gramatical predomina — substantivos, verbos, preposições e adjetivos são todos comuns, por exemplo `BindingAnnotation`, `Inject`, `ImplementedBy` ou `Singleton`.

**Métodos que executam uma ação** geralmente são nomeados com um verbo ou frase verbal (incluindo seu objeto), por exemplo `append` ou `drawImage`.

**Métodos que retornam um booleano** geralmente têm nomes que começam com `is` ou, menos comumente, `has`, seguidos de um substantivo, frase nominal, ou qualquer palavra ou frase que funcione como adjetivo, por exemplo `isDigit`, `isProbablePrime`, `isEmpty`, `isEnabled` ou `hasSiblings`.

**Métodos que retornam uma função ou atributo não booleano** do objeto sobre o qual são invocados geralmente são nomeados com um substantivo, uma frase nominal, ou uma frase verbal começando com `get`, por exemplo `size`, `hashCode` ou `getTime`. Há um grupo vocal que afirma que apenas a forma prefixada com `get` é aceitável, mas há pouca base para essa afirmação — as duas primeiras formas costumam levar a um código mais legível, por exemplo:

```java
if (car.speed() > 2 * SPEED_LIMIT)
    generateAudibleAlert("Watch out for cops!");
```

A forma prefixada com `get` é obrigatória se a classe que contém o método for um Bean, e é aconselhável se você estiver considerando transformar a classe em um Bean futuramente. Também há um forte precedente para a forma `get` quando a classe contém um método para definir o mesmo atributo — nesse caso, os dois métodos devem ser nomeados `getAttribute` e `setAttribute`.

Alguns nomes de método merecem menção especial:

- Métodos que **convertem o tipo de um objeto**, retornando um objeto independente de tipo diferente, costumam ser chamados de `toType`, por exemplo `toString`, `toArray`.
- Métodos que **retornam uma view** cujo tipo difere do objeto receptor costumam ser chamados de `asType`, por exemplo `asList`.
- Métodos que **retornam um primitivo com o mesmo valor** do objeto sobre o qual são invocados costumam ser chamados de `typeValue`, por exemplo `intValue`.
- Nomes comuns para **fábricas estáticas** são `valueOf`, `of`, `getInstance`, `newInstance`, `getType` e `newType`.

**Nomes de campos** são menos bem estabelecidos e menos importantes do que os de classes, interfaces e métodos, já que APIs bem projetadas expõem poucos campos, ou nenhum. Campos `boolean` costumam ser nomeados como métodos acessores booleanos, com o `is` inicial omitido, por exemplo `initialized`, `composite`. Campos de outros tipos geralmente são nomeados com substantivos ou frases nominais, como `height`, `digits` ou `bodyStyle`. As convenções gramaticais para variáveis locais são semelhantes às de campos, mas ainda mais frouxas.

Resumindo: internalize as convenções de nomenclatura padrão e aprenda a usá-las quase automaticamente. As convenções tipográficas são diretas e amplamente inequívocas; as gramaticais são mais complexas e mais soltas. Como a Java Language Specification coloca, "essas convenções não devem ser seguidas de forma cega quando um uso convencional já consolidado indicar o contrário." Use o bom senso.

## Trade-offs

- **Consistência vs. rigidez** — convenções de nomenclatura devem ser raramente violadas e nunca sem um bom motivo, já que violar as convenções de uma API pode torná-la difícil de usar, e violar as convenções de uma implementação pode torná-la difícil de manter; mas a própria JLS observa que essas convenções "não devem ser seguidas de forma cega quando um uso convencional já consolidado indicar o contrário", então o julgamento ainda importa nas bordas.
- **O debate do prefixo `get`** — alguns afirmam que apenas nomes de accessor prefixados com `get` são aceitáveis, mas nomes só com substantivo ou frase verbal (`size`, `hashCode`, `getTime`) costumam ler melhor em expressões condicionais; a forma `get` só se torna obrigatória quando a classe é um JavaBean ou tem chance de se tornar um, ou quando um setter emparelhado já usa `setAttribute`.
  ```java
  if (car.speed() > 2 * SPEED_LIMIT)
      generateAudibleAlert("Watch out for cops!");
  ```
- **A capitalização de siglas não tem consenso** — siglas em maiúsculas (`HTTPURL`) são comuns, mas capitalizar apenas a primeira letra (`HttpUrl`) mantém os limites entre palavras legíveis mesmo quando siglas aparecem em sequência; a convenção favorece a segunda forma, mas reconhece que não há resposta definitiva.
- **Underscores são exclusivos de campos constantes** — campos constantes (`static final` com tipo primitivo ou tipo de referência imutável) usam `UPPER_CASE_COM_UNDERSCORE`, mas esse é o único uso recomendado de underscores em toda a convenção tipográfica; usá-los em outros lugares (campos comuns, métodos, classes) quebra a convenção.

## Documentation Links

- [Java SE 25 API Documentation](https://docs.oracle.com/en/java/javase/25/docs/api/index.html) — doc
