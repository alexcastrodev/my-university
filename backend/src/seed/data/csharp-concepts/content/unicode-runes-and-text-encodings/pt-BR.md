---
version: 1.0
updatedAt: 2026-10-15
title: "Unicode, Runes e Encodings de Texto"
summary: char, Rune e grafemas (StringInfo), UTF-8/16/32, bytes inválidos e BOM, code pages legadas e as codificações binário-para-texto Base64, Base64Url (.NET 9) e hexadecimal.
---
## Objective

Uma `string` do .NET é uma sequência de unidades de código UTF-16, arquivos e redes
falam em bytes, e o que uma pessoa chama de "um caractere" pode ser vários code
points. A maioria dos bugs de texto mora nas lacunas entre esses três níveis: um
`Length` que não bate com o que aparece na tela, um emoji partido ao meio, um
arquivo que mostra `Ã©` em vez de `é`, um token que quebra dentro de uma URL. Este
conceito dá nome aos níveis (`char`, `Rune`, grapheme cluster), mostra como os
encodings transformam texto em bytes e o que acontece com dado inválido, cobre o
BOM e termina nas codificações de binário para texto do dia a dia: Base64,
Base64Url e hex.

## Use Cases

- Truncar, preencher ou dividir texto de usuário sem cortar um emoji ou uma letra
  acentuada ao meio.
- Ler e gravar arquivos e corpos HTTP com o encoding certo, sabendo quando um BOM
  é adicionado.
- Validar bytes não confiáveis como UTF-8 antes de tratá-los como texto.
- Colocar dado binário (um token, um hash, um id) numa URL, num header ou num log.

## Deep Dive

### Três níveis: char, Rune, grapheme

`string.Length` conta unidades de código UTF-16. Code points acima de `U+FFFF`
precisam de duas delas, um par substituto (surrogate pair). Um `Rune` é um scalar
value Unicode (qualquer code point que não seja surrogate), e é o que você quer ao
iterar "caracteres" no sentido de code point:

```csharp
string s = "aé\U0001F600";   // a, e agudo, rosto sorrindo
Console.WriteLine($"Length={s.Length} UTF8={Encoding.UTF8.GetByteCount(s)} UTF16={Encoding.Unicode.GetByteCount(s)} UTF32={Encoding.UTF32.GetByteCount(s)}");
// Length=4 UTF8=7 UTF16=8 UTF32=12
Console.WriteLine(char.IsHighSurrogate(s[2]) + " " + char.IsLowSurrogate(s[3]));   // True True
foreach (var r in s.EnumerateRunes())
    Console.WriteLine($"U+{r.Value:X4} utf8={r.Utf8SequenceLength} utf16={r.Utf16SequenceLength}");
// U+0061 utf8=1 utf16=1
// U+00E9 utf8=2 utf16=1
// U+1F600 utf8=4 utf16=2
new Rune(0xD800);   // ArgumentOutOfRangeException: um surrogate isolado não é scalar value
```

Os mesmos três caracteres ocupam 7 bytes em UTF-8, 8 em UTF-16 e 12 em UTF-32. Os
construtores de `Rune` validam a entrada, então um `Rune` é sempre um scalar bem
formado e pode ir para APIs como `Rune.IsLetter` ou `Rune.ToUpperInvariant`. Chamar
`char.ToUpperInvariant` em cada metade de um surrogate pair separadamente não
funciona, porque cada metade sozinha não carrega informação de letra.

Uma `string` costuma ser UTF-16 bem formado, mas isso não é garantido:
`"x\uD83Dy"` (um high surrogate isolado) ou um `Substring` que corta um par ao meio
compilam e rodam normalmente. Codificá-la mostra o que o runtime faz com isso, e a
próxima seção volta ao assunto.

Mesmo assim, runes não são o que o leitor vê como um símbolo. Isso é um grapheme
cluster, que o .NET chama de text element, e o `StringInfo` os enumera:

```csharp
string accent = "é";                                    // e + acento agudo combinante
string flag   = "\U0001F1F5\U0001F1F9";                       // dois regional indicators
string family = "\U0001F468‍\U0001F469‍\U0001F467"; // emoji de família com ZWJ
foreach (var t in new[] { accent, flag, family })
    Console.WriteLine($"Length={t.Length} runes={t.EnumerateRunes().Count()} graphemes={new StringInfo(t).LengthInTextElements}");
// Length=2 runes=2 graphemes=1
// Length=4 runes=2 graphemes=1
// Length=8 runes=5 graphemes=1
Console.WriteLine(accent == "é");               // False: dois code points contra um
Console.WriteLine(accent.Normalize() == "é");   // True: compõe para FormC
```

Use `StringInfo` quando a unidade que importa é "o que o usuário vê": movimento do
cursor, prévia dos "primeiros 10 caracteres", limite de tamanho visível. A
documentação da Microsoft registra que o `StringInfo` tinha um bug antes do .NET 5,
um motivo a mais para não escrever lógica de grafemas à mão. Para comparar textos
que parecem iguais, normalize antes (`Normalize`, `NormalizationForm`); o conceito
anterior de strings mostra quando uma comparação com cultura faz isso por você.

### Encodings, bytes inválidos e o BOM

`Encoding.UTF8` é o padrão certo para arquivos, HTTP e APIs, e é o que o .NET usa na
maior parte do I/O de texto. Decodificar com o encoding errado não lança exceção,
produz lixo, e codificar texto que não cabe substitui em silêncio:

```csharp
byte[] u8 = Encoding.UTF8.GetBytes("café");
Console.WriteLine(Encoding.Latin1.GetString(u8));      // cafÃ©    (o mojibake clássico)
Console.WriteLine(Encoding.ASCII.GetString(u8));       // caf??
Console.WriteLine(Encoding.ASCII.GetBytes("café")[3]);   // 63, o '?' de substituição

string broken = "x\uD83Dy";
Console.WriteLine(Convert.ToHexString(Encoding.UTF8.GetBytes(broken)));   // 78EFBFBD79
new UTF8Encoding(false, throwOnInvalidBytes: true).GetBytes(broken);       // EncoderFallbackException
```

`EF BF BD` é o `U+FFFD`, o caractere de substituição. Segundo a documentação, os
encodings embutidos substituem entrada malformada por padrão e podem ser
configurados para lançar exceção, que é a configuração para código sensível a
segurança, onde alterar dado em silêncio é inaceitável. A mesma documentação avisa
que bytes vindos da rede podem ser UTF-8 malformado de propósito, então valide
(decodifique com um encoding que lança, ou chame `System.Text.Unicode.Utf8.IsValid`
sobre um span) antes de confiar neles.

Um BOM (byte order mark, `EF BB BF` em UTF-8) são alguns bytes no início de um
arquivo que anunciam o encoding. Ele sinaliza a ordem dos bytes no UTF-16 e é
opcional, e muitas vezes indesejado, no UTF-8. No .NET o singleton `Encoding.UTF8`
tem um preâmbulo de 3 bytes que as APIs de arquivo gravam, enquanto
`new UTF8Encoding(false)` não tem nenhum:

```csharp
Console.WriteLine(Convert.ToHexString(new UTF8Encoding(true).GetPreamble()));   // EFBBBF
File.WriteAllText(path, "hi");                          // 2 bytes
File.WriteAllText(path, "hi", Encoding.UTF8);           // 5 bytes: BOM adicionado
File.WriteAllText(path, "hi", Encoding.Unicode);        // FFFE68006900: UTF-16 LE com BOM
File.ReadAllText(path);                                 // "hi": o leitor detecta o BOM
```

Leitores como `File.ReadAllText` e `StreamReader` detectam o BOM e trocam de
encoding, por isso um arquivo UTF-16 volta correto sem você dizer nada. Para gravar
UTF-8 explicitamente sem BOM, use `new UTF8Encoding(false)`, cujo `GetPreamble()` é
vazio (conferimos o tamanho: 0).

Code pages legadas como Windows-1252 não vêm habilitadas por padrão no .NET
moderno. `Encoding.GetEncoding(1252)` lança `NotSupportedException` até você chamar
`Encoding.RegisterProvider(CodePagesEncodingProvider.Instance)`, depois do que
funciona. `Encoding.Latin1` (ISO-8859-1) já vem embutido e mapeia `€` para `?`, porque
esse símbolo não existe no Latin-1, enquanto o Windows-1252 o mapeia para `0x80`.
Trate code pages como ferramenta de compatibilidade com arquivos e parceiros
antigos, não como escolha para dados novos.

### Base64, Base64Url e hex

Dado binário em forma de texto usa três codificações. O Base64 padrão usa `+`, `/` e
o padding `=`, que são incômodos em URLs. O `Base64Url` (novo no .NET 9, em
`System.Buffers.Text`) usa `-` e `_` e omite o padding:

```csharp
byte[] data = [0xFB, 0xFF, 0xFE, 0x3E, 0x3F];
Console.WriteLine(Convert.ToBase64String(data));    // +//+Pj8=
Console.WriteLine(Base64Url.EncodeToString(data));  // -__-Pj8
Console.WriteLine(Convert.ToHexString(Base64Url.DecodeFromChars("-__-Pj8")));  // FBFFFE3E3F
Console.WriteLine(Convert.ToBase64String([1]) + " " + Base64Url.EncodeToString([1]));  // AQ== AQ
Console.WriteLine(Convert.ToHexString(data) + " " + Convert.ToHexStringLower(data));   // FBFFFE3E3F fbfffe3e3f
```

A documentação afirma que o alfabeto do Base64Url difere do Base64 só por trocar `+`
e `/` por `-` e `_`. `Convert.ToHexString` escreve em maiúsculas e
`Convert.ToHexStringLower` (.NET 9) em minúsculas, o que poupa uma chamada a
`ToLower` e sua alocação quando um protocolo, como muitas representações de hash,
espera minúsculas. Base64 e hex são codificações, não criptografia: qualquer um as
reverte.

## Trade-offs

- **Indexar por `char` é rápido e errado para certos textos.** `s[i]` e `Length`
  são baratos e corretos para ASCII e a maior parte do BMP, e silenciosamente
  errados para emoji e marcas combinantes. Use `Rune` ou `StringInfo` onde o usuário
  pode digitar qualquer coisa, e aceite o custo.
- **Enumerar runes não é enumerar grafemas.** `EnumerateRunes` resolve só os
  surrogate pairs; `"é"` continua sendo dois runes. Para a semântica de
  "caractere visível" você precisa do `StringInfo`, que aloca e é mais lento.
- **Substituir versus lançar exceção.** O `U+FFFD` silencioso mantém o pipeline
  rodando e esconde corrupção. Um `UTF8Encoding` que lança expõe a entrada ruim ao
  preço de ter que tratar a exceção. Escolha por fronteira: leniente para exibição,
  estrito para identificadores, assinaturas e tudo que é comparado byte a byte.
- **Um BOM ajuda ferramentas e atrapalha outras.** Ele torna a detecção de UTF-8
  confiável em alguns editores e planilhas, e pode confundir consumidores que não o
  esperam, como linhas shebang. O padrão é não usar BOM, a menos que um consumidor o
  exija.
- **`Base64Url` começa no .NET 9.** A documentação da API também lista um pacote
  `Microsoft.Bcl.Memory` para alvos mais antigos. Reimplementar à mão a troca de `+` e
  `/` mais o padding é fácil de errar de forma sutil.

## Documentation Links

- [Introduction to character encoding in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-encoding-introduction) (doc)
- [Rune struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.rune) (doc)
- [StringInfo class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.globalization.stringinfo) (doc)
- [Base64Url class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.text.base64url) (doc)
- [Convert.ToHexStringLower method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.convert.tohexstringlower) (doc)
- [How to use character encoding classes in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-encoding) (doc)
