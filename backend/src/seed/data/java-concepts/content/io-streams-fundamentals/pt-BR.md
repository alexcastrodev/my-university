---
version: 1.0
updatedAt: 2026-08-05
title: "java.io: Streams, Fechamento de Recursos e Serialização"
summary: A separação entre stream de bytes e stream de caracteres (InputStream/OutputStream vs. Reader/Writer), como Closeable/AutoCloseable/Flushable e try-with-resources garantem a limpeza de recursos com exceções suprimidas, buffering e PrintWriter, e como Serializable/ObjectInputFilter transformam um grafo de objetos em bytes protegendo contra ataques de deserialização.
---
## Objective

`java.io` é o sistema de I/O original do Java: toda fonte ou destino de dados — um arquivo, o console, um socket de rede, um buffer em memória — é acessado através da mesma abstração, um **stream**. Um stream ou produz (`InputStream`/`Reader`) ou consome (`OutputStream`/`Writer`) uma sequência de dados, um item por vez, e a mesma API voltada a leitura/escrita funciona não importa o que esteja do outro lado. Como um stream quase sempre envolve um recurso externo, fechá-lo corretamente importa tanto quanto lê-lo ou escrevê-lo, e é por isso que `Closeable`/`AutoCloseable`/`Flushable` e o try-with-resources são tão centrais a esse conceito quanto os próprios streams. Serialização — transformar um grafo de objetos inteiro em bytes e de volta — é a outra grande funcionalidade de `java.io`, construída sobre as mesmas classes de stream, mas carregando seu próprio conjunto, mais sério, de riscos.

## Use Cases

- Ler ou escrever os bytes brutos de um arquivo (imagens, formatos binários) com `FileInputStream`/`FileOutputStream`, ou seu texto com `FileReader`/`FileWriter`.
- Envolver um stream bruto em um bufferizado (`BufferedInputStream`, `BufferedReader`) para evitar uma chamada de sistema por byte ou por caractere.
- Produzir saída formatada para console ou arquivo com `PrintWriter`/`PrintStream`, incluindo formatação estilo `printf`.
- Persistir um grafo de objetos em memória para disco ou enviá-lo através de uma fronteira de rede via `ObjectOutputStream`/`ObjectInputStream`.
- Garantir que um arquivo, socket ou outro recurso seja liberado mesmo quando o código que o usa lança uma exceção, via try-with-resources em vez de um bloco `finally` manual.

## Deep Dive

### Duas hierarquias: bytes vs. caracteres

`java.io` se divide claramente em duas hierarquias de classes paralelas. `InputStream`/`OutputStream` movem bytes brutos — a escolha certa para dados binários ou quando não há codificação de texto envolvida. `Reader`/`Writer` movem caracteres Unicode — a escolha certa para texto, porque cuidam do mapeamento de byte para caractere (o charset) para você.

```java
// Byte stream: for binary data
try (InputStream in = new FileInputStream("photo.jpg");
     OutputStream out = new FileOutputStream("copy.jpg")) {
    in.transferTo(out);
}

// Character stream: for text
try (Reader r = new FileReader("notes.txt");
     Writer w = new FileWriter("notes-copy.txt")) {
    r.transferTo(w);
}
```

No nível mais baixo, todo I/O ainda é bytes — `InputStreamReader` e `OutputStreamWriter` são as classes ponte que decodificam/codificam entre as duas hierarquias, dado um `Charset` explícito:

```java
Reader consoleReader = new InputStreamReader(System.in, StandardCharsets.UTF_8);
```

`System.in`/`System.out`/`System.err` são eles próprios streams de bytes (`InputStream`, e `PrintStream` para os dois últimos) mesmo sendo comumente usados para ler e escrever texto — envolvê-los em um stream de caracteres é o que torna o I/O de console correto em termos de codificação.

### Closeable, AutoCloseable, Flushable, e por que o try-with-resources existe

Toda classe de stream que mantém um recurso externo implementa `java.lang.AutoCloseable` (um único método `close()`, declarado para lançar `Exception`), e `java.io.Closeable` estreita esse contrato para `close()` lançando apenas `IOException` — e, ao contrário de `AutoCloseable`, exige que `close()` seja **idempotente**: chamá-lo uma segunda vez precisa ser um no-op, não um erro. `AutoCloseable` apenas encoraja esse comportamento; não o exige. Qualquer classe que escreve em um stream também tipicamente implementa `Flushable`, cujo `flush()` empurra dados bufferizados para o dispositivo subjacente sob demanda, em vez de esperar o buffer encher ou o stream fechar.

Antes do JDK 7, liberar um recurso corretamente significava um bloco `finally`, checando `null` para o caso de o próprio construtor ter falhado:

```java
FileInputStream fin = null;
try {
    fin = new FileInputStream("data.txt");
    // use fin
} finally {
    if (fin != null) fin.close();
}
```

O try-with-resources substitui esse boilerplate: qualquer recurso declarado na cláusula `try(...)` precisa implementar `AutoCloseable`, e ele é fechado automaticamente quando o bloco termina, em ordem reversa de declaração, seja o bloco completado normalmente ou lançando uma exceção.

```java
try (FileInputStream fin = new FileInputStream("in.txt");
     FileOutputStream fout = new FileOutputStream("out.txt")) {
    fin.transferTo(fout);
}   // both fin and fout are closed here, even if transferTo throws
```

Um recurso declarado no `try` é implicitamente `final`, e seu escopo é limitado ao statement. Se fechar um recurso lança uma exceção enquanto o corpo do `try` já está desenrolando por causa de outra exceção, a exceção do close não se perde — ela é anexada à original como uma exceção *suprimida*, recuperável via `Throwable.getSuppressed()`, em vez de silenciosamente substituí-la como uma exceção de um bloco `finally` faria.

### Buffering e PrintWriter

Envolver um stream é como `java.io` adiciona comportamento sem mudar seu tipo: um `BufferedInputStream`/`BufferedReader` em torno de qualquer `InputStream`/`Reader` agrupa leituras físicas em blocos de tamanho de memória, em vez de uma chamada de sistema por byte ou caractere.

```java
try (BufferedReader br = new BufferedReader(new FileReader("log.txt"))) {
    String line;
    while ((line = br.readLine()) != null) {
        process(line);
    }
}
```

Para saída, `PrintWriter` é a contraparte baseada em caracteres do `PrintStream` baseado em bytes (que é o que `System.out` realmente é) — a mesma API `print`/`println`/`printf`, mas envolvendo um `Writer` para compor de forma limpa com outros streams de caracteres:

```java
try (PrintWriter pw = new PrintWriter(new FileWriter("report.txt"))) {
    pw.printf("Total: %,d%n", total);
}
```

### Serialização: transformando um grafo de objetos em bytes

`ObjectOutputStream`/`ObjectInputStream` escrevem e leem objetos inteiros — incluindo tudo que eles referenciam transitivamente — em vez de bytes ou caracteres individuais. Só é elegível uma classe que implementa a interface marcadora vazia `Serializable` (ou a mais manual `Externalizable`); todo campo é salvo, exceto campos `static` e campos marcados `transient`.

```java
class Session implements Serializable {
    private static final long serialVersionUID = 1L;
    String user;
    transient String cachedToken;   // recomputed, not persisted
    int loginCount;
}

try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream("session.bin"))) {
    oos.writeObject(new Session());
}

try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream("session.bin"))) {
    Session restored = (Session) ois.readObject();
}
```

Declarar `serialVersionUID` explicitamente importa: sem isso, a JVM calcula um a partir da estrutura da classe, então uma mudança de código *não relacionada* (adicionar um método, reordenar membros em alguns casos) pode silenciosamente produzir um UID calculado diferente e tornar dados serializados antigos ilegíveis — `InvalidClassException` no momento da deserialização. Omitir `Serializable` completamente em `Session` falha da mesma forma, com `NotSerializableException`.

### Risco de deserialização e ObjectInputFilter

`readObject()` não só popula campos — a deserialização constrói objetos de qualquer classe que o stream de bytes afirme ser, executando a lógica de deserialização própria daquela classe ao longo do caminho. Se o stream de bytes vem de uma fonte não confiável, isso é um convite para executar código escolhido pelo atacante: um stream forjado pode instanciar classes nunca destinadas a ser deserializadas (gadget chains) apenas nomeando-as, sem chamar nenhum método da aplicação primeiro. Essa é uma classe de vulnerabilidade Java antiga e de alta gravidade, e a única resposta totalmente segura é não deserializar dados não confiáveis de jeito nenhum.

Quando deserializar entrada externa não pode ser evitado, a mitigação moderna é o `ObjectInputFilter` (`java.io`, desde o JDK 9): um filtro inspeciona cada classe, tamanho de array e métrica do grafo (profundidade, contagem de referências, tamanho do stream) *antes* de ele ser materializado, e pode rejeitá-lo completamente.

```java
ObjectInputFilter filter =
    ObjectInputFilter.Config.createFilter("com.example.Session;!*");

try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream("session.bin"))) {
    ois.setObjectInputFilter(filter);
    Session restored = (Session) ois.readObject();   // anything but Session is rejected
}
```

O padrão é uma lista de permissão/negação separada por ponto e vírgula: `com.example.Session` permite exatamente aquela classe, `!*` nega tudo o mais, e padrões de limite como `maxdepth=5;maxrefs=1000;maxbytes=8192;maxarray=10000` limitam o uso de recursos (`maxarray` limita o maior array que o stream pode alocar). Um filtro pode ser definido por stream com `setObjectInputFilter()`, ou para a JVM inteira com `ObjectInputFilter.Config.setSerialFilter()` (ou a property de sistema `jdk.serialFilter`), de modo que todo `ObjectInputStream` que não define seu próprio filtro fica coberto por padrão.

> Desde o JDK 17 (JEP 415), um único filtro global não é a única opção para a JVM inteira: `ObjectInputFilter.Config.setSerialFilterFactory()` (ou a property de sistema `jdk.serialFilterFactory`) registra uma **filter factory** em vez disso — uma função invocada para todo `ObjectInputStream` conforme ele é criado (e de novo sempre que o filtro daquele stream é definido), de modo que partes diferentes de uma aplicação podem receber filtros diferentes, específicos ao contexto, em vez de compartilhar um filtro para a JVM inteira. Esse é o mecanismo recomendado hoje para aplicações que deserializam mais de um tipo de payload confiável.

## Trade-offs

- **Streams de bytes vs. streams de caracteres é uma escolha de correção, não só de conveniência.** Ler texto por meio de um stream de bytes sem especificar um charset amarra o resultado ao charset padrão da JVM, que varia por plataforma; um stream de caracteres (ou um argumento `Charset` explícito) torna a codificação parte do código em vez de parte do ambiente.
- **try-with-resources elimina uma categoria inteira de bugs de vazamento de recurso, ao custo de o escopo do recurso ficar preso ao bloco `try`.** Um recurso declarado no `try` é implicitamente `final`, então não pode ser reatribuído ou reutilizado fora dele — a abordagem tradicional com `finally` ainda é ocasionalmente necessária, por exemplo quando um recurso precisa sobreviver ao bloco que o cria.
- **A serialização é conveniente, mas frágil diante da evolução da classe.** Adicionar, remover ou reordenar campos em uma classe `Serializable` pode invalidar um `serialVersionUID` calculado e quebrar a deserialização de dados já persistidos; declarar `serialVersionUID` explicitamente transforma isso em uma decisão de versionamento deliberada, em vez de um acidente.
  ```java
  class V1 implements Serializable { int a; }          // no explicit serialVersionUID
  class V2 implements Serializable { int a; int b; }    // different computed UID
  // deserializing V1 data as V2: InvalidClassException
  ```
- **Deserializar dados não confiáveis é um risco de segurança, não só de integridade de dados.** `readObject()` sobre bytes controlados por um atacante pode instanciar classes arbitrárias do classpath antes de qualquer código da aplicação rodar; `ObjectInputFilter` mitiga isso com uma lista de permissão, mas a opção mais segura é evitar completamente a deserialização de entrada não confiável — parsear para um formato de dados simples (JSON, um DTO) em vez disso.
- **O `java.io` puro ainda merece seu lugar ao lado do `Path`/`Files` do NIO.2.** A abstração de stream (`InputStream`/`Reader` e afins) é o que a maioria das APIs — clients HTTP, bibliotecas de compressão, serialização — de fato consome, então `java.io` continua sendo a camada de interoperabilidade mesmo em código que, fora isso, faz navegação de sistema de arquivos e operações em massa em arquivos através de `Path`/`Files` (veja o conceito de NIO.2 para essa API em profundidade).

## Documentation Links

- [InputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/InputStream.html) — doc
- [OutputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/OutputStream.html) — doc
- [Reader — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Reader.html) — doc
- [Writer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Writer.html) — doc
- [AutoCloseable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html) — doc
- [Serializable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
- [ObjectInputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html) — doc
- [ObjectInputFilter — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputFilter.html) — doc
- [JEP 290: Filter Incoming Serialization Data](https://openjdk.org/jeps/290) — doc
- [JEP 415: Context-Specific Deserialization Filters](https://openjdk.org/jeps/415) — doc
