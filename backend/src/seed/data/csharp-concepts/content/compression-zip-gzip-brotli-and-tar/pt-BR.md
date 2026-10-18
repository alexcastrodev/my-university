---
version: 1.0
updatedAt: 2026-10-15
title: "Compressão: ZIP, GZip, Brotli e Tar"
summary: Codecs de stream como decorators, o que CompressionLevel realmente entrega, ZipArchive em memória e em disco com as APIs assíncronas do .NET 10, tar, zip slip e como limitar o tamanho descomprimido.
---
## Objective

Compressão em .NET é um conjunto de decorators sobre `Stream` (GZip, Deflate,
ZLib, Brotli) mais dois formatos de arquivo com APIs próprias (ZIP em
`ZipArchive` e `ZipFile`, tar em `System.Formats.Tar`). A maioria dos erros do
dia a dia não é sobre o algoritmo: um compressor que nunca foi descartado, um
"nível" que significa coisas diferentes em cada codec, um nome de entrada que
sai da pasta de destino e poucos kilobytes de entrada que viram gigabytes. Este
conceito cobre os codecs de stream, o que `CompressionLevel` compra de fato, ZIP
em memória e em disco incluindo as APIs assíncronas do .NET 10, tar e as regras
de extração que impedem um arquivo não confiável de causar estrago. O padrão
decorator em si está no conceito da hierarquia de Stream.

## Use Cases

- Compactar com gzip uma resposta, um arquivo de log ou um payload antes de ir
  para a rede.
- Montar uma exportação ZIP em memória e devolvê-la de um endpoint.
- Descompactar um arquivo enviado por um usuário sem deixar que ele escreva fora
  de uma pasta.
- Empacotar uma árvore de diretórios como `.tar.gz` para um container Linux ou um
  artefato de CI.

## Deep Dive

### Os codecs são decorators, e o Dispose é o que fecha o arquivo

`GZipStream`, `DeflateStream`, `ZLibStream` e `BrotliStream` envolvem outro
stream. Passe `CompressionMode.Decompress` para ler, ou um `CompressionLevel`
para escrever. O compressor retém dados até ser descartado, e é o `Dispose` que
escreve o trailer. Todos os números abaixo são do .NET 10.0.0 (SDK 10.0.100),
macOS, com um payload de 785 KB de linhas JSON repetitivas.

```csharp
var ms = new MemoryStream();
var g = new GZipStream(ms, CompressionMode.Compress, leaveOpen: true);
g.Write(data);
Console.WriteLine(ms.Length);   // 39440  (ainda não é um gzip válido)
g.Dispose();
Console.WriteLine(ms.Length);   // 50094  (cabeçalho, último bloco e CRC escritos)
```

`leaveOpen: true` é como você mantém o stream interno utilizável depois que o
compressor some, o que é necessário com `MemoryStream` e `ToArray()`. Sem ele,
descartar o decorator descarta o `MemoryStream` também. Os primeiros bytes do
resultado foram `1F 8B 08`, o número mágico do gzip mais o byte do método
deflate. Dar dados que não são gzip a um `GZipStream` em modo de descompressão
lançou `InvalidDataException` ("The archive entry was compressed using an
unsupported compression method").

Os quatro codecs são formatos diferentes, não quatro velocidades da mesma coisa.
GZip, ZLib e Deflate puro usam o mesmo algoritmo com enquadramentos diferentes
(saídas de 50094, 50082 e 50076 bytes em `Optimal`). Brotli é outro algoritmo e,
nesta entrada de texto, produziu 17242 bytes em `Optimal`, um terço do tamanho.

### O que CompressionLevel significa

A documentação diz que os valores "não correspondem a níveis de compressão
específicos; o objeto que implementa a compressão decide como tratá-los" (no
original: "do not correspond to specific compression levels"). Medido no mesmo
payload:

| Nível | gzip | brotli |
|---|---|---|
| `Fastest` | 85049 bytes | 46550 bytes |
| `Optimal` | 50094 bytes | 17242 bytes |
| `SmallestSize` | 49844 bytes | 14926 bytes (uma execução: 633 ms, contra cerca de 2 ms em `Optimal`) |

No gzip, `SmallestSize` rendeu meio por cento sobre `Optimal`. No Brotli rendeu
13 por cento e custou duas ordens de grandeza em tempo. Então `Optimal` é o
padrão certo, `Fastest` para caminhos quentes em que CPU importa mais que bytes,
e `SmallestSize` só para dados comprimidos uma vez e servidos muitas (assets
estáticos em tempo de build). Bytes aleatórios não comprimem: 100000 bytes
aleatórios viraram 100053 com gzip. Formatos já comprimidos (JPEG, PNG, `.docx`,
um ZIP) se comportam igual, então pule o codec para eles.

### Entrada truncada nem sempre é erro

Cortei um stream comprimido válido ao meio e descomprimi com `CopyTo`.
`GZipStream`, `DeflateStream` e `BrotliStream` terminaram sem exceção, devolvendo
350290, 350303 e 280633 dos 733390 bytes originais. A documentação que conferi
não descreve isso, então trate como comportamento observado desta versão do
runtime, não como contrato: se você precisa detectar um download cortado,
carregue o tamanho esperado ou um hash junto com os dados e compare depois da
leitura.

### ZipArchive: modos, memória e entradas

`ZipArchive` tem três modos. `Create` escreve entradas em sequência e funcionou
sobre um stream sem seek. `Read` abre um arquivo existente. `Update` permite
`Delete()` e `CreateEntry()` num arquivo existente e grava as mudanças no
dispose; depois de apagar `a.txt` e criar `b.txt`, uma releitura mostrou só
`b.txt`. No modo Read, o stream da entrada é só para frente (`Length` lançou
`NotSupportedException`).

```csharp
using var za = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true);
var e = za.CreateEntry("a.txt", CompressionLevel.Optimal);
using (var s = e.Open()) s.Write(bytes);   // 10000 'a' -> zip de 136 bytes em memória
```

Cada entrada informa `Length` e `CompressedLength`: para 10000 bytes idênticos,
10000 e 28. Esses tamanhos vêm do cabeçalho do próprio arquivo, o que os torna
uma checagem antecipada útil e não uma garantia. Nomes de entrada são UTF-8
(`ação/ü.txt` sobreviveu a uma ida e volta). `Name` é o último segmento e
`FullName` é o caminho inteiro; para `../escaped.txt` foram `escaped.txt` e
`../escaped.txt`.

O .NET 10 adicionou contrapartes assíncronas das operações pesadas (confirmado
em What's new in .NET libraries for .NET 10): `ZipArchive.CreateAsync`,
`ZipArchiveEntry.OpenAsync`, `ZipFile.OpenAsync`, `ZipFile.OpenReadAsync`,
`ZipFile.CreateFromDirectoryAsync`, `ZipFile.ExtractToDirectoryAsync` e os
equivalentes de `ZipFileExtensions`. A mesma página diz que o modo `Update` não
carrega mais todas as entradas na memória e que a extração é paralelizada.
Executei o caminho de criar, abrir e ler:

```csharp
await using var za = await ZipArchive.CreateAsync(fs, ZipArchiveMode.Create,
    leaveOpen: false, entryNameEncoding: null);
await using var s = await za.CreateEntry("hello.txt").OpenAsync();
```

Ler de volta com `ZipFile.OpenReadAsync` imprimiu `hello async`. Não medi as
afirmações de desempenho.

### Zip slip: onde a extração dá errado

Uma entrada chamada `../escaped.txt` é uma entrada de arquivo legal. Um
extrator escrito à mão que faz `Path.Combine(dest, entry.FullName)` resolve para
a pasta pai; para `/abs-escaped.txt`, `Path.Combine` devolve o caminho absoluto e
descarta `dest` por completo. Os helpers do framework verificam isso: montei um
arquivo com `ok/a.txt`, `../escaped.txt`, `/abs-escaped.txt` e
`..\win-escaped.txt`, e `ZipFile.ExtractToDirectory` lançou `IOException`
("Extracting Zip entry would have resulted in a file outside the specified
destination directory"), nada foi escrito fora da pasta, e `ok/a.txt` já tinha
sido extraído antes da falha. Ou seja, a extração não é transacional: extraia
para uma pasta temporária nova e mova em caso de sucesso. A entrada com
contrabarra é outra lição: no macOS o `Name` foi a string inteira (contrabarra é
um caractere comum lá), mas no Windows é separador. Só executei isto no macOS.

Se você extrai manualmente, resolva e compare, com o separador final para que
`/data/out-evil` não passe numa checagem de `/data/out`:

```csharp
var full = Path.GetFullPath(Path.Combine(dest, entry.FullName));
var prefix = Path.GetFullPath(dest) + Path.DirectorySeparatorChar;
if (!full.StartsWith(prefix, StringComparison.Ordinal)) throw new InvalidDataException(entry.FullName);
```

A API de tar tem a mesma proteção: `TarFile.ExtractToDirectory` num arquivo com
uma entrada `../tar-escaped.txt` lançou `IOException` e não escreveu nada. Uma
diferença: o diretório de destino do tar precisou existir antes
(`DirectoryNotFoundException` caso contrário), enquanto `ZipFile` o criou.

### Tar e a bomba de descompressão

`System.Formats.Tar` (.NET 7 em diante) escreve e lê tar, que não tem compressão
própria: para `.tar.gz` você empilha um `GZipStream` por baixo.
`TarFile.CreateFromDirectoryAsync(src, gzip, includeBaseDirectory: false)` e
`ExtractToDirectoryAsync(gzip, dest, overwriteFiles: false)` fizeram a ida e
volta de um diretório, e `TarReader` mostrou as entradas no formato `Pax` com
modos Unix (`755` para o diretório, `644` para o arquivo). Esse formato e esses
modos são o motivo de tar servir melhor que ZIP para artefatos Linux.

Entrada comprimida também pode mentir sobre o custo. 512 MiB de zeros viraram
521844 bytes com `SmallestSize`; uma entrada ZIP de 64 MiB de zeros ocupou 65232
bytes. O limite não é a velocidade de descompressão, e sim memória e disco. Limite
o que você aceita contando enquanto copia:

```csharp
while ((n = src.Read(buf)) > 0)
    if ((total += n) > limit) throw new InvalidDataException("too large"); // parou em 10546656 de 10485760 permitidos
```

## Trade-offs

- **Brotli ganha do gzip em texto, gzip está em todo lugar.** 17242 contra 50094
  bytes aqui, mas um cliente ou ferramenta que só conhece gzip não lê Brotli.
  ```csharp
  new BrotliStream(output, CompressionLevel.Optimal)   // menor; confira se o consumidor suporta
  ```
- **`SmallestSize` é uma escolha de build.** A execução com Brotli levou 633 ms
  para 785 KB.
- **ZIP é acesso aleatório, tar é uma sequência.** ZIP busca uma entrada pelo
  diretório central; um `.tar.gz` precisa ser descomprimido desde o início, mas
  mantém modos Unix e funciona bem em streaming.
- **`ExtractToDirectory` é seguro para nomes e inseguro para volume.** Ele barra
  fugas de caminho, mas não limita número de entradas nem tamanho total, e pode
  deixar um resultado parcial.
- **ZIP em memória é simples até o arquivo ficar grande.** O modo `Update` em
  particular guarda estado; use `Create` em streaming quando puder.
- **Não confie no tamanho do cabeçalho como limite.** Conte os bytes enquanto lê.

## Lab

Neste lab você recebe `Codecs`, `ZipTools` e `TarTools` com os métodos **vazios** (`NotImplementedException`). O seu trabalho é comprimir e descomprimir com os codecs de stream, montar e ler arquivos ZIP e tar em memória e extrair arquivos não confiáveis sem deixá-los escrever fora de uma pasta nem expandir sem limite. A ideia central é que compressores são decorators de `Stream` com armadilhas de ciclo de vida (o trailer só é escrito no `Dispose`) e que um arquivo hostil pode mentir sobre tamanhos e caminhos.

**O cenário**

Tudo roda em memória, exceto os testes de extração, que usam uma pasta temporária única apagada pelos testes. Os testes nunca conferem tamanhos comprimidos exatos (variam com o runtime), só ida e volta, "menor que a entrada" e comportamento.

- `Codecs.cs`: `Gzip`/`Gunzip` e `BrotliCompress`/`BrotliDecompress`.
- `ZipTools.cs`: `CreateZip`, `ReadZip` (com limite de bytes) e `ExtractSafely`.
- `TarTools.cs`: `CreateTarGz` e `ReadTarGz`.

**O que você vai fazer, passo a passo**

1. **Comprimir com GZip (TODO-00).** Comprima com `GZipStream` num `MemoryStream` e devolva os bytes. Armadilha: o compressor só escreve cabeçalho e trailer quando é descartado, e descartá-lo também descarta o `MemoryStream`, a menos que `leaveOpen` seja `true`. `Gunzip` descomprime e dados que não são gzip devem dar `InvalidDataException`.
2. **Trocar para Brotli com nível (TODO-01).** Mesmo padrão com `BrotliStream`, respeitando o `CompressionLevel` pedido (`Fastest`, `Optimal` ou `SmallestSize`).
3. **Criar um ZIP em memória (TODO-02).** `CreateZip` usa `ZipArchiveMode.Create`, uma entrada por arquivo. Lembre do `leaveOpen` e de descartar o archive **antes** do `ToArray()`. Um dicionário vazio deve produzir um ZIP válido e vazio.
4. **Ler com proteção contra decompression bomb (TODO-03).** `ReadZip` lê toda entrada de arquivo (ignorando nomes que terminam em `/`) para um dicionário por `FullName`. Conte os bytes enquanto copia e lance `InvalidDataException` quando o total passar de `maxTotalBytes`, somando todas as entradas. Não confie em `entry.Length`: cabeçalhos podem mentir.
5. **Extrair sem zip-slip (TODO-04).** `ExtractSafely` cria o destino se faltar e resolve cada entrada com `Path.GetFullPath`, comparando com o caminho completo do destino **com** separador final (para `out-evil` não passar por `out`). Lance `InvalidDataException` para entrada ruim (`../`, caminho absoluto, pasta irmã) e valide **todas** as entradas antes de escrever qualquer uma.
6. **Empilhar tar e gzip (TODO-05).** `CreateTarGz` usa um `TarWriter` (formato Pax) sobre um `GZipStream`, porque o tar não comprime sozinho; a ordem de descarte importa: `TarWriter` primeiro, depois o `GZipStream`. `ReadTarGz` usa um `GZipStream` de descompressão sob um `TarReader` e coleta as entradas que têm `DataStream`.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que sem `leaveOpen` o `ToArray()` quebra, por que a validação precisa vir antes de escrever e por que o limite é contado durante a cópia.

**Desafios opcionais**

- **TODO-06:** corte um stream gzip válido ao meio e descomprima com `CopyTo`. Lança exceção? O que você levaria junto com os dados (tamanho, hash) para detectar um download cortado?
- **TODO-07:** reimplemente `CreateZip` com a API assíncrona do .NET 10 (`ZipArchive.CreateAsync`, `OpenAsync`) e compare com `ZipArchiveMode.Update`: apague uma entrada de um archive existente e adicione outra.

**Pré-requisitos:** `Stream` e `MemoryStream`, `using` e `IDisposable`, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário, então os testes vermelhos são o seu checklist.

## Documentation Links

- [What's new in .NET libraries for .NET 10, ZIP files, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [How to compress and extract files, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/how-to-compress-and-extract-files) (doc)
- [CompressionLevel Enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.compressionlevel) (doc)
- [ZipArchive Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.ziparchive) (doc)
- [TarFile Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.tar.tarfile) (doc)
- [BrotliStream Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.brotlistream) (doc)
