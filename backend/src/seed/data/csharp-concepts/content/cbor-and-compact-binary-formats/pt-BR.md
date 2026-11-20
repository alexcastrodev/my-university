---
version: 1.0
updatedAt: 2026-11-20
title: "CBOR e formatos binários compactos"
summary: System.Formats.Cbor (CborWriter e CborReader) com os bytes em hexadecimal, o mesmo objeto em JSON, CBOR, MessagePack e Protobuf, modos de conformidade e ordem de chaves, leitura incremental do .NET 11 e COSE_Sign1 assinado e verificado, com a ponte para passkeys.
---
## Objective

CBOR (RFC 8949) é o modelo de dados do JSON com uma codificação binária: números, strings de texto,
arrays e mapas, mais byte strings, tags e um tamanho preciso para cada inteiro. É a codificação do
CoAP em IoT, do COSE (mensagens assinadas e cifradas) e dos passkeys do WebAuthn: o `attestationObject`
e a chave pública que um passkey registra são ambos CBOR. O .NET entrega o CBOR no pacote
`System.Formats.Cbor` (um `CborWriter` e um `CborReader` de baixo nível, sem mapeador de objetos) e o
COSE em `System.Security.Cryptography.Cose`. Este concept mede os bytes: como cada inteiro, float e
string é codificado, o mesmo objeto em JSON, CBOR, MessagePack e Protobuf, o que o
`CborConformanceMode` realmente muda, o leitor incremental do .NET 11 alimentado em pedaços e uma
mensagem COSE_Sign1 assinada e verificada com uma chave ES256 gerada na hora (nenhuma chave impressa).

Versões: .NET SDK 11.0.100, runtime 11.0.0, TFM `net11.0`, `System.Formats.Cbor` 11.0.0,
`System.Security.Cryptography.Cose` 11.0.0, `MessagePack` 2.5.307, `Google.Protobuf` 3.36.1, macOS
arm64. Para o .NET 10 os pacotes são a linha 10.0.x (rodei a 10.0.15 no SDK 10.0.100).

## Use Cases

- Mensagens compactas e com pouco esquema para dispositivos restritos e CoAP, onde os nomes de campo
  do JSON e o base64 custam bytes demais.
- Assinar um payload pequeno com COSE_Sign1 (um array CBOR com o payload e a assinatura) em vez de
  montar um JWT.
- Ler ou montar dados do WebAuthn num servidor relying party: o `attestationObject` e a COSE_Key da
  chave pública da credencial.

## Deep Dive

### A codificação, byte a byte

Cada item CBOR começa com um byte: os 3 bits de cima são o tipo maior, os 5 de baixo são o valor ou o
tamanho do comprimento que vem depois. O `CborWriter` escolhe a menor forma, e a saída bate com os
vetores do Apêndice A da RFC 8949:

```text
int 0: 00                  int 23: 17                 int 24: 1818
int 255: 18ff              int 256: 190100            int 65536: 1a00010000
int 4294967296: 1b0000000100000000                    int -1: 20      int -25: 3818
text "IETF": 6449455446    bytes 01020304: 4401020304
[1,[2,3],[4,5]]: 8301820203820405                     (spec: 8301820203820405)
tag 1 epoch 1363896240: c11a514b67b0                  (spec: c11a514b67b0)
```

De 0 a 23 cabe no byte inicial, depois vêm 1, 2, 4 e 8 bytes extras. O negativo `n` é guardado como
`-1 - n` no tipo maior 1, então `-1` é `20`. Uma tag é o tipo maior 6 envolvendo o próximo item:
`WriteUnixTimeSeconds` escreve a tag 1 (`c1`) mais um inteiro, e `WriteDateTimeOffset` escreve a tag 0
com uma string de texto ISO 8601 (`c074...`). O `CborTag` nomeia as tags registradas
(`UnixTimeSeconds`, `Uri`, `Base64Url`...).

Floats são encolhidos. `WriteDouble(21.5)` produziu `f94d60`, um float de meia precisão de 3 bytes,
enquanto `WriteDouble(1.1)` ficou `fb3ff199999999999a`, 9 bytes, porque 1.1 não é exato em larguras
menores. Isso valeu em `Lax`, `Strict` e `Canonical`; o `Ctap2Canonical` deu `fb4035800000000000` para
21.5 (a documentação diz que ele mantém a representação dos floats). O `ReadDouble()` aceita as três
larguras, que o `PeekState()` informa separadamente.

### Um objeto em quatro formatos

Uma leitura de sensor com um int, uma string curta, um double, um bool, um array de cinco ints, um
blob de 16 bytes e um timestamp, cada um escrito do jeito mais compacto que a biblioteca permite:

```text
JSON 131 bytes (System.Text.Json, blob em base64)
CBOR com chaves de texto 84 bytes
CBOR com chaves inteiras 54 bytes
MessagePack com chaves string 89 bytes, na forma de array 52 bytes
Protobuf (números de campo) 55 bytes
```

E 100 leituras assim num array só: JSON 12618, CBOR chaves de texto 8589, CBOR chaves inteiras 5589,
MessagePack chaves string 8503, Protobuf 5400. O custo é o mapa: todo registro repete sete nomes de
campo, e tirá-los (chaves inteiras no CBOR, forma de array no MessagePack, números de campo no
Protobuf) é o que chega perto de 55 bytes, cerca de 40% do tamanho do JSON. É a lição de system design
do concept de
[formatos de codificação de dados](/system-design/system-design-concepts/data-encoding-formats-and-schema-evolution)
em números: CBOR com chaves de texto é um JSON menor, não um formato com esquema. Parte da diferença
entre 84 e 89 é o `celsius` em meia precisão (3 bytes contra 9 no MessagePack). Escrevi os bytes do
Protobuf com o `CodedOutputStream` de baixo nível (sem `.proto`, sem `protoc`). São tamanhos, não
velocidade: nada foi medido em benchmark.

### Leitura: PeekState e uma máquina de estados estrita

`ReadStartMap()` devolveu 7, depois um laço com `ReadTextString()` para a chave e um
`switch (r.PeekState())` para o valor:

```text
map(7): id=42(UnsignedInteger) device=sensor-7(TextString) celsius=21,5(HalfPrecisionFloat)
ok=True(Boolean) samples=[1,2,3,100,1000](StartArray) blob=bytes[16](ByteString) ts=1763600000(UnsignedInteger)
after map: Finished
```

O `CborReader` é um cursor só para frente, como o `Utf8JsonReader` (veja o concept de
[source generation e Utf8JsonReader](/csharp-concepts/system-text-json-source-generation-and-utf8jsonreader)):
você chama a leitura que combina com o próximo item ou recebe uma `InvalidOperationException` ("the
next CBOR data item is of major type '7'"). Não há mapeador de objetos, então mapear para um tipo é
código seu. Entrada truncada lança `CborContentException` ("Declared definite length of CBOR data item
exceeds available buffer size").

### Modos de conformidade e ordem das chaves

| Modo | O que acrescenta (docs e minhas execuções) |
|---|---|
| `Lax` | só bem formado; chaves duplicadas e mapas fora de ordem são lidos |
| `Strict` | rejeita chaves duplicadas (`CborContentException`), exige UTF-8 válido |
| `Canonical` | RFC 7049 3.9: chaves ordenadas, inteiros mínimos, sem comprimento indefinido |
| `Ctap2Canonical` | as regras do CTAP2: também sem tags, floats intocados |

O writer ordena as chaves para você nos modos canônicos. Chaves de texto escritas como `bb, a, aa, c`:

```text
Lax             a46262620161610262616103616304   (bb, a, aa, c: como escrito)
Canonical       a46161026163046261610362626201   (a, c, aa, bb)
```

Chaves inteiras escritas como `-2, 3, -1` saíram como `3, -1, -2` (`a3030020002100`) em `Canonical` e
`Ctap2Canonical`. A ordem é a dos bytes codificados (o mais curto primeiro, depois bytewise): `03`,
depois `20`, depois `21`. Importa porque a assinatura cobre bytes, então encoders que ordenam chaves
de modo diferente assinam bytes diferentes para o mesmo dado. O leitor também confere: `Canonical` em
`{"bb":1,"a":2}` lançou "CBOR keys not sorted in accordance with conformance mode 'Canonical'". Itens
de comprimento indefinido (`9f 01 02 ff`) foram lidos em `Lax` e `Strict`, lançaram em `Canonical`, e
um writer com `convertIndefiniteLengthEncodings: true` os reescreveu como `820102`. O pacote documenta
as regras canônicas da RFC 7049 e do CTAP2; a RFC 8949 definiu depois a codificação determinística, e
não testei como as duas diferem.

### Leitura incremental (.NET 11)

O .NET 11 traz o `CborReaderOptions` (`ConformanceMode`, `AllowMultipleRootLevelValues`, `MaxDepth`),
um construtor com `isFinalBlock` e o `CborReader.SlideData`, para ler um payload que chega em pedaços.
O objeto de 84 bytes acima, alimentado com 1, 3 e 7 bytes por vez, decodificou para o mesmo resultado
sempre:

```text
chunk 1: slides=83, id=42 device=sensor-7 celsius=21,5 ok=True samples=[1,2,3,100,1000] ...
chunk 3: slides=27, same result      chunk 7: slides=11, same result
```

```csharp
while (r.PeekState() == CborReaderState.NeedsMoreData)
{   // guarda a sobra não lida, anexa o próximo pedaço
    var left = buf.Slice(buf.Length - r.BytesRemaining);
    buf = Concat(left, nextChunk);
    r.SlideData(buf, isFinalBlock: last);
}
```

O `PeekState()` devolveu `NeedsMoreData` também quando um item foi cortado no meio (uma string de texto
dividida entre pedaços), então a sobra não lida precisa ser carregada adiante; o exemplo da
documentação omite isso (o comentário dele diz que o gerenciamento de buffer foi omitido). `Strict` e
`Canonical` rejeitam um bloco não final com `ArgumentException` ("only supported in the 'Lax'
conformance mode"), então streaming abre mão da validação. No pacote 10.0.15 o `CborReaderOptions` e o
`SlideData` não existem (CS0246, CS1061), e o writer produziu os mesmos bytes nas duas versões.

### COSE_Sign1: uma mensagem CBOR assinada

```csharp
using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
var signer = new CoseSigner(key, HashAlgorithmName.SHA256);
byte[] msg = CoseSign1Message.SignEmbedded(payload, signer);
bool ok = CoseMessage.DecodeSign1(msg).VerifyEmbedded(key);   // ECDsa, usa a parte pública
```

```text
signed: 84 bytes, header: d28443a10126a04a68656c6c6f20 ...
structure: tag 18, array(4), protected bstr 3 bytes, unprotected map(0), payload bstr 10 bytes, signature bstr 64 bytes
alg header (label 1) = -7; raw protected = a10126; content = hello cose
verify with public key: True   with another key: False
flip last signature bit: False   flip one payload bit (decoded "hemlo cose"): False
detached: 74 bytes, verify with payload True, with a different payload False
external AAD: verify with same True, without False
```

`d2` é a tag 18 (COSE_Sign1) e `84` um array de quatro: os headers protegidos como uma byte string
contendo `a10126` (o mapa `{1: -7}`, algoritmo ES256), um mapa não protegido vazio, o payload como byte
string e a assinatura de 64 bytes. A mensagem inteira tem 84 bytes para um payload de 10 bytes, sem
base64. O `SignDetached` deixa o payload de fora (74 bytes) e você o entrega ao `VerifyDetached`; o
AAD externo é um contexto assinado mas não transmitido. O `Decode` não verifica: um payload adulterado
decodificou normalmente e só o `Verify*` falhou, então nunca confie no `Content` antes de verificar. O
`CoseKey` (a partir de um `ECDsa` ou `RSA`) também funciona nas sobrecargas de verificação, e o
construtor dele com `MLDsa` é `[Experimental]` com o diagnóstico `SYSLIB5006` (lido por reflexão, não
executado). O `CoseMultiSignMessage` (vários assinantes) não foi medido.

### Ponte: passkeys e a trilha de identidade

Um registro de passkey devolve um `attestationObject`, um mapa CBOR com `fmt`, `attStmt` e `authData`,
e o `authData` termina com a chave pública da credencial como uma COSE_Key. Escrevi o formato dessa
chave com o `CborWriter` em modo `Ctap2Canonical`, adicionando as chaves na ordem "errada"
(`-3, 3, -2, 1, -1`) a partir de uma chave ES256 que gerei:

```text
COSE_Key 77 bytes, first 10: a5010203262001215820
key order on the wire: 1,3,-1,-2,-3
```

São os 77 bytes e o prefixo `a501020326200121582051cf...` que o concept de
[WebAuthn, FIDO2 e passkeys](/identity-concepts/webauthn-fido2-and-passkeys-concepts) mediu num
cerimônia de registro, onde o servidor Node dele decodifica com um codec de 30 linhas escrito à mão.
Num relying party em .NET você usaria o `CborReader` para o attestation object. Não decodifiquei um
attestation object real aqui, só montei o mapa da chave e comparei a forma com aquele concept. O modo
canônico é o que mantém a ordem das chaves fixa.

### Book vs today

Livros antigos ensinam ASN.1 com BER/DER para estruturas assinadas (X.509, CMS), depois o MessagePack
como "o JSON binário" e o Protobuf como "o formato com esquema". O ASN.1 ainda carrega certificados; os
outros mantiveram um nicho: Protobuf (e gRPC) para contratos de serviço com código gerado, MessagePack
como um JSON binário plug-and-play, CBOR onde um padrão já o escolheu (CoAP, COSE, CWT, WebAuthn). O
tamanho raramente decide: CBOR com chaves de texto (84 bytes) e MessagePack com chaves string (89)
ficam a 5 bytes um do outro, e só tirar as chaves muda o quadro (54, 52 e 55).

## Trade-offs

- **Só baixo nível.** `CborWriter` e `CborReader` dão controle exato e bytes que você confere na RFC,
  mas o mapeamento é seu, sem `Serialize<T>`. Para POCOs, MessagePack ou `System.Text.Json` é mais
  rápido de escrever.
- **As chaves custam mais que a codificação.** Chaves de texto deixaram o CBOR em 84 bytes contra 54
  com chaves inteiras, então um protocolo CBOR compacto escolhe rótulos inteiros pequenos (como o COSE
  faz) e perde legibilidade.
- **Os modos canônicos são estritos de propósito.** Lançam em comprimento indefinido e em mapas fora
  de ordem, o `Ctap2Canonical` também em tags e mantém doubles em 9 bytes. Escolha o modo que o padrão
  que você implementa nomeia.
- **Streaming exige `Lax`.** A leitura incremental abriu mão da validação `Strict`; valide o buffer
  completo se a origem não for confiável.
- **Decodificar não é verificar.** O `DecodeSign1` do COSE lê sem checar assinatura, então verifique
  antes de usar o conteúdo e amarre o contexto com o AAD externo.

## Documentation Links

- [System.Formats.Cbor Namespace, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor) (doc)
- [CborWriter Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor.cborwriter) (doc)
- [CborReader Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor.cborreader) (doc)
- [CborConformanceMode Enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor.cborconformancemode) (doc)
- [CoseSign1Message Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.cose.cosesign1message) (doc)
- [What's new in .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [RFC 8949, Concise Binary Object Representation (CBOR), IETF](https://www.rfc-editor.org/rfc/rfc8949) (doc)
- [RFC 9052, CBOR Object Signing and Encryption (COSE): Structures and Process, IETF](https://www.rfc-editor.org/rfc/rfc9052) (doc)
- [Web Authentication Level 3, W3C](https://www.w3.org/TR/webauthn-3/) (doc)
