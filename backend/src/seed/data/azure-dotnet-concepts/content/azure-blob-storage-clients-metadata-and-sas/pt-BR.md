---
version: 1.0
updatedAt: 2026-11-20
title: "Azure Blob Storage: clientes, metadados e SAS"
summary: BlobServiceClient, BlobContainerClient e BlobClient no Azure.Storage.Blobs 12.30.1 medidos contra o Azurite 3.38.0 (tipos de blob, quando um upload vira um Put Blob ou blocos, pico de memória com 1 GiB, listagem plana e por hierarquia, metadados contra tags contra propriedades, ETag, leases, o retry que falha contra a própria escrita, camadas), SAS de serviço, de conta e de delegação de usuário validadas contra o emulador, identidade no lugar da chave, AddAzureClients e uma nota sobre as bibliotecas WindowsAzure.Storage e Microsoft.Azure.Storage.Blob.
---
## Objective

O Blob Storage é onde um app Azure guarda arquivos: uploads, exportações, backups, ativos estáticos. O `Azure.Storage.Blobs` o modela com três clientes (`BlobServiceClient`, `BlobContainerClient`, `BlobClient`) sobre uma só API REST, e quase todo problema real vem de poucos lugares: como as transferências grandes são divididas, onde os bytes ficam enquanto se movem, quais propriedades sobrevivem a uma atualização, como dois escritores evitam sobrescrever um ao outro e como entregar a um navegador uma chave temporária (uma SAS). Esta lição mede isso contra o Azurite 3.38.0, o emulador de armazenamento da Microsoft, num container Docker descartável, com o SDK de verdade. Nada tocou o Azure: a conta é a conta pública de desenvolvimento do Azurite. Onde o Azurite não responde (Microsoft Entra ID, SAS de delegação de usuário, versionamento, undelete, cotas reais, cobrança de camadas) o texto diz "docs only" e cita a página. O Azurite roda em loopback na mesma máquina, então todo tempo aqui é de cliente e emulador, não de rede nem do serviço real; contagem de requisições e memória são os números que se transferem. O lado da identidade (`DefaultAzureCredential`, a cadeia, `AddAzureClients`) está na [lição de credenciais](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential).
Versões: `Azure.Storage.Blobs` 12.30.1 (versão de serviço padrão `2026-10-06`, lida de `BlobClientOptions.Version`), `Azure.Storage.Common` 12.29.0, `Azure.Core` 1.61.0, `Azure.Identity` 1.21.0 (só compilado), `Microsoft.Extensions.Azure` 1.14.1, Azurite 3.38.0 (`mcr.microsoft.com/azure-storage/azurite`), TFM `net10.0`, SDK 10.0.100, builds Release, Apple M4 Max (14 núcleos, 36 GiB), macOS 27.2.1, Docker em arm64. Comparação com a biblioteca antiga: `Microsoft.Azure.Storage.Blob` 11.2.3.

## Use Cases

- Fazer um app web aceitar uploads grandes e servir downloads sem segurar o arquivo na memória.
- Entregar a um navegador ou app móvel uma URL curta e estreita (SAS) para enviar ou ler um blob.
- Atualizar um blob compartilhado (um manifesto, um contador, um arquivo de lock) a partir de várias instâncias sem perder escritas.
- Navegar numa árvore de "pastas" num namespace plano e marcar blobs com tags para achá-los depois.
- Escolher identidade (RBAC) no lugar de chaves de conta e saber o que uma SAS ainda exige.

## Deep Dive

### Os três clientes, e o que custa uma requisição
```text
conta      (BlobServiceClient)      https://<conta>.blob.core.windows.net
 container (BlobContainerClient)    .../<container>             um conjunto plano de blobs, uma fronteira de acesso
  blob     (BlobClient)             .../<container>/<nome>      BlockBlobClient, AppendBlobClient, PageBlobClient o especializam
```
Construir um cliente é local. 100.000 chamadas a `container.GetBlobClient(nome)` levaram 100 ms e enviaram 0 requisições, então crie clientes de container e de blob por operação e mantenha o `BlobServiceClient` (o pipeline, a credencial e a política de retry moram nele) como singleton, o que o README garante ser thread-safe. O Azurite usa URLs em estilo de caminho, então o nome da conta fica no caminho: `http://127.0.0.1:10000/devstoreaccount1/<container>/<blob>`. A connection string `UseDevelopmentStorage=true` expande exatamente para isso (medido: `BlobServiceClient("UseDevelopmentStorage=true").Uri` foi `http://127.0.0.1:10000/devstoreaccount1`); usei uma connection string completa para a porta 7075.
```csharp
var svc = new BlobServiceClient(conn);                         // singleton (ou AddBlobServiceClient)
var container = svc.GetBlobContainerClient("reports");
await container.CreateIfNotExistsAsync();
BlobClient blob = container.GetBlobClient("2026/11/summary.json");
```
Requisições realmente enviadas: `ExistsAsync` é um `HEAD`; `CreateIfNotExistsAsync` num container que já existe envia `PUT` e engole o 409 `ContainerAlreadyExists` (a resposta é `null`), então chamá-lo a cada requisição custa uma ida e volta; crie os containers no deploy ou na partida. Erros são `RequestFailedException` com `Status` e `ErrorCode` (use as constantes de `BlobErrorCode`): `BlobNotFound` 404 e `ContainerNotFound` 404 em leituras, `ContainerAlreadyExists` 409, `BlobAlreadyExists` 409 quando `UploadAsync(stream)` encontra um blob existente sem `overwrite: true`. A mensagem do 404 é "The specified blob does not exist." mais o id da requisição, e o corpo XML vem na exceção.

### Blobs de bloco, de acréscimo e de página
O tipo é fixado na criação e decide as operações (docs REST). Medido no Azurite:

| Tipo | Cliente | Unidade de escrita | Limites (docs) | Quando |
|---|---|---|---|---|
| Block | `BlockBlobClient` (o que `BlobClient.UploadAsync` cria) | blocos, confirmados por uma lista de blocos | 50.000 blocos de até 4000 MiB, cerca de 190,7 TiB | arquivos, imagens, backups: quase sempre |
| Append | `AppendBlobClient` | `AppendBlockAsync`, só no fim | bloco de até 4 MiB, 50.000 blocos, cerca de 195 GiB | logs escritos por vários produtores |
| Page | `PageBlobClient` | páginas de 512 bytes alinhadas, no lugar | até 8 TiB | discos de VM, arquivos de acesso aleatório |

Medido: três appends deram `BlobCommittedBlockCount=3`; um blob de página criado com tamanho 4096 e duas escritas na mesma página ficou com um intervalo `512-1023`; `CreateAsync(1000)` num blob de página e uma escrita de página de 100 bytes falharam com 400; `AppendBlockAsync` num blob de bloco falhou com 409 `InvalidBlobType`. Blocos preparados ficam invisíveis até serem confirmados: depois de dois `StageBlockAsync`, `ExistsAsync` foi `False` e `GetBlockListAsync(All)` mostrou 2 blocos não confirmados; `CommitBlockListAsync([2,1,2])` produziu `BBBAAABBB` (o mesmo bloco confirmado duas vezes). Diferenças do Azurite, não do comportamento do Azure: ele aceitou um bloco de append de 4 MiB + 1 byte (a doc diz que o limite é 4 MiB), e `UploadAsync(overwrite: true)` sobre um blob de append o transformou em blob de bloco. Camadas de acesso valem só para blobs de bloco (docs).

### Upload: uma requisição, ou blocos
O `UploadAsync` escolhe pelo tamanho e por o stream aceitar seek, com `StorageTransferOptions` (`InitialTransferSize`, `MaximumTransferSize`, `MaximumConcurrency`) como os botões; a doc diz que os padrões são ajustados para um data center, não para uma conexão doméstica. Os padrões não estão no XML de documentação, então contei requisições (`GenStream`, um stream gerado, sem arquivo):
```text
seekable, padrões       1 MiB, 8, 9, 100 MiB   1 Put Blob (uma única requisição)
                        256 MiB                32 Put Block (8 MiB cada) + 1 Put Block List
                        300 MiB                38 Put Block + 1 Put Block List
NÃO seekable, padrões   1 MiB, 7, 8 MiB        1 Put Block + 1 Put Block List   (nunca um Put Blob único)
                        9 MiB / 100 MiB        2 / 13 Put Block + 1 Put Block List
64 MiB seekable         Initial 4 MiB, Max 4 MiB      16 blocos    Initial 1 MiB, Max 1 MiB   64 blocos
                        Initial 16 MiB, Max 16 MiB    4 blocos     Initial 64 MiB, Max 64 MiB  1 bloco (igual não é "menor")
```
Então abaixo do tamanho inicial de 256 MiB um stream com seek é um só `Put Blob`, acima disso blocos de 8 MiB. Um stream sem seek é sempre enviado em blocos, porque o SDK não sabe o tamanho dele. `UploadAsync(stream)` sem `overwrite: true` falha com `BlobAlreadyExists` quando o blob existe. Concorrência 1 contra 8 deu 964 e 749 ms para 64 MiB: contra um emulador local quase não importa, contra uma rede real é o que se ajusta (a doc sugere `ServicePointManager.DefaultConnectionLimit` no .NET Framework; no .NET o pool do `HttpClient` não foi o limite que medi).

### Pico de memória com um arquivo de 1 GiB
O mesmo blob de 1 GiB, um processo por modo, working set amostrado a cada 5 ms (Release, linha de base de cerca de 77 MiB com o cliente aquecido), alocações gerenciadas de `GC.GetTotalAllocatedBytes`:

| Modo | Pico acima da linha de base | Alocado | Requisições |
|---|---|---|---|
| upload `File.ReadAllBytes` e depois `UploadAsync(BinaryData)` | +1277 MiB | 1269 MiB | 129 |
| upload `UploadAsync(caminho)` ou um `FileStream` com seek, padrões | +250 MiB | 248 MiB | 129 |
| upload de stream sem seek, padrões | +253 MiB | 244 MiB | 129 |
| upload sem seek, `MaximumConcurrency` 8, `MaximumTransferSize` 8 MiB | +92 MiB | 84 MiB | 129 |
| upload sem seek, concorrência 1, blocos de 4 MiB | +30 MiB | 26 MiB | 257 |
| `OpenWriteAsync` (buffer de 4 MiB) + `CopyToAsync` | +26 MiB | 22 MiB | 258 |
| download `DownloadContentAsync` (um `BinaryData`) | +1653 MiB | 2063 MiB | 1 |
| download `DownloadToAsync(caminho)`, padrões | +135 MiB | 138 MiB | 193 |
| download `DownloadToAsync`, concorrência 1, 4 MiB | +22 MiB | 20 MiB | 256 |
| download `OpenReadAsync` + `CopyToAsync(arquivo)` | +26 MiB | 27 MiB | 257 |
| download `DownloadStreamingAsync` + `CopyToAsync(arquivo)` | +11 MiB | 14 MiB | 1 |

O arquivo ficou idêntico após o download (`cmp`). A leitura: o maior custo de memória é o código que transforma o arquivo em `byte[]` ou `BinaryData`, não o SDK; o uploader particionado segura mais ou menos concorrência x tamanho do bloco (cerca de 250 MiB nos padrões), então você o dimensiona com as duas opções; `DownloadStreamingAsync` é uma resposta em stream, constante em memória e uma requisição. O `DownloadToAsync` buscou os primeiros 256 MiB num intervalo só e depois intervalos de 4 MiB (1 x 256 MiB mais 192 x 4 MiB); o `OpenReadAsync` faz um `HEAD` e depois intervalos de 4 MiB. Passar bytes pela sua própria API tem a mesma forma no lado do servidor: veja [file uploads](/dotnet-concepts/file-uploads-streaming-multipart-and-range-requests) e o [padrão de object storage](/system-design/system-design-concepts/object-storage-and-direct-upload) para deixar o cliente enviar direto ao armazenamento com uma SAS.

### OpenWriteAsync, OpenReadAsync, intervalos e Content-Encoding
O `OpenWriteAsync` devolve um `BlockBlobWriteStream` (só escrita, sem seek) e é um [`Stream`](/csharp-concepts/stream-class-hierarchy-and-decorators) cujo `Dispose` termina o trabalho, com uma armadilha:
```text
logo após OpenWriteAsync(overwrite: true)   length=0      <- o blob foi esvaziado (um Put Blob vazio), o conteúdo antigo se foi
após escrever 3 MiB + 100 bytes             length=0      <- blocos preparados, não confirmados
após FlushAsync                             length=3145828 (um Put Block List)
requisições: 1 Put Blob (vazio), 4 Put Block, 2 Put Block List (Flush, depois Dispose)
old.txt tinha 11 bytes; aberto para sobrescrever, escrito, nunca descartado: o blob ficou com 0 bytes
```
Se o processo morre antes de o stream confirmar, você fica com um blob vazio, não com a versão anterior. Para uma substituição que não pode perder dados, envie para um nome novo e troque, ou use `UploadAsync` com uma condição `IfMatch`. O `OpenReadAsync` devolve um `LazyLoadingReadOnlyStream` com seek: `Seek(-100, End)` e uma leitura enviaram um `HEAD` e um intervalo de 4 MiB, e ler na posição 0 outro intervalo. Por padrão o stream fixa o ETag do blob (`BlobOpenReadOptions(allowModifications: false)`): depois que outro escritor substituiu o blob, a leitura seguinte falhou com 412 `ConditionNotMet` em vez de misturar duas versões.

Intervalos são HTTP puro: `DownloadStreamingAsync(new BlobDownloadOptions { Range = new HttpRange(5, 10) })` deu 206 com `ContentRange=bytes 5-14/10000`, e um intervalo além do fim deu 416 `InvalidRange`. Um `Range: bytes=0-3` numa URL com SAS respondeu 206 com `Accept-Ranges: bytes`; dois intervalos numa requisição devolveram o corpo inteiro com 200 (o caso de múltiplos intervalos da [lição de uploads](/dotnet-concepts/file-uploads-streaming-multipart-and-range-requests), medido aqui só no Azurite). `BlobHttpHeaders.ContentEncoding = "gzip"` apenas rotula o que você guardou: um texto de 10.000 bytes enviado como 3.747 bytes de gzip voltou do `DownloadContentAsync` com 3.747 bytes e `Details.ContentEncoding=gzip`; um `HttpClient` simples também recebeu 3.747, um com `AutomaticDecompression` recebeu 10.000. O SDK não descomprime por você (veja [compressão](/csharp-concepts/compression-zip-gzip-brotli-and-tar)).

### Listagem: blobs planos e pastas virtuais
O namespace é plano: um blob se chama `photos/2026/a.jpg` e `/` é só um caractere. `GetBlobsAsync` lista todo blob sob um prefixo; `GetBlobsByHierarchyAsync(new GetBlobsByHierarchyOptions { Delimiter = "/", Prefix = "photos/" })` devolve `BlobHierarchyItem`s que são um blob ou um prefixo (`IsPrefix`):
```text
raiz, delimitador "/":      PREFIX bulk/  PREFIX docs/  PREFIX photos/  BLOB a1  BLOB a10  BLOB a2  BLOB root.txt
prefixo "photos/", "/":     PREFIX photos/2025/  PREFIX photos/2026/  BLOB photos/readme.txt
a ordem é binária, não natural: a1, a10, a2
250 blobs sob bulk/: padrão 1 requisição; pageSizeHint 100: 3 requisições (100, 100, 50), o token de continuação é uma string base64 opaca
apagado o único blob sob docs/, o prefixo docs/ sumiu da listagem
renomear root.txt -> renamed.txt: PUT (iniciar cópia), HEAD (esperar), DELETE: 3 requisições, não atômico
```
Um "diretório" só existe enquanto algum blob tem aquele prefixo, então não há pasta vazia para criar (um blob marcador com barra no fim voltou sem a barra no Azurite; não investiguei), e renomear uma pasta significa copiar e apagar cada blob sob ela. A doc diz que uma listagem devolve até 5000 resultados por requisição. No 12.30.1 a forma antiga com argumento nomeado não compila mais: `GetBlobsAsync(prefix: "x")` falha com CS7036 (parâmetro obrigatório `traits`); use `GetBlobsOptions { Prefix = ... }` (`GetBlobsAsync()` continua funcionando). Contas com namespace hierárquico (Data Lake Storage Gen2) têm diretórios reais e rename atômico: docs only, o Azurite não suporta Data Lake Storage.

### Metadados, tags e propriedades
Três coisas diferentes pendem de um blob (tabela da doc, mais medições):

| | Propriedades (`BlobHttpHeaders`) | Metadados | Tags de índice |
|---|---|---|---|
| Significado | cabeçalhos HTTP que o serviço envia: `ContentType`, `CacheControl`, `ContentDisposition`, `ContentEncoding` | pares chave/valor seus | pares chave/valor seus, pesquisáveis |
| Limites (docs) | | nomes são identificadores C#, 8 KB no total, sem distinguir maiúsculas | 10 por blob, chave de 1 a 128, valor de 0 a 256 caracteres, distingue maiúsculas |
| Atualização | `SetHttpHeadersAsync` substitui TUDO | `SetMetadataAsync` substitui TUDO | `SetTagsAsync` substitui TUDO |
| Muda ETag e last-modified | medido: ETag sim (metadados) | medido: sim | medido: não (docs: não muda o last-modified) |
| Consultável | não | não (outro serviço) | `FindBlobsByTagsAsync("\"status\" = 'published'")` |

Medido: um blob enviado sem cabeçalhos ficou com `ContentType=application/octet-stream`, então defina o content type no upload ou o navegador baixa em vez de renderizar; depois de `SetHttpHeadersAsync(new BlobHttpHeaders { ContentType = "text/plain" })` o `CacheControl` e o `ContentDisposition` ficaram vazios (é preciso reenviar todos); depois de `SetMetadataAsync({stage=2})` as chaves anteriores `Owner` e `source` sumiram. Chaves de metadados com hífen ou começando por dígito falharam com 400 `InvalidMetadata`; um valor não ASCII (`"café"`) nunca chegou à rede: o SDK lançou `AggregateException: Retry failed after 6 tries ... Request headers must contain only ASCII characters` depois de repetir um erro local seis vezes. Onze tags deram 400 `TagsTooLarge`; um delete com `TagConditions = "\"status\" = 'draft'"` num blob publicado deu 412 `ConditionNotMet`. O Azurite aceitou 9 KB de metadados (a doc diz 8 KB) e devolveu um código de erro estranho para um caractere inválido em tag, então valide esses limites numa conta real. A indexação de tags é eventualmente consistente no serviço real (a doc diz que o índice pode atrasar); as tags são legíveis na hora por `GetTagsAsync`.

### Concorrência: ETag, condições e leases
Leituras e escritas são fortemente consistentes e, por padrão, vence a última escrita (docs). Vinte workers fizeram 5 incrementos de ler-modificar-escrever num blob contador (esperado 100), três execuções:
```text
sem condição               final=8, 7, 7        (92 a 93 atualizações perdidas, 0 erros)
IfMatch = ETag, retry      final=100            (1162 a 1333 retries em 412 ConditionNotMet)
```
```csharp
var r = await blob.DownloadContentAsync();
await blob.UploadAsync(next, new BlobUploadOptions { Conditions = new BlobRequestConditions { IfMatch = r.Value.Details.ETag } });
```
`IfNoneMatch = ETag.All` faz uma escrita só de criação (a segunda falhou com 409 `BlobAlreadyExists`); um `IfMatch` velho em upload ou delete falhou com 412 `ConditionNotMet`; um `DownloadStreamingAsync` condicional com o ETag atual devolveu 304 sem lançar exceção. Contenção tão alta (20 escritores, um blob) é sinal para particionar os dados ou usar um lease. Um lease é um lock pessimista sobre escritas e deletes (docs: 15 a 60 segundos, ou infinito; leituras não são bloqueadas):
```text
AcquireAsync(15 s): state=Leased status=Locked      segundo Acquire: 409 LeaseAlreadyPresent
escrita sem lease id: 412 LeaseIdMissing             lease id errado: 412 LeaseIdMismatchWithBlobOperation
delete sem lease id: 412 LeaseIdMissing              leitura com lease: ok       RenewAsync: ok
16 s sem renovar: LeaseState=Expired, escrita sem lease: ok
lease infinito: duration=Infinite; BreakAsync(0): Broken      AcquireAsync(5 s): 400 InvalidHeaderValue      blob inexistente: 404 BlobNotFound
```
Um lease é um lock com prazo, não um fencing token: um cliente que trava além da expiração ainda pode escrever se ninguém mais adquiriu, e nada ordena as escritas, então combine com condições de ETag. Veja também [locks em nível de aplicação](/system-design/system-design-concepts/application-level-locks-for-external-io-critical-sections) para o padrão geral.

### Retry, e a falha que não é falha
Clientes de blob repetem 5 vezes por padrão (`BlobClientOptions.Retry`: Exponential, `MaxRetries` 5, `Delay` 0,8 s, `MaxDelay` 60 s, `NetworkTimeout` 100 s), enquanto o padrão do `Azure.Core` medido em outro cliente foi 3. Atrás de um pequeno proxy que escrevi para falhar sob comando (só no laboratório, na frente do Azurite):
```text
A. 503, 503, depois 200                      UploadAsync ok após 2,5 s (3 tentativas)
B1. IfMatch=etag, PRIMEIRA RESPOSTA PERDIDA  412 ConditionNotMet ... e o blob tem v1: a escrita FOI aplicada
B2. só criar IfNoneMatch=*, resposta perdida 409 BlobAlreadyExists ... e o blob existe com o conteúdo novo
B3. sobrescrita simples, resposta perdida    ok (o retry é idempotente)
C1. corpo cortado após 1 MiB de 8            leu 8.388.608 bytes, sem exceção: um segundo GET com range=bytes=1048576- (206)
D.  blob sobrescrito entre o corte e a retomada  RequestFailedException 412 ConditionNotMet (a retomada leva If-Match)
```
Quando o serviço aplicou sua escrita condicional mas a resposta nunca chegou, o retry falha a condição contra a sua própria escrita (B1, B2). Um `ConditionNotMet` ou `BlobAlreadyExists` depois de um retry é, portanto, ambíguo: leia o blob (ou um id que você pôs nos metadados) antes de concluir que perdeu. O D é o comportamento seguro: um download retomado se recusa a costurar duas versões. Com a [lição de resiliência](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers) em mente, mantenha uma só camada de retry: aqui são 6 tentativas, depois multiplicadas pela sua.

### Snapshots, soft delete, versões e camadas
Proteção, pelas docs e pelo que o Azurite deixou medir:

| Recurso | O que faz (docs) | Azurite 3.38.0 |
|---|---|---|
| Snapshot | cópia somente leitura num instante, você a cria | funciona: `CreateSnapshotAsync`, leu `v1` enquanto o atual é `v2`, `DeleteAsync` com snapshots presentes deu 409 `SnapshotsPresent` |
| Soft delete | blobs apagados ou sobrescritos guardados de 1 a 365 dias, `UndeleteAsync` restaura | a política é aceita, mas `UndeleteAsync` respondeu 501 `APINotImplemented`: docs only |
| Versionamento | uma versão a cada escrita ou delete, `VersionId` na resposta | não implementado: `VersionId` veio vazio: docs only (é uma configuração do plano de controle da conta) |

Camadas (página de access tiers, atualizada em 2026-06-15): Hot, Cool (mínimo recomendado de 30 dias), Cold (90), Archive (180, offline, a reidratação leva até 15 horas), mais a Smart tier e uma Turbo tier em preview. Apagar cedo ou reescrever antes do mínimo é cobrado, a troca de camada só vale para blobs de bloco e um blob arquivado não pode ser lido. O Azurite aceitou `SetAccessTierAsync` Hot, Cold e Archive, devolveu o estado, deu 409 `BlobArchived` ao ler o blob arquivado e 400 `AccessTierNotSupportedForBlobType` num blob de append. Ele modela o estado, não a cobrança nem o atraso da reidratação: docs only.

### SAS: três tipos, medidos contra o Azurite
Uma shared access signature é uma query string (`sv`, `se`, `sr`, `sp`, `sig`, opcionalmente `st`, `sip`, `spr`, `si`) assinada com uma chave e anexada a uma URL; o Storage não rastreia tokens SAS (docs). Três tipos, conforme quem assina:

| Tipo | Assinada por | Escopo | Política armazenada | Sobrevive a `AllowSharedKeyAccess = false` |
|---|---|---|---|---|
| SAS de serviço | chave da conta | um container ou blob | sim (até 5 por container) | não |
| SAS de conta | chave da conta | inclui operações de serviço | não | não |
| SAS de delegação de usuário | Entra ID (uma user delegation key, até 7 dias) | container ou blob | não | sim |
```csharp
Uri url = blob.GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(5));   // SAS de serviço, exige cliente com chave compartilhada
// ...?sv=2026-10-06&se=2026-11-20T18%3A11%3A09Z&sr=b&sp=r&sig=<masked>
```
Gerar é HMAC-SHA256 local: 100.000 chamadas a `GenerateSasUri` levaram 392 ms (cerca de 4 microssegundos cada, nenhuma requisição). `CanGenerateSasUri` foi `True` no cliente com chave compartilhada e `False` num cliente com credencial de token, onde `GenerateSasUri` lançou `ArgumentNullException (sharedKeyCredential)`: confira a propriedade. Um `TokenCredential` sobre uma URI `http://` falha na construção com `ArgumentException: Cannot use TokenCredential without HTTPS`. HTTP anônimo contra o Azurite, sem cabeçalho `Authorization`:
```text
sem SAS                                 403 AuthorizationFailure         SAS de leitura válida, GET    200
SAS de leitura usada em PUT ou DELETE   403 AuthorizationPermissionMismatch
SAS de secret.txt usada em other.txt    403    sp=r editado para sp=rw à mão 403    se adiado um dia 403 (a assinatura deixa de bater)
expirada (se um minuto atrás) 403, ainda não válida (st daqui a 1 hora) 403, spr=https usada sobre http 403 AuthorizationProtocolMismatch
sip=10.9.9.9 vindo de 127.0.0.1         200 (o Azurite NÃO aplicou a faixa de IP: docs only)
cliente só com SAS Create+Write         UploadAsync ok; ler de volta: 403 AuthorizationPermissionMismatch
SAS de container (sr=c, list+read)      lista os blobs        SAS de conta (ss=b, srt=sco, rl)  lista containers (7) e lê um blob: 200
política armazenada "readers"           a SAS leva só si=readers; 200, e 403 depois que a política foi apagada
6 políticas armazenadas                 aceitas pelo Azurite (a doc diz que o limite é 5, com 400 acima)
```
As regras práticas da doc, todas coerentes com isso: uma SAS é um bearer token (quem tem a URL tem o acesso), então use HTTPS, dê a menor permissão no menor escopo, mantenha a expiração curta (minutos para um upload), não ponha o horário de início em "agora" por causa de clock skew (a doc sugere 15 minutos antes ou nenhum início) e prefira uma política armazenada quando talvez precise revogar antes da expiração (a mudança pode levar até 30 segundos). Uma SAS de delegação de usuário exige `GetUserDelegationKeyAsync` com uma identidade Entra que tenha `generateUserDelegationKey` (o papel `Storage Blob Delegator`, e o `Storage Blob Data Contributor` o inclui); o Azurite respondeu à chamada com 403 `AuthenticationFailed` para um cliente com chave compartilhada, então é docs only. A forma (compilada, nunca executada):
```csharp
UserDelegationKey key = (await service.GetUserDelegationKeyAsync(new BlobGetUserDelegationKeyOptions(DateTimeOffset.UtcNow.AddHours(1)) { StartsOn = DateTimeOffset.UtcNow })).Value;  // service tem um TokenCredential
Uri url = new BlobUriBuilder(blobUri) { Sas = new BlobSasBuilder(BlobSasPermissions.Read, DateTimeOffset.UtcNow.AddMinutes(10)) { BlobContainerName = c, BlobName = n, Resource = "b" }.ToSasQueryParameters(key, account) }.ToUri();
```
A página da SAS de delegação de usuário (2026-06-15) descreve também uma variante presa a um usuário, com um id de usuário delegado (`BlobGetUserDelegationKeyOptions.DelegatedUserTenantId` existe no 12.30.1); não a exercitei.

### Identidade no lugar de chaves (docs only, exceto a fiação de DI)
A Microsoft recomenda Entra ID com identidades gerenciadas em vez de Shared Key, e uma SAS de delegação de usuário em vez das outras duas. No código a mudança é o construtor do cliente (`new BlobServiceClient(uri, new ManagedIdentityCredential(...))`, não `DefaultAzureCredential` em produção), mais os papéis de plano de dados `Storage Blob Data Reader`, `Storage Blob Data Contributor` ou `Storage Blob Data Owner`, e `Storage Blob Delegator` para chaves de SAS. Owner, Contributor e Storage Account Contributor no plano de controle não dão acesso aos dados do blob via Entra ID (docs): os papéis de dados acima dão, e uma atribuição nova pode demorar para valer. A chave da conta dá acesso total à conta e pode gerar qualquer SAS, então guarde-a no Key Vault (veja [a lição de Key Vault](/azure-dotnet-concepts/key-vault-and-app-configuration-in-dotnet)), rotacione-a e, quando nenhum cliente precisar dela, defina `AllowSharedKeyAccess = false` na conta: requisições com Shared Key são negadas, e as SAS de serviço e de conta também, enquanto a SAS de delegação de usuário continua funcionando (shared-key-authorization-prevent, 2026-08-11). RBAC real, `AllowSharedKeyAccess` e o efeito sobre a SAS não podem ser reproduzidos aqui. O registro com `AddAzureClients` foi medido (Azurite e o proxy):
```csharp
services.AddAzureClients(b => {
    b.AddBlobServiceClient(config.GetSection("Storage")).WithName("uploads");   // ConnectionString ou ServiceUri, mais Retry:MaxRetries etc.
    b.AddBlobServiceClient(new Uri(url)).WithName("prod").WithCredential(cred); // ou UseCredential(cred) uma vez para todos
});
```
O cliente sem nome foi resolvido como singleton (a mesma instância duas vezes), os nomeados vêm de `IAzureClientFactory<BlobServiceClient>`, e `Storage:Retry:MaxRetries=1` vindo da configuração fez uma rota com 503 falhar após 2 tentativas em 0,1 s, contra 6 tentativas em 3,3 s num cliente padrão (Delay de 0,1 s). Uma credencial de token com endpoint `http://` falhou na resolução com a mesma `ArgumentException` de acima.

**O que o Azurite não prova.** O Azurite suporta blob, fila e tabela, não Files nem Data Lake Storage (docs, 2025-08-26), e não tem garantia de desempenho ou escala; os textos de erro diferem, os códigos de status coincidem. Lacunas medidas: `UndeleteAsync` 501, sem `VersionId`, user delegation key recusada, `sip` não aplicado, 9 KB de metadados, bloco de append de 4 MiB + 1, 6 políticas armazenadas e um código de erro estranho em tag foram aceitos ou respondidos de outro jeito. Pegadinhas práticas: `--inMemoryPersistence` limitado a cerca de 4 GB (respondeu 409 `MemoryExtentStoreAtSizeLimit` depois de alguns uploads de 1 GiB; troquei para `--location` em disco), e um erro de upload não tratado derruba o processo: capture `RequestFailedException`. Use o Azurite para os caminhos de código e uma conta real para permissões, cotas e cobrança.

### Blob Storage, S3 e o disco local
| | Azure Blob Storage | Amazon S3 | Sistema de arquivos local |
|---|---|---|---|
| Namespace | plano, `/` é um delimitador (docs de listagem) | espaço de chaves plano, prefixo e delimitador (página de prefixos do S3) | diretórios reais |
| Maior objeto | cerca de 190,7 TiB (blob de bloco, 50.000 x 4000 MiB) | 48,8 TiB, multipart com até 10.000 partes de 5 MiB a 5 GiB | o volume |
| Escrita condicional | `IfMatch`, `IfNoneMatch`, leases | `If-Match`, `If-None-Match` em escritas (página de conditional writes) | locks de arquivo, `FileMode.CreateNew` |
| URL temporária delegada | SAS, até 7 dias para uma delegation key | URL pré-assinada, até 7 dias com credenciais de usuário IAM | nenhuma |
| Renomear | copiar e apagar (sem rename atômico sem namespace hierárquico) | copiar e apagar (não verificado aqui) | `rename(2)` é atômico num sistema de arquivos (POSIX) |

As fontes são as páginas listadas abaixo, lidas em 2026-11-20; a célula de rename do S3 é a que não verifiquei. A [lição de uploads](/dotnet-concepts/file-uploads-streaming-multipart-and-range-requests) mediu o SDK do S3 contra um servidor compatível.

### Book vs today
Livros e posts antigos usam `WindowsAzure.Storage` (última publicação em 2018-11-27) ou `Microsoft.Azure.Storage.Blob` 11.x (2021-04-15): `CloudStorageAccount.Parse(...).CreateCloudBlobClient().GetContainerReference("c").GetBlockBlobReference("b")`, `UploadTextAsync` e paginação com `ListBlobsSegmentedAsync` e um laço de `BlobContinuationToken`. Medido no registro do NuGet (2026-11-20): os três estão marcados como obsoletos ("Legacy", "obsolete as of 3/31/2023"), com `Azure.Storage.Blobs` e `Azure.Storage.Common` como substitutos. Rodei a 11.2.3 no net10.0 contra o Azurite: ainda funciona, envia `x-ms-version: 2019-07-07` (o SDK novo envia `2026-10-06`), tem um `ExponentialRetry` como padrão e não tem enumeradores `async`. Hoje: `BlobServiceClient` com um `TokenCredential`, `await foreach` sobre `AsyncPageable<T>`, um só pipeline de retry compartilhado com todo outro cliente `Azure.*`, SAS a partir de `BlobSasBuilder`.

## Trade-offs

- **Stream, nunca buffer.** `ReadAllBytes` mais `BinaryData` custaram 1,3 GiB de working set para 1 GiB, `DownloadStreamingAsync` 11 MiB. O preço do stream é segurar uma conexão e um tempo de vida para ele.
  ```csharp
  await using var s = (await blob.DownloadStreamingAsync()).Value.Content; await s.CopyToAsync(destino);
  ```
- **Opções de transferência trocam memória por velocidade.** Concorrência x tamanho do bloco é mais ou menos o buffer do upload (cerca de 250 MiB nos padrões para 1 GiB, 26 MiB com um bloco de 4 MiB por vez, com o dobro de requisições). Ajuste na rede real, não num emulador em loopback.
- **`OpenWriteAsync` é cômodo e esvazia o blob primeiro.** Serve para um nome novo, é arriscado para substituir; confirme descartando o stream e prefira um nome novo mais uma troca.
- **ETag otimista é simples e explosivo.** Sem escritas perdidas, mas 20 escritores num blob geraram mais de 1.100 retries. Lease para seções críticas raras e longas; particione para chaves quentes.
- **Uma escrita condicional repetida pode falhar contra si mesma.** Trate `ConditionNotMet` ou `BlobAlreadyExists` depois de um retry como "desconhecido": leia de volta antes de decidir.
- **Uma SAS é um bearer token.** Expiração curta e escopo estreito limitam o dano, uma política armazenada permite revogar, a delegação de usuário elimina a chave da conta, e nenhuma delas pode ser auditada por token (a doc diz que a geração de SAS não é auditada).
- **A chave da conta é o atalho que custa a conta inteira.** Ela assina toda SAS e ignora o RBAC; use identidade gerenciada e, quando nada mais precisar dela, `AllowSharedKeyAccess = false`.
- **O Azurite serve para caminhos de código.** Ele aceitou valores que o serviço real rejeita (tamanho de metadados, número de políticas, tamanho do bloco de append) e não tem recursos (undelete, versões, faixas de IP), então um teste verde no emulador não é um check verde em produção.

## Documentation Links

- [Quickstart: Azure Blob Storage client library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-dotnet) (doc)
- [Azure Storage Blobs client library for .NET 12.30.1, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/storage.blobs-readme) (doc)
- [Upload a blob with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload) (doc)
- [Performance tuning for uploads and downloads with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-tune-upload-download) (doc)
- [Understanding block blobs, append blobs, and page blobs, Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/understanding-block-blobs--append-blobs--and-page-blobs) (doc)
- [Scalability and performance targets for Blob storage, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/scalability-targets) (doc)
- [Manage and find Azure Blob data with blob index tags, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-manage-find-blobs) (doc)
- [Manage concurrency in Blob Storage, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage) (doc)
- [Access tiers for blob data, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview) (doc)
- [Grant limited access to Azure Storage resources using SAS, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview) (doc)
- [Create a service SAS for a container or blob with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/sas-service-create-dotnet) (doc)
- [Create a user delegation SAS for a container or blob with .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-user-delegation-sas-create-dotnet) (doc)
- [Define a stored access policy, Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/define-stored-access-policy) (doc)
- [Prevent authorization with Shared Key, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent) (doc)
- [Authorize access to blobs using Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory) (doc)
- [Azure built-in roles for Storage, Microsoft Learn](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage) (doc)
- [Dependency injection with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/dependency-injection) (doc)
- [Use the Azurite emulator for local Azure Storage development, Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (doc)
- [Migrate from Azure Storage .NET v11 to v12, GitHub](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/storage/Azure.Storage.Blobs/AzureStorageNetMigrationV12.md) (doc)
- [Multipart upload limits, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) (doc)
- [Conditional requests and writes, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) (doc)
- [Sharing objects with presigned URLs, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) (doc)
- [Organizing objects using prefixes, Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html) (doc)
- [rename(), POSIX.1-2017, The Open Group](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html) (doc)
