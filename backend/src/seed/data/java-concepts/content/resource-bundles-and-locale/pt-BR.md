---
version: 1.0
updatedAt: 2026-08-19
title: Resource Bundles e Locale
summary: Como Locale identifica um idioma e uma região, como ResourceBundle expande uma requisição em uma cadeia de arquivos .properties candidatos, e por que o locale padrão da JVM é tentado antes do bundle base, neutro em relação a idioma.
---
## Objective

Um `Locale` é um identificador — um idioma, opcionalmente um script, região e variante — que informa às APIs sensíveis a locale quais convenções usar. Um `ResourceBundle` é uma busca com chave de valores localizados, normalmente apoiada em um arquivo `.properties` por idioma, que permite escrever `rb.getString("exit.label")` em vez de fixar `"Exit"` no código. O mecanismo que vale a pena entender não é a chamada `getString`, mas o que acontece *antes* dela: `getBundle` transforma um locale solicitado em uma lista ordenada de nomes de arquivo candidatos, e quando o idioma solicitado não existe, o fallback ocorre silenciosamente — primeiro para o locale **padrão** da JVM, e só então para o bundle base, neutro em relação a idioma. Conhecer essa ordem é a diferença entre um usuário alemão ver inglês e um usuário alemão ver qualquer que seja o idioma configurado na máquina de build.

## Use Cases

- Extrair todas as strings visíveis ao usuário (rótulos de menu, e-mails, mensagens de validação) do código e colocá-las em arquivos `.properties`, de modo que adicionar um idioma signifique incluir um arquivo em vez de recompilar.
- Servir um locale por requisição em uma aplicação servidor — resolvido a partir de `Accept-Language` ou de um perfil de usuário — em vez de deixar que toda requisição herde o padrão global da JVM.
- Detectar se um usuário de fato recebeu seu próprio idioma ou um fallback, comparando `rb.getLocale()` com o locale solicitado.
- Tornar a saída formatada determinística em testes fixando um `Locale` explícito no ponto de chamada, para que uma máquina de CI com `LANG` diferente não altere asserções sobre separadores decimais ou símbolos de moeda.
- Manter o idioma de exibição e a formatação de números/datas configuráveis de forma independente através de `Locale.Category.DISPLAY` e `Locale.Category.FORMAT`.
- Distribuir traduções em um jar ou módulo separado, descoberto via o SPI de service-loader `ResourceBundleProvider`, em vez de ficarem ao lado do código que as usa.

## Deep Dive

### Obtendo um Locale

Os construtores de `Locale` estão deprecated desde o Java 19. Use uma constante, a factory `Locale.of`, `forLanguageTag`, ou `Locale.Builder`:

```java
Locale a = Locale.FRANCE;                              // predefined constant -> fr_FR
Locale b = Locale.of("en", "GB");                      // language + region   -> en_GB
Locale c = Locale.forLanguageTag("pt-BR");             // IETF BCP 47 tag     -> pt_BR
Locale d = new Locale.Builder()                        // syntax-checked
        .setLanguage("sr").setScript("Latn").setRegion("RS")
        .build();                                      // -> sr_RS_#Latn

d.toLanguageTag();                 // sr-Latn-RS
d.getDisplayName(Locale.ENGLISH);  // Serbian (Latin, Serbia)
Locale.ROOT;                       // language/country-neutral locale, all fields ""
```

`Locale.of` normaliza a caixa (idioma em minúsculas, região em maiúsculas), mas não faz nenhuma verificação de sintaxe. Note que a forma deprecated ainda compila, apenas emite um warning:

```java
Locale old = new Locale("en", "GB");
// warning: [deprecation] Locale(String,String) in Locale has been deprecated
```

### Locale não valida nada — "UK" não é um código de país

O subtag de região do Reino Unido é `GB` (ISO 3166). `UK` não é um código válido, e nada na API avisa isso:

```java
Locale bogus = Locale.of("en", "UK");
bogus.getCountry();                       // "UK"
bogus.toLanguageTag();                    // "en-UK"
bogus.getDisplayName(Locale.ENGLISH);     // "English (UK)"  -- no exception, no warning
```

O locale resultante é simplesmente uma região desconhecida: nenhum dado CLDR corresponde a ela, então a formatação degrada silenciosamente para os dados simples de `en`. `Locale.Builder` verifica apenas o *formato bem definido*: dois caracteres alfabéticos é uma forma legal, então ele aceita o mesmo erro:

```java
new Locale.Builder().setRegion("UK").build();     // fine -> en_UK, still wrong
new Locale.Builder().setRegion("USA1").build();   // IllformedLocaleException: Ill-formed region: USA1
```

`forLanguageTag` é o mais tolerante de todos — um input que não pode ser analisado vira o locale vazio em vez de um erro:

```java
Locale.forLanguageTag("garbage!").toLanguageTag();   // "und"  (undetermined)
```

Então valide identificadores de locale na fronteira onde eles entram no seu sistema; a classe `Locale` não fará isso por você.

### O locale padrão, e suas duas categorias

Toda API sensível a locale tem uma sobrecarga que não recebe `Locale` e usa `Locale.getDefault()`, que é derivado da plataforma (a variável de ambiente `LANG` em Unix/macOS, configurações regionais no Windows) e pode ser sobrescrito na inicialização com `-Duser.language` / `-Duser.country`. Desde o Java 7 o padrão é dividido em dois: `DISPLAY` (idioma dos nomes de exibição) e `FORMAT` (convenções de número, data e moeda).

```java
Locale.setDefault(Locale.US);
Locale.setDefault(Locale.Category.FORMAT, Locale.GERMANY);

Locale.getDefault(Locale.Category.DISPLAY);   // en_US
Locale.getDefault(Locale.Category.FORMAT);    // de_DE
Locale.getDefault();                          // en_US  -- unchanged by the FORMAT-only call

NumberFormat.getInstance().format(1234.5);    // "1.234,5"  -- follows FORMAT
```

`Locale.setDefault` altera um estado global do processo, então pertence ao `main` na inicialização, não a código de biblioteca e nem por requisição. Em um servidor, passe o locale explicitamente.

### Um bundle é um arquivo .properties, lido como UTF-8

O nome base é um nome totalmente qualificado; os arquivos ficam no classpath (ou em um módulo) ao lado dele. `Msg.properties` é o bundle base, `Msg_fr.properties` é o francês:

```properties
# Msg.properties  -- base bundle
greeting=Hello, {0}!
farewell=Goodbye
```

```properties
# Msg_fr.properties
greeting=Bonjour, {0} !
```

```java
ResourceBundle rb = ResourceBundle.getBundle("Msg", Locale.FRANCE);
rb.getString("greeting");   // Bonjour, {0} !
rb.getBaseBundleName();     // Msg
rb.getLocale();             // fr   -- see below: this is how you detect a fallback
```

Desde o Java 9, `PropertyResourceBundle` lê o stream como **UTF-8** e só relê como ISO-8859-1 se a decodificação UTF-8 falhar, então texto acentuado e não latino entra literalmente — o antigo escape `\uXXXX` do `native2ascii` não é mais necessário. Force um único encoding com `-Djava.util.PropertyResourceBundle.encoding=UTF-8` se quiser que uma falha de decodificação seja um erro em vez de uma releitura silenciosa.

### A cadeia de nomes candidatos

`getBundle` expande o locale solicitado em nomes de bundle candidatos, do mais específico ao mais genérico, descartando um campo por vez:

```
ResourceBundle.getBundle("Menus", Locale.of("es", "CU", "x"))
  Menus_es_CU_x
  Menus_es_CU
  Menus_es
  Menus            (base bundle)
```

É por isso que a convenção de nome de arquivo é `base_idioma`, `base_idioma_PAÍS`: `Menus_sv.properties` (sueco), `Menus_fr_CA.properties` (francês canadense), `Menus_es_CU.properties` (espanhol cubano). Subtags de idioma são ISO 639 em minúsculas (`sv` de *Sverige*, `es` de *Español*); subtags de região são ISO 3166 em maiúsculas (`CA`, `ES`, e `SE` — não `SV` — para a Suécia). O nome base em si é sensível a maiúsculas/minúsculas: `Menus.properties`, nunca `Menus.Properties`.

Para cada candidato, `getBundle` procura primeiro uma **classe** e depois um arquivo `.properties`. Ele para no primeiro hit, e esse se torna o bundle resultado.

### O fallback do locale padrão roda antes do bundle base

Esta é a parte que surpreende as pessoas. Dados apenas estes dois arquivos:

```
Menus.properties       which=base
Menus_fr.properties    which=french
```

pedir por alemão *não* retorna o bundle base se o padrão da JVM for francês:

```java
Locale.setDefault(Locale.FRANCE);

ResourceBundle rb = ResourceBundle.getBundle("Menus", Locale.GERMAN);
rb.getLocale();            // fr
rb.getString("which");     // "french"   -- a German user reading French
```

Instrumentar um `ResourceBundle.Control` mostra a sequência exata: o bundle base é encontrado cedo mas **fica em espera** justamente por ser o bundle base, depois a cadeia inteira do locale de fallback é pesquisada, e só se essa também falhar o bundle base retido é retornado.

```
getCandidateLocales(de) = [de, ]
  try java.properties locale=[]   -> HIT   (base bundle: found, put on hold)
  try java.properties locale=[de] -> miss
getFallbackLocale(de) = fr_FR
getCandidateLocales(fr_FR) = [fr_FR, fr, ]
  try java.properties locale=[fr] -> HIT   <- this becomes the result
=> fr
```

Então a precedência efetiva é: **cadeia do locale solicitado, depois cadeia do locale padrão, depois o bundle base.** Há duas formas de sair disso. Solicitar `Locale.ROOT` — um locale com todos os campos vazios torna o nome base o único candidato, pulando o fallback inteiramente:

```java
ResourceBundle.getBundle("Menus", Locale.ROOT).getString("which");   // "base"
```

Ou fornecer um `Control` cujo `getFallbackLocale` retorne `null`:

```java
static final ResourceBundle.Control NO_FALLBACK = new ResourceBundle.Control() {
    @Override public List<String> getFormats(String baseName) { return FORMAT_PROPERTIES; }
    @Override public Locale getFallbackLocale(String baseName, Locale locale) { return null; }
};

ResourceBundle rb = ResourceBundle.getBundle(
        "Menus", Locale.GERMAN, MyApp.class.getClassLoader(), NO_FALLBACK);
rb.getLocale();          // "" (root)
rb.getString("which");   // "base"
```

De qualquer forma, a verificação defensiva barata é comparar o que você pediu com o que você recebeu:

```java
if (!rb.getLocale().getLanguage().equals(requested.getLanguage())) {
    log.warn("no bundle for {}, serving {}", requested, rb.getLocale());
}
```

### A cadeia de parentesco: chaves fazem fallback, não arquivos

Uma vez escolhido um bundle resultado, `getBundle` liga os candidatos restantes, menos específicos, como seus **parents**. Um arquivo de tradução, portanto, só precisa das chaves que ele de fato sobrescreve; o que estiver faltando é resolvido subindo a cadeia:

```java
// Msg_fr.properties defines only "greeting"; Msg.properties also defines "farewell"
ResourceBundle rb = ResourceBundle.getBundle("Msg", Locale.FRANCE);

rb.getString("greeting");        // Bonjour, {0} !   -- from Msg_fr
rb.getString("farewell");        // Goodbye          -- from the parent, Msg
rb.containsKey("farewell");      // true  (searches parents)
rb.keySet();                     // [farewell, greeting]  (union with parents)
```

Conveniente, mas isso significa que um arquivo parcialmente traduzido degrada para uma saída de idioma misto em vez de um erro visível. `keySet()` em cada bundle de locale, comparado com o do bundle base, é um teste de completude barato em um teste unitário.

### MissingResourceException cobre duas falhas diferentes

`MissingResourceException` é unchecked e usada tanto para "nenhum bundle encontrado" quanto para "bundle encontrado, chave ausente" — as mensagens diferem, e a correção também:

```java
ResourceBundle.getBundle("NoSuch");
// MissingResourceException: Can't find bundle for base name NoSuch, locale en_US

rb.getString("nope");
// MissingResourceException: Can't find resource for bundle
//   java.util.PropertyResourceBundle, key nope
```

`e.getKey()` retorna a chave ausente, o que é o que torna viável o idioma de captura-e-valor-padrão por chave:

```java
static String label(ResourceBundle rb, String key, String fallback) {
    try {
        return rb.getString(key);
    } catch (MissingResourceException e) {
        return fallback;                 // e.getKey() == key
    }
}
```

Prefira `rb.containsKey(key)` quando você só quer o teste, sem a exceção.

### Placeholders: o bundle guarda o pattern, o MessageFormat o preenche

Um valor de properties guarda apenas texto, então qualquer coisa variável é um pattern do `MessageFormat` que o bundle armazena literalmente e você formata no ponto de chamada — com o mesmo locale usado para carregar o bundle, já que as partes numéricas e monetárias são sensíveis a locale:

```properties
# Msg.properties
items=You have {0,number,integer} item(s), total {1,number,currency}.
```

```java
ResourceBundle rb = ResourceBundle.getBundle("Msg", Locale.US);

new MessageFormat(rb.getString("items"), Locale.US)
        .format(new Object[] { 3, 1234.5 });
// You have 3 item(s), total $1,234.50.

new MessageFormat(rb.getString("items"), Locale.GERMANY)
        .format(new Object[] { 3, 1234.5 });
// You have 3 item(s), total 1.234,50 €.
```

Placeholders numerados — e não concatenação de strings — são o que permite que um tradutor reordene a frase. Tudo a partir daqui (`DateTimeFormatter`, `NumberFormat`, `Collator`) segue o mesmo padrão de uma sobrecarga que recebe `Locale` ao lado da padrão; veja o conceito de `java.time` para detalhes de formatação de data/hora.

### Bundles em módulos nomeados

Sob o JPMS, um bundle em outro módulo é encapsulado por padrão. Duas formas suportadas: colocar os arquivos `.properties` no *mesmo* módulo do código e usar a sobrecarga com `Module`, ou publicá-los a partir de um módulo separado através do SPI `ResourceBundleProvider` e deixar o `ServiceLoader` encontrá-los.

```java
// same module as the resources
ResourceBundle.getBundle("com.example.app.Msg", locale, MyApp.class.getModule());
```

```java
// provider module
module com.example.app.translations {
    requires com.example.app;
    provides com.example.app.spi.MsgProvider with com.example.app.fr.MsgProvider_fr;
}
```

As sobrecargas que recebem `Control` não são suportadas aqui: chamar uma delas a partir de um módulo nomeado lança `UnsupportedOperationException`, porque `Control` é anterior ao encapsulamento de módulos e não o entende.

## Trade-offs

- **Arquivos properties vs. bundles baseados em classe** — arquivos `.properties` continuam sendo a escolha padrão: tradutores podem editá-los sem um compilador, um novo idioma é um novo arquivo, e desde o Java 9 eles são UTF-8, então a antiga vantagem de charset do `ListResourceBundle` desapareceu. `ListResourceBundle` sobrevive para o caso raro de recursos que não são `String`, ao custo de recompilar para mudar uma tradução. Ele também vence silenciosamente a busca, já que `getBundle` tenta o candidato de classe antes do candidato properties para o mesmo nome — então um `Msg_fr.class` perdido por aí sobrepõe `Msg_fr.properties`:

```java
// classpath contains BOTH Msg2_fr.class (a ListResourceBundle) and Msg2_fr.properties
ResourceBundle.getBundle("Msg2", Locale.FRENCH).getString("greeting");
// "from Msg2_fr.class"  -- the .properties file is never read
```

- **O fallback é silencioso por design** — um bundle ou chave ausente nunca falha o build e raramente falha em tempo de execução; ele degrada para outro idioma. Isso mantém uma tradução parcial "shipável", mas também significa que uma lacuna de tradução só aparece como reclamação de usuário, a menos que você faça uma asserção sobre isso:

```java
ResourceBundle rb = ResourceBundle.getBundle("Menus", Locale.GERMAN);
assertEquals(Locale.GERMAN, rb.getLocale());   // fails loudly instead of serving French
```

- **O locale padrão é global ao processo** — `Locale.setDefault` é a única alavanca para as sobrecargas sem argumento, então é conveniente em uma CLI e errado em um servidor, onde duas requisições concorrentes podem precisar de locales diferentes. Passar o locale explicitamente exige mais código, mas é a única opção correta sob concorrência.

- **Bundles são cacheados pela vida útil do processo** — `getBundle` retorna instâncias cacheadas, então editar um arquivo `.properties` não tem efeito até que o cache seja descartado ou a JVM reinicie. `clearCache()` existe, mas limpa tudo para o módulo do chamador, então recarga ao vivo precisa de um `Control` com um `getTimeToLive`/`needsReload` reais, em vez dessa chamada geral:

```java
ResourceBundle.clearCache();   // all bundles loaded by the caller's module
```

- **Um único namespace plano de chaves string** — as chaves são strings não tipadas, sem verificação do compilador, então uma chave renomeada é uma falha em tempo de execução e prefixos com ponto (`file.new.label`) são convenção, não estrutura. Ferramental ou uma classe de constantes gerada podem recuperar alguma segurança; a própria API não oferece nenhuma.

- **`Control` indisponível em módulos nomeados** — todo hook de customização (formatos, lista de candidatos, fallback, TTL de cache) vive em `ResourceBundle.Control`, e os métodos de fábrica que aceitam um lançam `UnsupportedOperationException` a partir de um módulo nomeado. Aplicações modularizadas recebem o SPI `ResourceBundleProvider` no lugar, que controla *de onde* os bundles vêm, mas não a política de busca e cache.

## Documentation Links

- [Locale — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Locale.html) — doc
- [ResourceBundle — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ResourceBundle.html) — doc
- [PropertyResourceBundle — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/PropertyResourceBundle.html) — doc
- [ResourceBundle.Control — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ResourceBundle.Control.html) — doc
- [ResourceBundleProvider — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/spi/ResourceBundleProvider.html) — doc
- [MessageFormat — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/text/MessageFormat.html) — doc
- [Internationalization Overview — Java SE 25](https://docs.oracle.com/en/java/javase/25/intl/internationalization-overview.html) — doc
