---
version: 1.0
updatedAt: 2026-11-20
title: "Dados Binários: Endianness, BinaryReader e Arquivos Mapeados em Memória"
summary: BinaryWriter e BinaryReader byte a byte, prefixo de tamanho de 7 bits, endianness e BinaryPrimitives, um cabeçalho de arquivo real com StructLayout e MemoryMarshal, MemoryMappedFile (modos de acesso, Flush, ponteiro da vista, leitura sequencial e aleatória medidas) e System.IO.Hashing (Crc32, Crc64, XxHash3) contra SHA256 e MD5, com a ponte para memória virtual e page cache.
---
## Objective

Ler e escrever dados binários exige três decisões que o texto esconde: em quais bytes um valor se transforma (largura, ordem dos bytes, prefixo de string), como você chega aos bytes (um stream, um span, ou memória mapeada a partir do arquivo) e como você sabe que eles não foram danificados no caminho (um checksum). Este conceito mede cada uma. `BinaryWriter` e `BinaryReader` são cômodos e a saída deles é definida pelo runtime, não pela sua máquina. `BinaryPrimitives` e `[StructLayout]` com `MemoryMarshal` leem um cabeçalho de arquivo real em poucas instruções, se você respeitar a ordem dos bytes e o padding. `MemoryMappedFile` deixa o page cache do sistema operacional ser o seu buffer, o que ganha no acesso aleatório e não ganha numa leitura sequencial simples. `System.IO.Hashing` traz checksums CRC e xxHash que são de 4 a 70 vezes mais rápidos que `SHA256` e `MD5` aqui, e não são ferramentas de segurança. Tudo rodou numa máquina só, com o page cache quente.

Versões: .NET SDK 10.0.100 (runtime 10.0.0), TFM `net10.0`, NuGet `System.IO.Hashing` 10.0.15 (a 11.0.0 também resolve em `net10.0`), macOS 27.2 arm64, Apple M4 Max, 14 núcleos, 36 GiB de RAM, página de 16 KiB.

## Use Cases

- Um formato binário de arquivo (um segmento de log, um índice) com cabeçalho validado, um protocolo big-endian, consultas aleatórias num arquivo enorme, ou detectar um bloco corrompido.

## Deep Dive

### O que o `BinaryWriter` escreve

```csharp
var ms = new MemoryStream();
using (var w = new BinaryWriter(ms, Encoding.UTF8, leaveOpen: true))
{
    w.Write(true); w.Write((short)-2); w.Write(0x01020304); w.Write(1234567890123L);
    w.Write(1.5f); w.Write(1.5d); w.Write(12.34m); w.Write('A'); w.Write("héllo");
    w.Write(new byte[] { 0xDE, 0xAD });
}
```

```text
01 | FE FF | 04 03 02 01 | CB 04 FB 71 1F 01 00 00 | 00 00 C0 3F | 00 00 00 00 00 00 F8 3F
| D2 04 00 00 00 00 00 00 00 00 00 00 00 00 02 00 | 41 | 06 68 C3 A9 6C 6C 6F | DE AD    (53 bytes)
```

(Os `|` foram acrescentados aqui.) `bool` ocupa 1 byte, `short` 2, `int` 4, `long` 8, `float` 4, `double` 8, `decimal` 16, e `Write(char)` codifica um char com o encoding do writer (`A` ocupa 1 byte). O int `0x01020304` saiu como `04 03 02 01`: little-endian. Muitos tutoriais dizem "endianness do host". O código-fonte do runtime diz outra coisa: `BinaryWriter.Write(int)` chama `BinaryPrimitives.WriteInt32LittleEndian` e `BinaryReader.ReadInt32` usa o leitor little-endian, então o formato é little-endian em qualquer host (fonte e docs, medido só numa máquina little-endian). Isso é o que torna o arquivo portável, e significa que o `BinaryWriter` não escreve um protocolo big-endian.

Strings levam um prefixo de tamanho codificado em 7 bits, contado em bytes codificados, não em chars:

```text
string of 5 chars:      prefix 1 byte  [05], total 6
string of 127 chars:    prefix 1 byte  [7F], total 128
string of 128 chars:    prefix 2 bytes [80 01], total 130
string of 300 chars:    prefix 2 bytes [AC 02], total 302
string of 20000 chars:  prefix 3 bytes [A0 9C 01], total 20003
"ééé" (UTF-8):          06 C3 A9 C3 A9 C3 A9
"ab" with Encoding.Unicode (UTF-16): 04 61 00 62 00
```

São sete bits de dado por byte, e o bit alto diz "vem mais". `Write7BitEncodedInt` e `Write7BitEncodedInt64` são públicos: `300` vira `AC 02` e `-1L` ocupa 10 bytes (`FF` nove vezes e depois `01`). O encoding faz parte do formato: bytes UTF-8 lidos de volta com `Encoding.Latin1` viraram `hÃ©llo`, então o leitor precisa do encoding do escritor. `Write('\uD83D')` (metade de um par substituto) lançou `ArgumentException`: escreva uma `string`.

### Posse, flush e falha

```text
default dispose closes the stream: CanWrite=False
over FileStream, before Flush: length on disk 0 (fs.Length 4); after bw.Flush(): 4
ReadInt32 on 3 bytes: EndOfStreamException   ReadString, 6 bytes of FF: FormatException
```

`leaveOpen: true` mantém o stream aberto, como em [Stream Class Hierarchy and Decorators](/csharp-concepts/stream-class-hierarchy-and-decorators). O `BinaryWriter` não tem buffer próprio, então `Flush` só pede ao stream que faça flush: sobre um `FileStream`, os 4 bytes ainda estavam no buffer do stream. Uma entrada truncada é uma `EndOfStreamException`, não um valor curto, e um prefixo de string corrompido é `EndOfStreamException` ou `FormatException`: valide tamanhos lidos de entrada não confiável antes de usá-los. O custo é uma chamada ao stream por campo. Lendo 16.777.216 ints (64 MiB), mediana de 7:

```text
BinaryReader.ReadInt32 over MemoryStream:          43.2 ms
BinaryReader.ReadInt32 over FileStream (4 KiB):   108.6 ms
BinaryReader.ReadInt32 over FileStream (1 MiB):   100.8 ms
BinaryPrimitives.ReadInt32LittleEndian on span:     6.8 ms
MemoryMarshal.Cast<byte,int> loop:                  4.9 ms
File.ReadAllBytes + Cast loop:                     13.9 ms
```

Cerca de 6 ns por campo pelo stream, 0,4 ns por um span. Um buffer maior no `FileStream` não ajudou: o custo é o caminho de cada chamada, não as chamadas de sistema. Ler o arquivo de uma vez e interpretar spans é 8 vezes mais rápido que o `BinaryReader` sobre o arquivo, ao preço de manter os dados em memória.

### Endianness e `BinaryPrimitives`

`BitConverter.IsLittleEndian` foi `True` (arm64 e x64 são little-endian na prática). Protocolos de rede (cabeçalhos TCP/IP) e muitos formatos são big-endian. `BinaryPrimitives` lê e escreve numa ordem declarada e só troca os bytes quando o host é diferente:

```text
BitConverter.GetBytes(0x01020304):  04 03 02 01
WriteInt32BigEndian:                01 02 03 04
ReverseEndianness(0x01020304) = 0x04030201
ReadInt32BigEndian({00 00 01 00}) = 256    ReadInt32LittleEndian(same bytes) = 65536
TryWriteUInt64LittleEndian into 6 bytes: False   into 8 bytes: True  88 77 66 55 44 33 22 11
ReadInt32BigEndian on 3 bytes: ArgumentOutOfRangeException   TryReadInt32BigEndian: False
```

`BitConverter.ToInt32` não tem argumento de ordem: lê na ordem do host, então um campo big-endian lido com ele deu 65536 em vez de 256. Use o par `Read*`/`Write*` para um span, as formas `Try*` quando entrada curta é esperada, e `ReverseEndianness` para um valor que já está numa variável.

### Um cabeçalho real com `Span<byte>` e `[StructLayout]`

Um arquivo começa com um cabeçalho de 24 bytes: magic `DAT1`, versão e flags big-endian (u16), contagem de registros (u32), data de criação (i64) e CRC32 do payload (u32), little-endian. O jeito portável escreve cada campo com a ordem explícita:

```csharp
public void WritePortable(Span<byte> dst)
{
    "DAT1"u8.CopyTo(dst);
    BinaryPrimitives.WriteUInt16BigEndian(dst[4..], Version);
    BinaryPrimitives.WriteUInt16BigEndian(dst[6..], Flags);
    BinaryPrimitives.WriteUInt32LittleEndian(dst[8..], RecordCount);
    BinaryPrimitives.WriteInt64LittleEndian(dst[12..], CreatedUnixMs);
    BinaryPrimitives.WriteUInt32LittleEndian(dst[20..], PayloadCrc);
}
```

O jeito sem cópia mapeia os bytes numa struct com `MemoryMarshal.Read<T>` e `Write<T>` e troca os campos big-endian:

```csharp
[StructLayout(LayoutKind.Sequential, Pack = 1)]
struct RawHeader { public uint Magic; public ushort VersionBE, FlagsBE;
                   public uint RecordCountLE; public long CreatedUnixMsLE; public uint PayloadCrcLE; }

var raw = MemoryMarshal.Read<RawHeader>(src);                       // throws if src is shorter than 24
ushort version = BitConverter.IsLittleEndian ? BinaryPrimitives.ReverseEndianness(raw.VersionBE) : raw.VersionBE;
```

Os dois produziram os mesmos 24 bytes e a ida e volta foi igual:

```text
44 41 54 31 | 00 03 | 80 01 | 03 00 00 00 | 00 64 C0 9E 9A 01 00 00 | 86 55 0F 3E
 magic DAT1 | v3 BE | fl BE  | count 3 LE  | 1763600000000 LE        | crc 0x3E0F5586 LE
bad magic 58585858 -> InvalidDataException (our own check)
MemoryMarshal.Read<RawHeader> on 10 bytes: ArgumentOutOfRangeException
```

O caminho da struct exige três disciplinas. Primeiro, o tamanho: sem `Pack = 1` o CLR alinha os campos, e o layout deixa de bater com o arquivo:

```text
NaturalPad { byte Flag; long Timestamp }:   16 bytes: 01 00 00 00 00 00 00 00 | 08 07 06 05 04 03 02 01
Packed (Pack = 1) same fields:               9 bytes: 01 | 08 07 06 05 04 03 02 01
```

Os 7 bytes de padding foram zero aqui, mas o conteúdo deles não é garantido, então nunca calcule hash nem compare como bytes uma struct com padding. Segundo, `MemoryMarshal.Read<T>` não aceita tipo com referências (`Read<string>` é erro de compilação, CS0453, e uma struct que contém uma lança `ArgumentException: Only value types without pointers or references are supported` em tempo de execução, medido) e não valida: um campo `bool` com o byte `2` foi lido sem exceção. Terceiro, uma struct empacotada tem campos desalinhados, o que funciona em x64 e arm64 e é o motivo de o formato do arquivo, não o layout do CLR, ser o contrato. Use a forma portável quando o formato é o contrato e a forma da struct para um cabeçalho fixo e quente. Um record `Header` montado a partir do bruto mantém os valores já trocados fora do resto do código.

### Arquivos mapeados em memória

`MemoryMappedFile` pede ao SO que mapeie um arquivo no espaço de endereços do processo: leituras viram page faults atendidos pelo page cache, sem chamada `read` e sem cópia para um buffer seu. `CreateFromFile` cria um mapa persistido; `CreateNew(null, capacity)` cria um não persistido (memória anônima, sem arquivo). Comportamentos medidos no macOS:

```text
capacity 0 on a 100 byte file:        view.Capacity = 100 (whole file)
capacity 4096 on a 100 byte file:     file grew to 4096 bytes
capacity 50 on a 100 byte file:       ArgumentOutOfRangeException
empty file, capacity 0:               ArgumentException (a positive capacity is required)
Read map with capacity > file:        ArgumentException
ReadWrite view on a Read map:         UnauthorizedAccessException
Write on a Read view:                 NotSupportedException
CopyOnWrite: view[0]=99, file[0]=1    (the file is not changed)
```

Modos de acesso: `Read`, `ReadWrite`, `CopyOnWrite` (cópia privada, nunca gravada de volta) no mapa, e uma vista só pode ser tão permissiva quanto o mapa. Uma vista recebe um offset e um tamanho. Uma vista no offset 5000 (sem alinhamento de página) funcionou: `Capacity` 100, `PointerOffset` 5000 e o primeiro byte estava certo, porque o runtime mapeia a partir do limite de página logo abaixo (16 KiB aqui, `Environment.SystemPageSize`) e entrega o deslocamento dentro dela. Uma vista que passou do fim do arquivo de 20000 bytes lançou `UnauthorizedAccessException`, e `ReadInt32` dois bytes antes do fim da vista lançou `ArgumentException`.

Escrever por uma vista `ReadWrite` não usa um buffer separado. Depois de `view.Write(0, 0x01020304)` e nenhum `Flush`, `File.ReadAllBytes` já devolveu `04 03 02 01`, e um processo filho que mapeou o arquivo leu `12345` enquanto o pai nunca chamou `Flush` (uma máquina, um page cache). `Flush()` limpa os buffers da vista e grava no arquivo, e segundo a doc um mapa persistido é salvo quando o último processo termina de usá-lo. Então o `Flush` não torna o dado visível: é o passo para durabilidade e antes de ler por outro caminho que ignora o cache (não medido: queda de energia).

`ViewStream` embrulha uma vista como `Stream` com seek (`Length` 4, `CanSeek` True, `ReadByte` no fim devolveu -1), então código de stream lê uma região mapeada. Para o acesso mais rápido, pegue o ponteiro:

```csharp
using var view = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
byte* p = null;
view.SafeMemoryMappedViewHandle.AcquirePointer(ref p);
try { var span = new ReadOnlySpan<byte>(p + view.PointerOffset, (int)view.Capacity); /* use span */ }
finally { view.SafeMemoryMappedViewHandle.ReleasePointer(); }   // needs AllowUnsafeBlocks
```

`AcquirePointer` mantém o handle da vista vivo enquanto você segura o ponteiro (docs), então você precisa chamar `ReleasePointer`. O tamanho de um span é um `int`, então uma vista acima de 2 GiB pede várias vistas ou aritmética de ponteiro. Os acessores genéricos funcionaram com uma struct: `Write<Pt>`/`Read<Pt>` de `{int X; double Y}` gravou `03 00 00 00 | 00 00 00 00 | 00 00 00 00 00 00 12 40` (o padding da própria struct incluído).

Memória compartilhada: `CreateNew("name", ...)`, `CreateOrOpen`, `OpenExisting` e `CreateFromFile` com `mapName` lançaram todos `PlatformNotSupportedException: Named maps are not supported` no macOS. No Windows eles são o mecanismo de IPC (só docs aqui). No Unix, compartilhe um arquivo: dois processos mapeando o mesmo arquivo viram os mesmos bytes (acima). Dentro de um processo, `CreateNew(null, 4096)` deu duas vistas que enxergavam uma à outra (`777`). Truncar um arquivo enquanto ele está mapeado não lançou exceção na chamada que truncou (vista de 8192 bytes, arquivo cortado para 100). Tocar uma página além do novo fim causa falha segundo a documentação, e uma falha numa vista mapeada pode derrubar o processo em vez de lançar exceção (docs, não executado), o principal perigo de mapear um arquivo que outro processo pode alterar.

### Medindo leituras: 512 MiB, cache quente

O arquivo tinha 512 MiB de bytes aleatórios gerados no diretório temporário desta sessão (escrito em 3,0 s, removido no fim). Todos os números são com page cache quente: o arquivo foi escrito instantes antes e lido uma vez para calcular a soma esperada, e os tempos ficaram estáveis de uma execução para outra (variação abaixo de 3 por cento), que é como um arquivo residente se comporta. Não foi possível rodar com cache frio: o `purge` exige root aqui, e esvaziar o cache não é uma chamada que o runtime ofereça. Números a frio são dominados pelo disco, não pela API, e reduziriam as diferenças abaixo. Cada método somou o arquivo como `ulong`s (a soma de cada execução bateu), mediana de 7 após um aquecimento:

```text
Sequential full read                                        median   min   max   MiB/s
FileStream, 4 KiB buffer, Read in 4 KiB                     84 ms   83    85     6,129
FileStream, bufferSize 0, Read in 1 MiB                     44 ms   43    44    11,574
File.ReadAllBytes (one 512 MiB array)                       71 ms   71    74     7,166
RandomAccess.Read in 1 MiB chunks                           44 ms   43    45    11,608
MemoryMappedFile, new map each run, pointer span            41 ms   40    41    12,573
MemoryMappedFile, ViewStream + 1 MiB reads                  60 ms   60    60     8,550
MemoryMappedFile, accessor.ReadUInt64 per 8 bytes          640 ms  637   643       799
MemoryMappedFile, one map reused, pointer span              17 ms   17    17    29,421
array already in RAM (no I/O, for reference)                17 ms   17    18    29,394
```

Numa passada sequencial, `RandomAccess` em blocos de 1 MiB, um `FileStream` sem buffer e um mapa novo ficam a cerca de 7 por cento um do outro: todos custam uma ida ao page cache. `File.ReadAllBytes` paga uma alocação e uma cópia de 512 MiB (71 ms), e leituras de 4 KiB pagam uma chamada por 4 KiB. A passada mapeada reaproveitada é tão rápida quanto a memória (17 ms), e os 24 ms de diferença para o mapa novo são o custo de montar e fazer o fault do mapeamento. `ReadUInt64` a cada 8 bytes é 15 vezes mais lento que o ponteiro sobre um mapa novo: cada chamada do acessor checa limites e adquire o handle. Acesso aleatório, 1.000.000 de leituras de 8 bytes em offsets alinhados aleatórios:

```text
FileStream Seek + Read(8 bytes), bufferSize 0       471 ms   471 ns/read
RandomAccess.Read(handle, 8 bytes, offset)          492 ms   492 ns/read
MemoryMappedViewAccessor.ReadUInt64(offset)          40 ms    40 ns/read
pointer from AcquirePointer, unsafe read             25 ms    25 ns/read
```

Aqui o mapa ganha de 12 a 20 vezes, porque cada leitura por handle é uma chamada de sistema e uma leitura pelo mapa é um load de memória. A frio, uma leitura pelo mapa é um page fault que lê do disco, e o primeiro toque em cada página de 16 KiB paga por ele (não medido).

### Ponte: memória virtual e page cache

Um arquivo mapeado é memória virtual usada de propósito. O SO dá a cada página um lugar no seu espaço de endereços, carrega no primeiro toque (um page fault) e pode despejá-la depois, e o `read` passa pelo mesmo page cache, por isso os resultados sequenciais convergem. O [modelo de working set](/papers/the-working-set-model-for-program-behavior) de Denning explica por que um processo cujas páginas tocadas recentemente cabem na memória roda rápido e um que não cabe sofre thrashing: um índice de acesso aleatório cabe quando as páginas quentes dele cabem. O [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) descreve o page cache do Linux como uma política LRU aproximada que funciona mal para certas cargas, um scan grande que expulsa páginas úteis por exemplo, e esse é o custo de deixar o kernel decidir o que fica. Uma passada sequencial de 512 MiB sobre um arquivo que você também usa para consultas é esse caso. O mapeamento não dá controle nenhum sobre o despejo.

### Checksums com `System.IO.Hashing`

O pacote `System.IO.Hashing` é separado do shared framework (`dotnet add package System.IO.Hashing`). Ele traz `Crc32` (IEEE 802.3), `Crc64` (ECMA-182 Annex B), `XxHash32`, `XxHash64`, `XxHash3` e `XxHash128`, todos derivados de `NonCryptographicHashAlgorithm`. Cada um tem uma forma estática de uma chamada e uma instância incremental:

```csharp
uint crc = Crc32.HashToUInt32(data);                // data is a ReadOnlySpan<byte>
ulong h = XxHash3.HashToUInt64(data, seed: 1);
byte[] bytes = XxHash128.Hash(data);                // 16 bytes; HashToUInt128 also exists

var x = new XxHash3();
foreach (var chunk in chunks) x.Append(chunk);      // also Append(Stream) and AppendAsync(Stream)
byte[] digest = x.GetCurrentHash();                 // GetHashAndReset() starts over
```

Verificações que rodaram: `Crc32("123456789")` é `0xCBF43926` (o valor de verificação padrão), `Crc64` é `0x6C40DF5F0B497347` (o valor do ECMA-182), `XxHash3` é `0x72DCB18B67A17DFF` (seed 0) e `0xE967C19057995816` (seed 1); um buffer de 1.000.003 bytes alimentado em blocos de 4.096 bytes deu o mesmo `XxHash3` de uma chamada só, e `GetCurrentHash` pode ser chamado duas vezes; `TryHash` para 3 bytes devolveu `False`, e `Crc32.Hash(source, destination)` com 3 bytes lançou `ArgumentException`. Um bit invertido mudou o `Crc32` de `53C537E1` para `483F4B68`. A forma em bytes depende do algoritmo: `Crc32.Hash` devolveu `26 39 F4 CB`, os bytes little-endian de `0xCBF43926`, enquanto os bytes de `XxHash64`, `XxHash3` e `Crc64` saíram na ordem do inteiro (`8C B8 41 DB ...` para `0x8CB841DB...`). Se você guarda um hash num cabeçalho, guarde o inteiro na ordem que você escolheu, como no cabeçalho acima, e não o array de bytes de um algoritmo.

Vazão, uma thread, buffer de 256 MiB em RAM, mediana de 7 (duas execuções a mais concordaram em até 3 por cento):

```text
Crc32      8.6 ms  29.0 GiB/s      XxHash3     18.5 ms  13.5 GiB/s      SHA256   88.6 ms   2.82 GiB/s
Crc64      4.7 ms  53.2 GiB/s      XxHash128   18.5 ms  13.5 GiB/s      SHA1     88.3 ms   2.83 GiB/s
XxHash32  22.6 ms  11.1 GiB/s      XxHash64    11.3 ms  22.1 GiB/s      SHA512  153.9 ms   1.62 GiB/s
                                                                          MD5    329.0 ms   0.76 GiB/s
```

Para entradas de 64 bytes (5.000.000 de hashes): `Crc32` 2,8 ns, `XxHash64` 6,8 ns, `XxHash3` 12,5 ns, `SHA256` 192 ns, `MD5` 289 ns, e `string.GetHashCode` numa chave de 25 chars 9,9 ns. A ordem medida difere da afirmação comum de que o `XxHash3` é o mais rápido: nesta CPU arm64 o `XxHash64` ganhou dele, e `Crc32` e `Crc64` ganharam dos dois (provavelmente instruções de CRC em hardware e multiplicação sem carry, não verificado). Isso pode ser diferente em x64 e não foi medido. O `SHA256` foi 3,7 vezes mais rápido que o `MD5` aqui, provavelmente por suporte a SHA em hardware (não verificado, e não medido em outras CPUs). `string.GetHashCode` não é uma chave estável: `"abc"` deu 285973014 num processo e 1718255714 no seguinte.

Eles não são criptográficos. A classe base se chama `NonCryptographicHashAlgorithm`, e o motivo não é a velocidade: quem conhece o algoritmo constrói outra entrada com o mesmo valor de CRC ou xxHash, e não há chave. Use onde o adversário é ruído: um checksum contra corrupção (o CRC de um segmento, um download), uma chave estável de partição ou de tabela entre processos e versões (`GetHashCode` não é uma), ou deduplicação de dados em que você confia. Use `SHA256` (ou `HMACSHA256` quando há um segredo) para uma assinatura, uma checagem de senha ou qualquer entrada que um atacante controle. O `Crc32` também não diz que o dado é o que você queria, só que ele não foi danificado de um jeito que o CRC detecta.

### Livro vs hoje

- Material mais antigo lê dados binários com `BinaryReader` ou `Marshal.PtrToStructure`, troca bytes com `Array.Reverse` e `BitConverter.IsLittleEndian`, e diz que arquivos mapeados em memória são o jeito rápido de ler um arquivo. Hoje as APIs de span leem um campo em 0,4 ns contra cerca de 6 ns pelo `BinaryReader`, o `BinaryPrimitives` substitui o código de troca de bytes, e um mapa só é claramente mais rápido no acesso aleatório (25 a 40 ns contra cerca de 480 ns por leitura de 8 bytes aqui), não numa passada sequencial (41 ms contra 44 ms).
- Conselho antigo usa `MD5` ou `SHA1` como "checksum rápido". Medido aqui, o `MD5` foi o hash mais lento (0,76 GiB/s), 38 vezes mais lento que o `Crc32`, e também não é seguro para segurança.
- Código antigo conta com mapas nomeados para memória compartilhada. Funcionam no Windows e lançam `PlatformNotSupportedException` no macOS (medido); compartilhe um arquivo mapeado ou use um pipe.

## Trade-offs

- **`BinaryReader` é simples e lento por campo.** Bom para leituras pequenas e raras, cerca de 6 ns por campo aqui. Para um arquivo grande, leia tudo e interprete um span, ou use `BinaryPrimitives` sobre um buffer (`ReadInt32LittleEndian(buffer.AsSpan(8))`).
- **O formato fixa a ordem dos bytes, não o host.** `BinaryWriter` é little-endian, um protocolo pode ser big-endian, então escreva cada campo com a chamada nomeada do `BinaryPrimitives`. Um cast de struct pede a guarda `BitConverter.IsLittleEndian` e `Pack = 1` (`byte` mais `long` ocupa 16 bytes por padrão, 9 empacotado), e continua sem validar.
- **Mapear compensa só em acesso aleatório ou reuso.** Uma passada sequencial ficou a cerca de 7 por cento de um laço com `RandomAccess`. Leituras aleatórias de 8 bytes foram de 12 a 20 vezes mais rápidas mapeadas.
- **Mapear muda onde os erros aparecem e aumenta o risco.** Um erro de I/O ou um arquivo truncado por outro processo vira uma falha na página mapeada, não uma exceção numa chamada `Read` (docs, não executado). Não mapeie arquivos que outros escritores possam encolher. Spans sobre uma vista são limitados a 2 GiB.
- **`Flush` é para durabilidade.** O dado ficou visível para um segundo processo sem ele. Chame antes de depender de os bytes estarem no disco, e faça `Dispose` da vista antes do mapa.
- **CRC e xxHash detectam dano, não adulteração.** De 4 a 70 vezes mais rápidos que `SHA256` e `MD5` aqui, e falsificáveis de propósito. Escolha pela ameaça: corrupção pede CRC ou xxHash, um atacante pede um hash criptográfico.
- **Números com cache quente são o melhor caso.** Um arquivo frio é limitado pelo disco e as diferenças entre as APIs de leitura diminuem. Meça na máquina de destino, com o estado de cache de destino.

## Documentation Links

- [BinaryWriter class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.binarywriter) (doc)
- [BinaryReader class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.binaryreader) (doc)
- [BinaryPrimitives class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.binary.binaryprimitives) (doc)
- [BitConverter.IsLittleEndian, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.bitconverter.islittleendian) (doc)
- [MemoryMarshal.Read, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.memorymarshal.read) (doc)
- [StructLayoutAttribute.Pack, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.structlayoutattribute.pack) (doc)
- [Memory-mapped files, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/memory-mapped-files) (doc)
- [MemoryMappedFile class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.memorymappedfiles.memorymappedfile) (doc)
- [MemoryMappedViewAccessor.Flush, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.memorymappedfiles.memorymappedviewaccessor.flush) (doc)
- [SafeBuffer.AcquirePointer, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safebuffer.acquirepointer) (doc)
- [System.IO.Hashing namespace, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.hashing) (doc)
- [NonCryptographicHashAlgorithm class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.hashing.noncryptographichashalgorithm) (doc)
- [RandomAccess class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.randomaccess) (doc)
