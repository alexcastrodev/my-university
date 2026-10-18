---
version: 1.0
updatedAt: 2026-10-14
title: "APIs de Sistema de Arquivos e Paths Multiplataforma"
summary: Path.Join versus Path.Combine, diferenças entre sistemas operacionais, FileMode, FileAccess, FileShare e FileOptions, enumeração preguiçosa, links simbólicos, substituição segura de arquivos e acesso por offset com OpenHandle e RandomAccess.
---
## Objective

A maioria dos bugs com arquivos em .NET não está em ler bytes, e sim em tudo ao
redor: um path montado com o método errado que escapa em silêncio da pasta que
você queria, um arquivo aberto com um modo de compartilhamento que trava o
próximo chamador, uma enumeração que é um retrato do momento quando você queria
uma visão ao vivo, um link simbólico que faz uma varredura recursiva passar duas
vezes pelo mesmo diretório, ou um "salvar" que deixa um arquivo pela metade
depois de um crash. Este conceito cobre as APIs de sistema de arquivos de
`System.IO` com foco nessas bordas: `Path.Join` versus `Path.Combine`, o que muda
entre sistemas operacionais, as flags `FileMode`, `FileAccess`, `FileShare` e
`FileOptions`, enumeração preguiçosa com `EnumerationOptions`, links simbólicos,
substituição segura de arquivos e acesso por offset com `File.OpenHandle` e
`RandomAccess`. Os tipos de stream em si são tratados no conceito da hierarquia
de Stream.

## Use Cases

- Montar um path a partir de um nome de arquivo informado pelo usuário sem deixar
  que ele substitua a pasta base.
- Varrer uma árvore de diretórios grande sem carregar todos os paths na memória
  de uma vez.
- Salvar um arquivo de configuração de modo que um crash nunca o deixe truncado.
- Ler e atualizar registros de tamanho fixo num arquivo grande, a partir de
  várias threads, sem uma posição de stream compartilhada.

## Deep Dive

### Path.Combine versus Path.Join

`Path.Combine` e `Path.Join` juntam as partes com um separador, mas divergem
quando uma parte posterior é rooted (um path absoluto). `Combine` trata essa
parte como um novo começo e descarta tudo o que veio antes. `Join` só
concatena.

```csharp
Console.WriteLine(Path.Combine("data", "/etc/passwd")); // /etc/passwd
Console.WriteLine(Path.Join("data", "/etc/passwd"));    // data/etc/passwd
Console.WriteLine(Path.Join("data/", "/reports"));      // data//reports
Console.WriteLine(Path.Join("a", "b", "c", "d", "e"));  // a/b/c/d/e
```

A primeira linha é a perigosa: se o segundo argumento vem de um usuário, um valor
rooted escapa de `data`. A documentação de `Path.Join` faz exatamente esse
alerta, e é por isso que `Join` (disponível desde o .NET Core 2.1, com overloads
para spans e, a partir do .NET 9, para `ReadOnlySpan<string>`) é o padrão mais
seguro para pedaços não confiáveis. Duas coisas que `Join` não faz: não remove
separadores duplicados (a terceira linha, observada nesta máquina, mantém as duas
barras) e não torna o path seguro. Um pedaço como `../../x` continua subindo
níveis. Para confinar um path, resolva e compare:

```csharp
var baseDir = Path.GetFullPath("data") + Path.DirectorySeparatorChar;
var full = Path.GetFullPath(Path.Join("data", userInput));
if (!full.StartsWith(baseDir, StringComparison.Ordinal))
    throw new InvalidOperationException("Path escapes the base folder");
```

`GetFullPath` normaliza os segmentos `.` e `..` (nesta máquina,
`a/../b/./c.txt` virou `<cwd>/b/c.txt`) e `GetRelativePath("/a/b", "/a/c/d.txt")`
devolveu `../c/d.txt`. Outros membros úteis: `IsPathFullyQualified`, mais
estrito que `IsPathRooted` no Windows (um path como `\temp` é rooted mas não é
fully qualified), `GetFileName`, `GetExtension` (só a última extensão: `.gz` para
`z.tar.gz`) e `EndsInDirectorySeparator`.

### O que muda entre sistemas operacionais

Três coisas diferem, e ajuda separar o que foi observado do que vem da
documentação.

- **Separadores.** `Path.DirectorySeparatorChar` é `/` no Linux e no macOS e `\`
  no Windows, que também aceita `/`. Observado aqui no macOS:
  `DirectorySeparatorChar` e `AltDirectorySeparatorChar` eram ambos `/`, e
  `Path.GetFileName(@"C:\x\y.txt")` devolveu a string inteira, porque a barra
  invertida é um caractere comum num nome de arquivo Unix. Gravar um arquivo
  chamado `a\b.txt` criou exatamente um arquivo com esse nome. A documentação de
  `Path.Join` avisa sobre a mesma armadilha com paths do Windows escritos
  literalmente no código.
- **Maiúsculas e minúsculas.** Se `Report.txt` e `REPORT.TXT` são o mesmo arquivo
  depende do sistema de arquivos, não só do SO. Observado aqui (macOS, APFS com a
  configuração padrão sem distinção de caixa), `File.Exists` deu `true` para as
  duas grafias. Sistemas de arquivos Linux costumam distinguir caixa e os do
  Windows não, mas isso vem da documentação e de conhecimento geral, não desta
  execução. Nunca presuma um comportamento: compare nomes com
  `StringComparison.Ordinal` quando precisar de correspondência estrita. O
  casamento de padrões na enumeração tem seu próprio controle,
  `EnumerationOptions.MatchCasing`, cujo padrão é `PlatformDefault`.
- **Permissões.** O Windows usa ACLs e o Unix usa bits de modo. O .NET expõe o
  segundo como `File.GetUnixFileMode` e `SetUnixFileMode` (marcados como não
  suportados no Windows, então o analisador avisa quando você os chama sem
  proteção).

### FileMode, FileAccess, FileShare, FileOptions

O construtor de `FileStream` e `File.OpenHandle` recebem quatro escolhas
independentes. `FileMode` diz o que fazer quanto à existência, `FileAccess` diz o
que este handle pode fazer, `FileShare` diz o que os outros podem fazer enquanto
isso, e `FileOptions` traz dicas e comportamentos.

| Modo | Arquivo não existe | Arquivo existe |
|---|---|---|
| `CreateNew` | cria | `IOException` |
| `Create` | cria | trunca |
| `Open` | `FileNotFoundException` | abre |
| `OpenOrCreate` | cria | abre |
| `Truncate` | `FileNotFoundException` | esvazia |
| `Append` | cria | abre, posicionado no fim |

`Append` só funciona com acesso de escrita: combiná-lo com
`FileAccess.ReadWrite` lança `ArgumentException` (confirmado rodando). O
compartilhamento é checado nos dois lados: a segunda abertura precisa ser
compatível com o que a primeira permitiu, e o que a primeira permitiu precisa ser
compatível com o que a segunda pede.

```csharp
using var first = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
using var second = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
// IOException: The process cannot access the file '...' because it is being used by another process.
```

Dois leitores que permitem `FileShare.Read` conviveram sem problema. No Windows,
`FileShare` é imposto pelo SO. No Unix, o código-fonte do runtime
(`SafeFileHandle.Unix.cs` no dotnet/runtime) emula o recurso com um `flock` que o
próprio comentário chama de "only advisory": `FileShare.None` pega um lock
exclusivo e os demais valores um lock compartilhado. Isso protege você de outro
código .NET abrindo o arquivo com flags incompatíveis, mas um programa que nunca
chama `flock` pode ignorá-lo. Minha execução foi dentro de um único processo,
então a afirmação entre processos vem desse código-fonte, não deste experimento.

`FileOptions` combina flags como `Asynchronous` (necessária para I/O assíncrono
de verdade, veja o conceito de async I/O), `SequentialScan` e `RandomAccess`
(dicas de read-ahead), `WriteThrough` e `DeleteOnClose`. `DeleteOnClose` é uma
forma simples de ter um arquivo temporário que se limpa sozinho:

```csharp
var tmp = Path.Join(dir, Path.GetRandomFileName());
using (var t = new FileStream(tmp, new FileStreamOptions
{
    Mode = FileMode.CreateNew, Access = FileAccess.ReadWrite,
    Share = FileShare.None, Options = FileOptions.DeleteOnClose
}))
{
    t.WriteByte(1);
    Console.WriteLine(File.Exists(tmp)); // True
}
Console.WriteLine(File.Exists(tmp));     // False
```

`Path.GetRandomFileName()` devolve um nome de 12 caracteres e não cria nada,
enquanto `Path.GetTempFileName()` cria um arquivo vazio na pasta temporária do
sistema. Prefira o primeiro junto com `CreateNew` para não deixar arquivos
esquecidos.

### Enumeração preguiçosa e EnumerationOptions

`Directory.GetFiles` devolve um array: o diretório é lido uma vez, de antemão.
`Directory.EnumerateFiles` devolve um `IEnumerable<string>` que lê conforme você
itera. Os dois comportamentos apareceram numa mesma execução: um arquivo criado
depois de chamar `EnumerateFiles` mas antes de iterar apareceu na sequência,
enquanto o array de `GetFiles` ficou com 4 entradas quando um quinto arquivo
surgiu. Numa árvore grande, `Enumerate*` também permite parar cedo sem nunca
guardar todos os paths. O custo é que o resultado não é um retrato estável, e o
handle subjacente vive até você terminar ou descartar o enumerador.

`EnumerationOptions` substitui `SearchOption` com controle mais fino:

```csharp
var opts = new EnumerationOptions
{
    RecurseSubdirectories = true,
    MatchCasing = MatchCasing.CaseInsensitive,
    IgnoreInaccessible = true,            // ignora pastas ilegíveis (já é o padrão)
    AttributesToSkip = FileAttributes.Hidden | FileAttributes.ReparsePoint,
    MaxRecursionDepth = 8,
};
foreach (var f in Directory.EnumerateFiles(root, "*.log", opts)) { }
```

Com `MatchCasing.CaseSensitive`, o padrão `*.LOG` casou 0 arquivos aqui e com
`CaseInsensitive` casou 6, na mesma pasta, que é a forma limpa de obter uma
resposta determinística independente do padrão da plataforma.

### Links simbólicos

`File.CreateSymbolicLink` e `Directory.CreateSymbolicLink` criam links (no
Windows isso pode exigir privilégios ou o modo desenvolvedor). Um
`FileSystemInfo` expõe `LinkTarget` (o texto literal gravado no link, `sub` aqui,
relativo à pasta do link) e `ResolveLinkTarget(returnFinalTarget)`, e um link tem
`FileAttributes.ReparsePoint` ligado. A consequência importante para varreduras:
por padrão `AttributesToSkip` é só `Hidden | System`, então uma enumeração
recursiva segue links de diretório. Com uma pasta `sub` real e um link para ela,
uma busca recursiva por `deep.log` encontrou 2 arquivos, e acrescentar
`AttributesToSkip = FileAttributes.ReparsePoint` trouxe o resultado de volta para
1. Um link que aponta para um de seus próprios pais pode fazer a varredura descer
muito fundo até `MaxRecursionDepth` ou o limite de tamanho do path pará-la.

### Substituir arquivos sem perdê-los

`File.WriteAllText(path, ...)` trunca primeiro, então um crash no meio deixa um
arquivo quebrado. A correção usual é gravar um arquivo temporário irmão e trocá-lo
no lugar: `File.Move(tmp, target, overwrite: true)` (o overload com `overwrite`
existe desde o .NET Core 3.0) ou `File.Replace(tmp, target, backupPath)`, que
também guarda o conteúdo antigo como backup (os dois funcionaram como esperado
aqui). Coloque o temporário no mesmo diretório, porque mover entre volumes é uma
cópia seguida de exclusão e perde a atomicidade. Chame `FlushToDisk` (ou
`FileStream.Flush(true)`) antes da troca quando os dados precisarem sobreviver a
uma queda de energia, já que um `Flush` simples só entrega os bytes ao sistema
operacional.

### Acesso aleatório com OpenHandle e RandomAccess

Um `FileStream` tem uma única posição, então duas threads lendo offsets
diferentes precisam de lock ou de dois streams. `File.OpenHandle` devolve um
`SafeFileHandle` sem posição nenhuma, e a classe estática `RandomAccess` lê e
escreve num offset explícito. A documentação a descreve como baseada em offset e
thread-safe, e afirma que só arquivos regulares em disco e com seek são
suportados (não pipes).

```csharp
using var h = File.OpenHandle(path, FileMode.Create, FileAccess.ReadWrite);
for (var i = 0; i < 4; i++)
    RandomAccess.Write(h, BitConverter.GetBytes(i * 100), fileOffset: i * 4);

var buf = new byte[4];
RandomAccess.Read(h, buf, fileOffset: 8);      // 200
Console.WriteLine(RandomAccess.GetLength(h));  // 16
RandomAccess.Read(h, buf, fileOffset: 1000);   // devolve 0 no fim ou além dele
RandomAccess.SetLength(h, 8);
RandomAccess.FlushToDisk(h);
```

Abra com `FileOptions.Asynchronous` para usar `RandomAccess.ReadAsync` e
`WriteAsync`; várias chamadas podem rodar ao mesmo tempo num único handle (duas
leituras em paralelo devolveram `0,-1` depois que um registro foi sobrescrito
com -1). Também há overloads que recebem uma lista de buffers para I/O
scatter/gather: uma chamada preencheu dois buffers de 4 bytes e devolveu 8. Como
não há cursor, também não há buffer, então muitas leituras minúsculas custam uma
chamada de sistema cada. Leia um registro inteiro por vez, ou ponha um cache seu
na frente.

## Trade-offs

- **`Join` remove a surpresa do path rooted, mas não o risco de traversal.** Ele
  nunca descarta a base, mas `..` ainda sobe níveis, então a entrada do usuário
  precisa da checagem de resolver e comparar de qualquer forma.
  ```csharp
  Path.Join("data", "../secret.txt"); // data/../secret.txt, que GetFullPath resolve para um irmão de data
  ```
- **`Combine` continua certo quando a segunda parte é confiável e pode ser
  absoluta.** Uma configuração como "pasta de logs, relativa ao app ou absoluta"
  é exatamente o que a regra dele modela. Escolha por quem controla o segundo
  argumento.
- **`FileShare.None` é um lock, não uma garantia.** Ele impede a segunda abertura,
  mas dá uma falha para tratar (`IOException`) em vez de esperar. No Unix o lock é
  advisory, então não barra programas que não são .NET. Tente de novo com um
  pequeno atraso ou use um mecanismo de coordenação de verdade quando a disputa
  for normal.
- **Enumeração preguiçosa economiza memória e abre mão de consistência.**
  Arquivos que aparecem ou somem durante a varredura mudam o resultado, e um
  arquivo apagado pode lançar exceção quando você o abre depois. Use `GetFiles`
  (uma cópia) quando precisar de uma lista estável, e ainda assim espere que a
  abertura posterior possa falhar.
- **Substituição atômica exige temporário no mesmo volume.** Um temporário na
  pasta temp do sistema é cômodo e pode estar em outro volume, transformando o
  move "atômico" numa cópia.
- **`RandomAccess` é rápido e de baixo nível.** Sem buffer, sem cursor, sem
  suporte a pipes, e cada chamada precisa de um offset que você calculou. Para
  texto sequencial ou pipelines de stream, `FileStream` com buffer é mais simples
  e geralmente tão rápido.

## Lab

Neste lab você recebe `FileOps` e `RecordFile` com os corpos **vazios** (`NotImplementedException`). O seu trabalho é tratar as bordas do `System.IO`: montar caminhos a partir de entrada não confiável sem escapar de uma pasta, enumerar árvores com `EnumerationOptions`, trocar arquivos sem nunca deixá-los pela metade, usar `FileShare` para recusar aberturas concorrentes e ler e escrever registros por offset com `RandomAccess`. A ideia central é que cada API tem uma armadilha (`Path.Combine`, case da plataforma, links simbólicos) e o lab faz você pisar em cada uma.

**O cenário**

Operações de arquivo que precisam funcionar igual em Windows, Linux e macOS.

- `FileOps.SafeJoin`: junta uma entrada do usuário a uma pasta base e confina o resultado.
- `FileOps.FindFiles` e `CountByName`: enumeração recursiva com profundidade, caixa e links simbólicos.
- `FileOps.SaveAtomically`: grava um arquivo sem nunca danificar o antigo.
- `FileOps.TryOpenExclusive`: abre com `FileShare.None`.
- `RecordFile`: um arquivo de registros de 4 bytes (`int`) acessados por índice, sem posição de stream, de propósito sem `FileStream`.

Cada teste cria sua própria pasta temporária e a apaga depois, e as asserções nunca fixam `/` ou `\`: usam `Path.Combine`. O teste de link simbólico retorna cedo se o link não puder ser criado (Windows sem privilégio). No Unix o `FileShare` é emulado com locks consultivos, e o teste fica dentro de um processo, onde os dois comportamentos coincidem.

**O que você vai fazer, passo a passo**

1. **Confinar a entrada do usuário (TODO-00).** Em `SafeJoin`, use `Path.Join`, não `Path.Combine`: um `"/etc/passwd"` deve virar um pedaço relativo, não substituir a base. Resolva com `Path.GetFullPath` e lance `InvalidOperationException` se o resultado sair da base (cuidado com `..` e com uma pasta irmã como `<base>2`). Compare com o caminho base completo terminado em separador, usando `StringComparison.Ordinal`.
2. **Buscar arquivos de forma portável (TODO-01).** `FindFiles` devolve caminhos **relativos** à raiz (`Path.GetRelativePath`), ordenados com `StringComparer.Ordinal`. Use `Directory.EnumerateFiles` com um `EnumerationOptions` que recursa, ignora a caixa explicitamente e respeita `MaxRecursionDepth` (profundidade 0 são só os arquivos diretos).
3. **Decidir sobre links simbólicos (TODO-02).** `CountByName` conta os arquivos com aquele nome sob a raiz. Com `followLinks` falso, pule `FileAttributes.ReparsePoint` em `AttributesToSkip`; com verdadeiro, vale o comportamento padrão.
4. **Gravar de forma atômica (TODO-03).** `SaveAtomically` escreve num arquivo temporário na **mesma pasta** (`Path.GetRandomFileName()` e `FileMode.CreateNew`) e depois troca com `File.Move(tmp, path, overwrite: true)`. Se a enumeração ou a escrita falhar, apague o temporário e deixe a exceção subir. No fim não pode sobrar nenhum temporário.
5. **Recusar abertura concorrente (TODO-04).** `TryOpenExclusive` abre o arquivo existente para leitura e escrita com `FileShare.None`. Devolva `null` se outro handle já o segura (capture `IOException`), mas não engula `FileNotFoundException`.
6. **Acessar registros por offset (TODO-05).** Em `RecordFile`: abra ou crie o arquivo com `File.OpenHandle` e guarde o `SafeFileHandle`; `Count` vem de `RandomAccess.GetLength`; `Read` usa `RandomAccess.Read` com offset `index * RecordSize` e lança `ArgumentOutOfRangeException` para índice negativo ou `>= Count`; `Write` usa `RandomAccess.Write`, cresce o arquivo (a lacuna lê como zeros) e tem que ser seguro entre threads em índices diferentes.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `Path.Combine` seria inseguro com entrada do usuário, por que o temporário precisa estar na mesma pasta do destino e por que `RandomAccess` dispensa o controle de posição de um `FileStream`.

**Desafios opcionais**

- **TODO-06:** escreva um helper que devolve um `FileStream` num arquivo temporário novo que se apaga ao ser descartado (`FileOptions.DeleteOnClose`, `Path.GetRandomFileName()`, `FileMode.CreateNew`). Por que isso é melhor que `Path.GetTempFileName()`?
- **TODO-07:** escreva um teste que prove que `Directory.EnumerateFiles` é preguiçoso e `Directory.GetFiles` é um snapshot (crie um arquivo entre a chamada e a iteração). Quando escolher cada um?

**Pré-requisitos:** classes, `IEnumerable<T>` e noções de LINQ em C#, noções de `FileStream` (`using`, `FileMode`) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário com a dica, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Path.Join method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.path.join) (doc)
- [Path.Combine method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.path.combine) (doc)
- [FileShare enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare) (doc)
- [EnumerationOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.enumerationoptions) (doc)
- [File.CreateSymbolicLink method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.createsymboliclink) (doc)
- [RandomAccess class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.randomaccess) (doc)
- [File.OpenHandle method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.openhandle) (doc)
