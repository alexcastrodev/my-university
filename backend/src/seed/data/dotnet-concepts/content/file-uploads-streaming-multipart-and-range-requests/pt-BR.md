---
version: 1.0
updatedAt: 2026-11-19
title: "Upload de Arquivos, Streaming Multipart e Range Requests"
summary: Upload e download de arquivos grandes no ASP.NET Core 10, medidos no Kestrel com 1 MB, 100 MB e 1 GB. O que o IFormFile realmente bufferiza (disco, não memória), streaming com MultipartReader e BodyReader, qual limite responde 413, 400, 408 ou 500 e quando, Expect 100-continue, magic numbers e nomes de arquivo hostis, Range, If-Range e Content-Disposition com filename*, upload retomável com tus (implementação mínima e tusdotnet 2.12.0) e disco local contra armazenamento S3-compatível.
---
## Objective

Mover arquivos grandes por uma API ASP.NET Core é, no fundo, uma pergunta sobre quem segura os bytes enquanto eles passam: o heap gerenciado, um arquivo temporário, o arquivo final ou ninguém. Esta lição mede isso no Kestrel com uploads de 1 MB, 100 MB e 1 GB: o que o `IFormFile` realmente bufferiza, um upload em streaming com `MultipartReader` e `Request.BodyReader`, qual limite responde 413, 400, 408 ou 500 e quando, `Expect: 100-continue`, validação por magic numbers e nomes de arquivo hostis, downloads com `Range`, `If-Range` e `Content-Disposition`, um upload retomável (um subconjunto do tus escrito à mão contra o `tusdotnet`) e disco local contra um armazenamento S3-compatível. Versões: `net10.0`, SDK 10.0.100 (`Microsoft.AspNetCore.App` 10.0.0), `tusdotnet` 2.12.0, `AWSSDK.S3` 4.1.2, SeaweedFS 4.47 (`chrislusf/seaweedfs:4.47`, como endpoint S3), curl 8.7.1 no macOS, tudo em loopback.

## Use Cases

- Aceitar avatares, PDFs e vídeos de navegadores sem deixar uma requisição esgotar memória ou disco.
- Servir downloads em que um player ou gerenciador de downloads consegue pular e retomar.
- Deixar clientes móveis retomarem um upload grande depois de a conexão cair.
- Decidir entre "passando pela API" e "direto para o armazenamento de objetos".

## Deep Dive

### IFormFile bufferiza em disco, não em memória

Todos os números abaixo são de uma execução, com `ASPNETCORE_TEMP` apontando para uma pasta que amostrei a cada 10 ms junto com o working set (baseline de 101 MB). `Kestrel` é o `MaxRequestBodySize`, `Form` é o `FormOptions.MultipartBodyLengthLimit`.

```csharp
app.MapPost("/form/iformfile", async ([FromForm] IFormFile file) =>
{
    await using var fs = File.Create(Path.Combine(data, Guid.NewGuid().ToString("N")));
    await file.CopyToAsync(fs);              // second copy: temp file to final file
    return Results.Ok(new { file.FileName, file.Length });
}).DisableAntiforgery();
```

| Caso | Resultado | Pico de working set | Pico de disco temporário |
| --- | --- | --- | --- |
| Padrões, 1 MB | 200 | 106 MB | 1 MB |
| Padrões, 100 MB | 413 | 103 MB | 0 |
| `Kestrel` aumentado, 100 MB | 200 | 108 MB | 100 MB |
| `Kestrel` aumentado, 1 GB, `Form` padrão | 400 após cerca de 123 MB | 107 MB | 123 MB |
| Os dois aumentados, 1 GB | 200 em 3,4 s | 120 MB | 1024 MB |

A parte do arquivo é drenada para um arquivo temporário assim que passa de 64 KB (documentação), então a memória fica estável e o disco paga a conta. Com a cópia para o arquivo final, amostrar `temp + data` durante a requisição de 1 GB deu pico de 2017 MB: os bytes existem duas vezes até a requisição terminar. Sem `.DisableAntiforgery()` o endpoint lança `InvalidOperationException: Endpoint ... contains anti-forgery metadata, but a middleware was not found` (500). Com `AddAntiforgery()` e `UseAntiforgery()` mas sem token, responde 400. Os dois vêm de fazer binding de formulário em Minimal API, veja [proteção CSRF](csrf-protection-antiforgery-tokens-and-fetch-metadata).

### Streaming: nada é bufferizado

Pule o binding de formulário e leia o corpo você mesmo. O `MultipartReader` entrega uma seção por vez, e `Request.BodyReader` dá o pipe cru.

```csharp
var reader = new MultipartReader(HeaderUtilities.RemoveQuotes(mt.Boundary).Value!, req.Body);
while (await reader.ReadNextSectionAsync(ct) is { } section)
    if (ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var cd) && cd.IsFileDisposition())
        await using (var fs = File.Create(dest)) await section.Body.CopyToAsync(fs, ct);

// raw body, hashing without keeping anything
while (true) {
    ReadResult r = await req.BodyReader.ReadAsync(ct);
    foreach (var seg in r.Buffer) hash.AppendData(seg.Span);
    req.BodyReader.AdvanceTo(r.Buffer.End);
    if (r.IsCompleted) break;
}
```

Tudo com o `MaxRequestBodySize` removido (um endpoint de streaming também esbarra no limite do Kestrel):

| Endpoint | 100 MB | 1 GB | Disco temporário |
| --- | --- | --- | --- |
| `MultipartReader` para arquivo | 107 MB | 111 MB, 1,7 s | 0 |
| `BodyReader.CopyToAsync(file)` | 109 MB | 140 MB (heap gerenciado 37 MB) | 0 |
| Loop de `BodyReader`, só SHA-256 | | 108 MB, 34221 leituras, 0,5 s | 0 |
| `Body.CopyToAsync(MemoryStream)` | 333 MB | 2165 MB (heap 2053 MB) | 0 |

O hash bateu com o `shasum` do arquivo. A última linha é o erro a evitar: uma requisição segura o corpo inteiro no heap. O `Request.Form` nunca é tocado aqui, e por isso nenhum atributo é necessário em Minimal API.

Controllers são diferentes. O exemplo da documentação traz um resource filter `DisableFormValueModelBinding` que remove `FormValueProviderFactory`, `FormFileValueProviderFactory` e `JQueryFormValueProviderFactory`. Medido com 100 MB em quatro actions: `IFormFile` 200 (100 MB de temp); action de streaming sem parâmetros 200 (o formulário nem é lido); action de streaming com `[FromQuery] string tag` e sem o atributo 500, com 99 MB bufferizados no temp antes e `IOException: Unexpected end of Stream, the content may have already been read by another component`; a mesma action com o atributo 200. Qualquer parâmetro vinculado faz os value providers lerem o formulário primeiro.

### Limites: quem responde o quê

Tudo medido com curl contra um endpoint que drena o corpo:

| Limite | Padrão | Quando dispara | Resposta |
| --- | --- | --- | --- |
| Kestrel `MaxRequestBodySize` | 30.000.000 | na primeira leitura do corpo, não nos headers: o handler rodou (`ContentLength=50000000`) e a leitura lançou | 413, corpo vazio, `BadHttpRequestException` |
| `[RequestSizeLimit(1000)]` em lambda | nenhum | igual, a feature recebe 1000 antes do handler | 413 |
| `[DisableRequestSizeLimit]` | nenhum | remove o teto: 100 MB passaram | 200 |
| `IHttpMaxRequestBodySizeFeature` | 30.000.000 | dá para alterar até a primeira leitura; `IsReadOnly` fica true depois | 413; alterar depois lança `InvalidOperationException` |
| `FormOptions.MultipartBodyLengthLimit` | 128 MB | enquanto o formulário é lido | 400 no binding de Minimal API, 500 em `ReadFormAsync` ou MVC (`InvalidDataException`) |
| `FormOptions.ValueLengthLimit` | 4 MB | só valores urlencoded; um campo de texto multipart de 5 MB passou | 500 no urlencoded, 200 no multipart |
| `MinRequestBodyDataRate` | 240 B/s, 5 s de tolerância (documentação) | `--limit-rate 100` caiu após 7,0 s com 700 bytes enviados | 408 |

Um corpo chunked de 50 MB é cortado depois do limite: o curl tinha enviado 34.016.106 bytes quando o 413 chegou, enquanto um corpo de 29 MB passou. O `FormOptions` nunca responde 413, então o cliente não distingue "grande demais" de "formulário ruim". Não ponha o limite do Kestrel em `null` para o servidor inteiro: use `[DisableRequestSizeLimit]` na rota de upload e imponha um teto seu com a feature (ou contando bytes), porque "ilimitado" também é negação de serviço.

### Expect: 100-continue

Para corpos acima de 1 MB o curl manda `Expect: 100-continue` e espera. O Kestrel responde `100 Continue` quando o handler lê o corpo pela primeira vez, então uma requisição rejeitada antes não custa o upload:

```text
read endpoint, 1 MB, Expect:   < HTTP/1.1 100 Continue  then  < HTTP/1.1 200 OK        sent=1048576
reject endpoint (401), Expect: < HTTP/1.1 401 Unauthorized                              sent=0
reject endpoint (401), Expect header removed:                                           sent=720780
50 MB over the limit, Expect:  413                                                      sent=0
50 MB over the limit, removed: 413                                                      sent=7641302
```

Por isso, faça autenticação e checagem de tamanho antes da primeira leitura.

### Nunca confie no nome nem no tipo

`IFormFile.ContentType` e a extensão são o que o cliente escreveu. Ler os primeiros bytes contra uma tabela de assinaturas (`PNG 89 50 4E 47 0D 0A 1A 0A`, `JPEG FF D8 FF`, `PDF %PDF-`, `ZIP 50 4B 03 04`, `MZ`) deu:

```text
real.png                      declared image/png   detected png
text-as.png                   declared image/png   detected (none)   -> rejected
mz-as.pdf                     declared application/pdf   detected exe -> rejected
real.pdf sent as report.txt   declared text/plain  detected pdf
hello.txt with type=image/png filename=cat.png     detected (none)
poly.png = PNG header + <script>alert(1)</script>  detected png      -> passes
```

A última linha é o limite dos magic numbers: um políglota passa, então sirva uploads com `Content-Disposition: attachment` ou de outra origem, recodifique imagens e escaneie (antivírus e quarentena são só documentação: a página do Learn descreve manter os arquivos numa área de quarentena até um scanner liberar). Nomes de arquivo, com a raiz `data` e `Path.Combine(root, name)` no macOS:

```text
../../escape.txt           Combine = data/../../escape.txt   GetFileName = escape.txt   escapes the root
/etc/cron.d/x              Combine = /etc/cron.d/x           (an absolute name discards the root)
..\..\win.txt              Combine keeps it one name on Unix; Windows would treat \ as a separator (docs only)
relatório final.txt / 日本語.txt   arrive intact as UTF-8
```

Gere o nome guardado no servidor (um `Guid` mais uma extensão escolhida pelo tipo detectado) e mantenha o nome do cliente só como metadado. Dois leitores podem discordar sobre a mesma parte: com `filename="a.pdf"; filename*=UTF-8''r%C3%A9.pdf` nos headers do multipart, `IFormFile.FileName` devolveu `ré.pdf` enquanto o meu código com `MultipartReader`, lendo `cd.FileName` primeiro, devolveu `a.pdf`. Valide e armazene a partir do mesmo valor.

### Downloads: Range, If-Range e Content-Disposition

```csharp
app.MapMethods("/dl/range", ["GET", "HEAD"], () =>
    Results.File(path, "application/octet-stream", "dl.bin", lastModified, new EntityTagHeaderValue("\"v1\""),
                 enableRangeProcessing: true));
```

O arquivo de 1000 bytes tem 100 bytes de `A`, 100 de `B`, ... até `J`. Headers reduzidos aos que interessam:

| Requisição | Resposta |
| --- | --- |
| sem `Range` | 200, `Content-Length: 1000`, `Accept-Ranges: bytes`, `ETag`, `Last-Modified` |
| `bytes=0-99` | 206, `Content-Range: bytes 0-99/1000`, 100 bytes |
| `bytes=-100` / `bytes=950-` | 206, `bytes 900-999/1000` / `bytes 950-999/1000` |
| `bytes=900-5000` | 206, `bytes 900-999/1000` (fim ajustado) |
| `bytes=1000-1100` | 416, `Content-Range: bytes */1000`, ainda com `Content-Disposition` |
| `bytes=0-99,200-299` | 200 com o arquivo inteiro: vários ranges são ignorados, sem `multipart/byteranges` |
| `bytes=500-100`, `bytes=abc` | 200 com o arquivo inteiro |
| `foo=0-5` | 206 `bytes 0-5/1000`: uma unidade desconhecida é servida como bytes, e a RFC 9110 diz que DEVE ser ignorada |
| `HEAD` com `bytes=0-99` | 206, `Content-Length: 100` |
| `If-Range: "v1"` / `"v2"` | 206 / 200 inteiro |
| `If-Range` com a data exata / uma data mais antiga | 206 / 200 inteiro |
| `If-None-Match: "v1"` | 304 |
| processamento de range desligado (`/dl/norange`), `bytes=0-99` | `Range` ignorado, 200, sem `Accept-Ranges` |
| recurso sem ETag nem data, `If-Range: "v1"` | 206: a condição não é avaliada |
| stream não seekable, `enableRangeProcessing: true` | 200, chunked, sem `Accept-Ranges`: fallback silencioso |

Duas armadilhas decorrem daí: sempre passe `lastModified` ou um `EntityTagHeaderValue`, senão o `If-Range` deixa de proteger um cliente que retoma contra um arquivo que mudou, e dê ao `Results.Stream` um stream seekable. `UseStaticFiles` e `MapStaticAssets` já fazem isso para arquivos em disco ([arquivos estáticos](static-files-and-mapstaticassets)).

O `Content-Disposition` é montado para você, com a forma `filename*` das RFC 6266 e RFC 8187 ao lado de um fallback ASCII (`ContentDispositionHeaderValue.SetHttpFileName` gerou headers idênticos):

```text
plain.pdf            attachment; filename=plain.pdf; filename*=UTF-8''plain.pdf
relatório final.pdf  attachment; filename="relat_rio final.pdf"; filename*=UTF-8''relat%C3%B3rio%20final.pdf
日本語.txt           attachment; filename=___.txt; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt
a"b.txt              attachment; filename="a\"b.txt"; filename*=UTF-8''a%22b.txt
line1\r\nSet-Cookie  filename="line1__Set-Cookie: x=1.txt"; filename*=UTF-8''line1%0D%0ASet-Cookie%3A%20x%3D1.txt
```

CR e LF nunca chegam crus ao header. O `ContentDispositionHeaderValue.TryParse` decodificou `filename*=UTF-8''%E6%97%A5%E6%9C%AC.txt` para um nome e `iso-8859-1''r%E9.pdf` para `ré.pdf`.

### Uploads retomáveis: tus

Um PUT com `Content-Range` não é upload retomável. Dois PUTs de 100 bytes com `Content-Range: bytes 0-99/1000` e `bytes 100-199/1000` responderam `written: 100` os dois: o framework ignora o header e o segundo substituiu o primeiro. A RFC 9110 14.5 diz que o servidor DEVERIA responder 400 para um recurso sem PUT parcial. O protocolo tus 1.0.0 (`POST` para criar com `Upload-Length`, `HEAD` para o `Upload-Offset`, `PATCH` com `Content-Type: application/offset+octet-stream`) cabe em cerca de 40 linhas de Minimal API (núcleo mais creation, sem checksum nem expiração). O handler do `PATCH` usa um `FileStream` sem buffer em modo append, então toda leitura chega ao arquivo antes de a conexão poder falhar. Matei um upload de 100 MB com `curl --limit-rate 40m --max-time 1`:

```text
PATCH interrupted after 42008347 bytes persisted (BadHttpRequestException)     curl: exit=28 sent=42008347
HEAD  -> 204  Upload-Offset: 42008347  Upload-Length: 104857600  Cache-Control: no-store
PATCH with Upload-Offset: 0 (stale)  -> 409
PATCH from offset 42008347 (tail -c +42008348)  -> 204, sent=62879928
HEAD  -> Upload-Offset: 104857600
sha256 part   d2fdb8382e8930da007b82821d012ddc05443ce57506858fefa9d60401764e96
sha256 source d2fdb8382e8930da007b82821d012ddc05443ce57506858fefa9d60401764e96
```

Em loopback nenhum byte em trânsito se perdeu; numa rede real o offset pode ficar atrás do que o cliente enviou, e por isso o cliente pergunta com `HEAD` em vez de confiar no próprio contador. O `tusdotnet` 2.12.0 (`app.MapTus("/files", ...)` com `TusDiskStore`) deu o mesmo resultado no `net10.0` (queda em 42008345, retomada com 204, mesmo SHA-256) e anuncia `creation,creation-with-upload,termination,checksum,checksum-trailer,concatenation,creation-defer-length`. Uma pegadinha: com o limite padrão de 30.000.000 do Kestrel, um `PATCH` de 100 MB é recusado na hora (o offset fica em 0) e uma nova tentativa em chunked persistiu cerca de 29,9 MB e depois levou 413. Aumente o `MaxRequestBodySize` para a rota do tus ou faça o cliente enviar pedaços abaixo do limite. Protocolos de chunks próprios (`PUT /parts/3`) funcionam do mesmo jeito, mas o offset, a ordem e a limpeza passam a ser seus; tus em escala (vários nós, store compartilhado, expiração) é só documentação.

### Armazenamento: disco local ou armazenamento de objetos

`AWSSDK.S3` 4.1.2 contra o SeaweedFS no Docker, com a API fazendo streaming do corpo da requisição (`Headers.ContentLength` vindo de `Request.ContentLength`); as células mostram o working set da baseline até o pico:

| Caminho do upload | 100 MB | 1 GB |
| --- | --- | --- |
| `PutObjectAsync(Request.Body)`, sem tamanho | `AmazonS3Exception: Could not determine content length` | não executado |
| `PutObjectAsync` com `ContentLength` | 128 a 137 MB, 0,5 s | 129 a 147 MB, 5,6 s |
| `TransferUtility`, `PartSize` 8 MB | 128 a 151 MB, 1,1 s | 129 a 240 MB, 9,6 s |
| URL presigned de `PUT`, o cliente envia | a API vê 0 bytes, 200 | |

O `TransferUtility` multipart mantém algumas partes em memória (cerca de 111 MB a mais em 1 GB), então é ele que precisa de dimensionamento. A URL presigned moveu os 100 MB sem tocar a API, e trocar a chave na URL deu 403. Um `GET` presigned aceitou `Range`: 206 `bytes 0-99/104857600`, 416 além do fim, e dois ranges devolveram um 200 completo (a página GetObject da AWS diz que o S3 não suporta vários ranges, só documentação para a AWS em si). Pegadinhas: o SDK lê o perfil de `~/.aws` ao construir o cliente, então um perfil quebrado lançou exceção na inicialização (apontei `AWS_CONFIG_FILE` para um arquivo vazio); o SeaweedFS recusa requisições assinadas até o `-s3.config` definir uma identidade. Os tempos relativos (disco 0,9 a 1,7 s para 1 GB, S3 5,6 s) misturam um arquivo local com um contêiner atrás de uma VM, então leia as colunas de memória, não a velocidade. Cache de range em CDN, regras de limpeza de multipart do S3 e os limites reais da AWS são só documentação. O raciocínio de projeto está em [object storage e direct upload](/system-design/system-design-concepts/object-storage-and-direct-upload) e [chunked upload](/system-design/system-design-concepts/chunked-upload-deduplication-and-delta-sync). Em Java, [uploads multipart no Quarkus](/quarkus-concepts/multipart-file-uploads-with-resteasy-reactive) correspondem às mesmas ideias.

## Trade-offs

- **`IFormFile` ou streaming.** O `IFormFile` dá binding, validação e um `Length`, ao preço de uma cópia temporária (1 GB consumiu 2 GB de disco enquanto a requisição viveu). O streaming é estável em memória e disco, mas abre mão do binding e, com ele, da checagem de antiforgery, então proteja um stream autenticado por cookie de outro jeito ([CSRF](csrf-protection-antiforgery-tokens-and-fetch-metadata)).
- **Limites.** Empilhe em camadas: um padrão do Kestrel para a API, um teto explícito maior na rota de upload, `MinRequestBodyDataRate` mantido ligado. Falhas do `FormOptions` são 400 ou 500, então mapeie-as se os clientes precisam de um 413 claro ([problem details](problem-details-and-global-exception-handling)).
- **Magic numbers.** Barram erros honestos e ataques preguiçosos, não políglotas. Exemplo: o `poly.png` passou; a defesa é `attachment`, uma origem separada e recodificação.
- **Suporte a Range.** Barato para arquivos com ETag estável, arriscado sem ela (o `If-Range` não é verificado) e silenciosamente desligado para streams não seekable. Vários ranges não são servidos, então o cliente que os pede recebe tudo.
- **tus, chunks próprios ou multipart do S3.** O tus é um protocolo aberto com bibliotecas de cliente; o `tusdotnet` poupa os casos de borda, mas exige levantar o limite do corpo. Multipart do S3 ou URLs presigned tiram os bytes da sua API ao custo de um segundo sistema e das credenciais dele.
- **Disco ou armazenamento de objetos.** Disco é o mais simples e rápido, mas prende o arquivo a um nó. Um armazenamento de objetos escala e sobrevive a reinícios, e custa um SDK, um orçamento de memória por parte e a limpeza eventual de uploads abandonados.

## Documentation Links

- [Upload files in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads) (doc)
- [Kestrel options and limits, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options) (doc)
- [IHttpMaxRequestBodySizeFeature, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.features.ihttpmaxrequestbodysizefeature) (doc)
- [FormOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.features.formoptions) (doc)
- [MultipartReader, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.webutilities.multipartreader) (doc)
- [Minimal API parameter binding (IFormFile, forms), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Results.File, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.results.file) (doc)
- [FileResult.EnableRangeProcessing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.fileresult.enablerangeprocessing) (doc)
- [ContentDispositionHeaderValue, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.net.http.headers.contentdispositionheadervalue) (doc)
- [RFC 9110, HTTP Semantics (Range, If-Range, Expect), IETF](https://datatracker.ietf.org/doc/html/rfc9110) (doc)
- [RFC 6266, Content-Disposition in HTTP, IETF](https://datatracker.ietf.org/doc/html/rfc6266) (doc)
- [RFC 8187, Character Set and Language Encoding for HTTP Header Parameters, IETF](https://datatracker.ietf.org/doc/html/rfc8187) (doc)
- [RFC 7578, Returning Values from Forms: multipart/form-data, IETF](https://datatracker.ietf.org/doc/html/rfc7578) (doc)
- [tus resumable upload protocol 1.0.0, tus.io](https://tus.io/protocols/resumable-upload) (doc)
- [tusdotnet, GitHub](https://github.com/tusdotnet/tusdotnet) (doc)
- [File Upload Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) (doc)
- [Uploading objects with presigned URLs, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html) (doc)
