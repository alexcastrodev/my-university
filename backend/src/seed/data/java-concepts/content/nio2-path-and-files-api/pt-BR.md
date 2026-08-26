---
version: 1.0
updatedAt: 2026-08-05
title: "NIO.2: A API Path e Files"
summary: Como o java.nio.file substitui o java.io.File por exceções informativas e específicas em vez de retornos booleanos, adiciona o DirectoryStream para iteração de diretório fechável/filtrável, suporte de primeira classe a links simbólicos e o WatchService para reagir a mudanças no sistema de arquivos em vez de fazer polling.
---
## Objective

NIO.2 (`java.nio.file`, adicionado no JDK 7) é o substituto moderno do `java.io.File`: representa um local com a interface `Path`, realiza operações de arquivo através da classe estática `Files`, e adiciona recursos reais de sistema de arquivos que o `File` nunca teve — reconhecimento de links simbólicos e notificações de mudança através do `WatchService`. A diferença central não é cosmética: os métodos do `File` reportam falha retornando `false` ou não fazendo nada, enquanto os métodos do `Files` lançam uma exceção checada específica que diz exatamente o que deu errado.

## Use Cases

- Scripts de deployment que precisam saber *por que* uma cópia ou movimentação falhou (destino já existe vs. permissão negada vs. origem inexistente) em vez de simplesmente receber `false`.
- Ferramentas de build que percorrem um diretório de artefatos de release onde `current` é um link simbólico para a versão ativa, e o código precisa detectar e seguir (ou não seguir) esse link deliberadamente.
- Listagem filtrada e de uso único das entradas imediatas de um diretório (por glob ou predicado customizado) sem precisar de um `Stream<Path>` recursivo completo.
- Pipelines de file-drop ou hot-reload que reagem a arquivos aparecendo em uma pasta em vez de fazer polling nela com um timer.
- Migração incremental de código legado construído sobre `java.io.File`, usando `File.toPath()` e `Path.toFile()` como ponte entre as duas APIs.

## Deep Dive

### As falhas silenciosas do File vs. as exceções informativas do Files

`java.io.File` reporta a maioria das falhas como um booleano ou simplesmente não faz nada — nunca diz *por quê*:

```java
File target = new File("/no/such/dir/report.txt");
boolean ok = target.createNewFile(); // false — o diretório pai não existe, nenhuma mensagem
```

```java
File missing = new File("ghost.txt");
boolean deleted = missing.delete();  // false — o arquivo nunca existiu, ainda sem mensagem
```

`Files` realiza as mesmas operações, mas lança uma exceção específica e informativa:

```java
Path target = Path.of("/no/such/dir/report.txt");
Files.createFile(target);
// throws NoSuchFileException: /no/such/dir/report.txt

Path missing = Path.of("ghost.txt");
Files.delete(missing);
// throws NoSuchFileException: ghost.txt

Path notEmpty = Path.of("some-dir");
Files.delete(notEmpty);
// throws DirectoryNotEmptyException: some-dir (if it contains entries)
```

`deleteIfExists()` é o único método que mantém propositalmente o formato "seguro, sem exceção" — retorna `true`/`false` para existência, mas ainda assim lança exceção se o diretório não estiver vazio ou ocorrer um erro de I/O, então também não é um método de falha silenciosa.

### DirectoryStream: um iterador fechável, filtrável e de uso único

`Files.list()`/`Files.walk()` (já conhecidos do tópico básico de NIO) retornam um `Stream<Path>`. `DirectoryStream<Path>`, obtido via `Files.newDirectoryStream()`, é a primitiva de nível mais baixo do NIO.2 sobre a qual eles são construídos: implementa tanto `AutoCloseable` quanto `Iterable<Path>`, então se encaixa diretamente em um try-with-resources e em um loop for-each:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(Path.of("."))) {
    for (Path entry : stream) {
        System.out.println(entry.getFileName());
    }
}
```

Ele pode filtrar por glob diretamente, sem um passo separado de `Stream.filter()`:

```java
try (DirectoryStream<Path> java = Files.newDirectoryStream(dir, "*.java")) {
    for (Path p : java) System.out.println(p);
}
```

Ou por um `DirectoryStream.Filter<Path>` customizado, quando a condição não é baseada em nome:

```java
DirectoryStream.Filter<Path> writable = Files::isWritable;
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, writable)) {
    for (Path p : stream) System.out.println(p);
}
```

Seu iterador só pode ser obtido uma vez — chamar `iterator()` (ou rodar o for-each) uma segunda vez na mesma instância lança exceção:

```java
DirectoryStream<Path> stream = Files.newDirectoryStream(dir);
stream.iterator(); // fine
stream.iterator(); // throws IllegalStateException: iterator has already been returned
```

Um erro de I/O no meio da iteração (por exemplo, o diretório é removido enquanto você o percorre) aparece como `DirectoryIteratorException` envolvendo o `IOException` real, lançado por `hasNext()`/`next()` em vez de por `newDirectoryStream()` em si.

### Links simbólicos: um recurso de sistema de arquivos que o File não enxerga

`java.io.File` não tem nenhum conceito de link simbólico — ele segue um link de forma transparente e não expõe nenhum método para detectar que ele existia. O NIO.2 torna links algo de primeira classe e inspecionável:

```java
Path link = Path.of("current");
Files.createSymbolicLink(link, Path.of("release-2.3.0"));

Files.isSymbolicLink(link);      // true
Files.readSymbolicLink(link);    // release-2.3.0 (o destino do link, não resolvido)
Files.isDirectory(link);         // segue o link por padrão → true, se o destino for um diretório
Files.isDirectory(link, LinkOption.NOFOLLOW_LINKS); // false — o link em si não é um diretório
```

`readSymbolicLink()` lança `NotLinkException` se o caminho não for de fato um link simbólico — outro exemplo de uma falha específica e nomeada em vez de um booleano. `isSymbolicLink()` em si não segue esse mesmo padrão de "lançar exceção em caso de problema": retorna `false` silenciosamente tanto quando o caminho não é um link *quanto* quando o caminho simplesmente não existe, então um resultado `false` sozinho não diz em qual dos dois casos você está.

A maioria dos métodos de `Files` que tocam destinos de links (`copy`, `isDirectory`, `readAttributes`, ...) aceita `LinkOption.NOFOLLOW_LINKS` para operar sobre o próprio link em vez de segui-lo transparentemente — não existe equivalente algum em `File`.

### WatchService: reagindo a mudanças no sistema de arquivos em vez de fazer polling

`Path` implementa `Watchable`, então qualquer caminho pode se registrar em um `WatchService` para tipos específicos de eventos, em vez de um programa reescanear um diretório em um timer:

```java
try (WatchService watcher = FileSystems.getDefault().newWatchService()) {
    Path dir = Path.of("incoming");
    dir.register(watcher,
        StandardWatchEventKinds.ENTRY_CREATE,
        StandardWatchEventKinds.ENTRY_DELETE,
        StandardWatchEventKinds.ENTRY_MODIFY);

    while (true) {
        WatchKey key = watcher.take(); // blocks until an event is queued
        for (WatchEvent<?> event : key.pollEvents()) {
            if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                continue; // events may have been lost — consider re-scanning the directory
            }
            Path changed = (Path) event.context(); // name relative to the registered dir
            System.out.println(event.kind() + ": " + changed);
        }
        if (!key.reset()) break; // the watched directory became inaccessible
    }
}
```

`take()` bloqueia até que uma `WatchKey` tenha eventos; `poll()`/`poll(timeout, unit)` oferecem uma alternativa não bloqueante ou com tempo limite. `key.reset()` precisa ser chamado depois de processar os eventos para colocar a chave de volta no estado pronto — esquecer isso significa que a chave nunca mais dispara, mesmo que os eventos continuem acontecendo. `File` não tem equivalente algum: detectar mudanças com ele significa escrever seu próprio loop de polling comparando timestamps ou listagens de diretório.

## Trade-offs

- **Exceções exigem tratamento, não apenas um `if`** — os métodos de `Files` forçam um `try`/`catch` (ou uma declaração `throws`) para cada modo de falha específico em vez de uma única checagem booleana, o que é mais verboso, mas elimina o passo de debugging "retornou false, agora advinha por quê".
- **O iterador de `DirectoryStream` é de uso único** — reutilizar uma instância em dois loops é um bug, não uma escolha de estilo:

```java
DirectoryStream<Path> ds = Files.newDirectoryStream(dir);
for (Path p : ds) { /* ok */ }
for (Path p : ds) { /* IllegalStateException at iterator() */ }
```

- **Suporte a links simbólicos depende do sistema de arquivos e do SO** — `Files.createSymbolicLink()` lança `UnsupportedOperationException` em sistemas de arquivos sem suporte a links, e no Windows normalmente exige privilégios elevados ou Developer Mode; código que cria links precisa de um caminho alternativo ou de um requisito documentado.
- **`WatchService` é best-effort, não uma garantia em tempo real** — eventos podem ser coalescidos, chegar com latência dependente da plataforma, e transbordar em um único evento `OVERFLOW` se muitos se acumularem antes de você drená-los; é pouco confiável sobre sistemas de arquivos em rede e não substitui verificar o estado com `Files` depois que um evento dispara.

## Documentation Links

- [Files — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html) — doc
- [Path — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html) — doc
- [DirectoryStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/DirectoryStream.html) — doc
- [WatchService — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/WatchService.html) — doc
