---
version: 1.0
updatedAt: 2026-11-12
title: "Compressão de Resposta: Brotli, Gzip e Zstandard"
summary: O middleware de compressão de resposta do ASP.NET Core, os provedores zstd, br e gzip, o Vary - Accept-Encoding em toda resposta no .NET 11, HTTPS e BREACH, quando deixar a compressão para o proxy, e tamanho e tempo medidos em um payload de 371 KB.
---
## Objective

Uma lista JSON de 2.000 produtos tem 371.090 bytes no fio se ninguém comprimir, e 25.822 bytes se o servidor usar Zstandard no nível mais rápido. É uma queda de 93 por cento por uma linha no `Program.cs`, e é a mudança de desempenho mais barata que a maioria das APIs tem. Ela também vem com decisões fáceis de errar: quais codificações oferecer, em que ordem, se comprime sobre HTTPS, o que um cache na frente enxerga, e se o app deve fazer isso ou deixar para o proxy reverso.

Este concept cobre o middleware de compressão de resposta (`AddResponseCompression` e `UseResponseCompression`), os provedores que ele traz, o que o .NET 11 mudou (um provedor Zstandard embutido e `Vary: Accept-Encoding` em toda resposta) e números medidos no SDK 11.0.100 para tamanho e tempo. A compressão de arquivos estáticos em tempo de build (`MapStaticAssets`) é outro mecanismo, coberto no concept de arquivos estáticos.

## Use Cases

- Uma API JSON que devolve listas grandes, em que o payload é o principal custo em redes móveis.
- HTML renderizado no servidor ou um app Blazor que serve texto por um link mais lento que o servidor.
- Um app que não está atrás de um proxy que comprime (um container atrás de um load balancer simples, um único processo Kestrel).
- Decidir desligar o middleware porque o proxy ou a CDN já comprime.

## Deep Dive

### Duas linhas

```csharp
builder.Services.AddResponseCompression();

var app = builder.Build();
app.UseResponseCompression();   // antes dos endpoints que escrevem o corpo
```

O middleware olha o `Accept-Encoding` da requisição, escolhe um provedor e envolve o corpo da resposta em um stream que comprime. Ele precisa ser registrado antes dos endpoints: um middleware depois do endpoint nunca vê o corpo.

Sem configuração nenhuma, o .NET 11 registra três provedores, nesta ordem de preferência: Zstandard (`zstd`), Brotli (`br`) e Gzip (`gzip`). A documentação oficial descreve a mesma ordem: Zstandard se o cliente suporta, senão Brotli, senão Gzip. No teste abaixo o mesmo endpoint respondeu a cada requisição:

```text
Accept-Encoding: gzip, br         -> Content-Encoding: br
Accept-Encoding: zstd, gzip, br   -> Content-Encoding: zstd
Accept-Encoding: *                -> Content-Encoding: zstd
Accept-Encoding: identity         -> (sem compressão)
Accept-Encoding: br;q=0, gzip     -> Content-Encoding: gzip
Accept-Encoding: deflate          -> (sem compressão)
```

Uma qualidade zero tira uma codificação da escolha. A ordem do próprio servidor desempata; a ordem do cliente não importa, e é por isso que `gzip, br` recebe `br`. Um cliente que aceita só `deflate` recebe o corpo puro, porque não existe provedor deflate.

### O que é comprimido

O middleware comprime uma resposta quando o cliente enviou um `Accept-Encoding` utilizável, quando o tipo de conteúdo está na lista (JSON, HTML, texto puro, CSS, JavaScript e tipos de texto parecidos, de `ResponseCompressionDefaults.MimeTypes`) e quando a resposta ainda não está codificada. Uma resposta `image/png` de 50.000 bytes saiu intacta com `Accept-Encoding: br`, o que está certo: imagens, fontes e arquivos compactados já estão comprimidos, e comprimir de novo gasta CPU à toa.

Um tipo que não está na lista também não é comprimido, e no teste ele não recebe o header `Vary`. Para acrescentar um, estenda os padrões em vez de substituí-los:

```csharp
builder.Services.AddResponseCompression(options =>
{
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/x-ndjson"]);
});
```

Uma requisição a `application/x-ndjson` com `Accept-Encoding: br` voltou com 5.000 bytes puros e sem `Content-Encoding` nos padrões, e saiu como `br` no teste do lab depois da linha acima.

Não existe tamanho mínimo de corpo. Uma resposta de 11 bytes (`{"ok":true}`) saiu do Brotli com 15 bytes. O custo é pequeno para uma resposta assim e real se sua API é feita delas: você paga CPU para deixar a resposta maior. Se o seu tráfego é de corpos minúsculos, esse é um motivo para fazer o trabalho em um proxy que tem um limite mínimo.

### Escolher e ordenar provedores

Para usar só alguns provedores, limpe a lista e adicione-os na ordem desejada:

```csharp
builder.Services.AddResponseCompression(options =>
{
    options.Providers.Clear();
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
```

Com isso, `Accept-Encoding: zstd, br, gzip` é respondido com `br`. Um motivo para fazer isso é uma população de clientes ou uma CDN que ainda não lida com `zstd`; um navegador que não envia `zstd` no `Accept-Encoding` nunca o recebe de qualquer forma, então o risco está em intermediários que reescrevem o header, não no navegador.

Os níveis se definem por provedor. Brotli e Gzip usam `CompressionLevel.Fastest` por padrão, e o Zstandard recebe um número de qualidade do seu próprio tipo de options:

```csharp
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Optimal);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.SmallestSize);
builder.Services.Configure<ZstandardCompressionProviderOptions>(o =>
    o.CompressionOptions = new ZstandardCompressionOptions { Quality = 3 });
```

A documentação dá a faixa do Zstandard como 1 a 22. A qualidade 0 é o que um app sem configuração tem (a propriedade imprimiu `0` no teste), e esta página não mediu a que nível isso corresponde, então defina o número se o número importar.

### Números: tamanho e tempo

O payload é um array JSON de 2.000 objetos (um id, um nome, um SKU, um preço, três tags e uma descrição de 76 caracteres), 371.090 bytes, gerado com uma semente aleatória fixa. O servidor era um processo Kestrel em loopback, o cliente era um `HttpClient` com descompressão automática desligada, e cada célula é a média de 300 requisições sequenciais: o tempo inclui a compressão no servidor e a leitura do corpo no cliente, então não é um custo puro de compressão. Uma máquina, um payload, uma execução: use para comparar o formato, não como benchmark.

| Nível no teste | gzip bytes | gzip ms | br bytes | br ms | zstd bytes | zstd ms |
|---|---|---|---|---|---|---|
| Fastest (gzip e br `Fastest`, zstd qualidade 1) | 46.433 | 0,59 | 49.136 | 1,05 | 25.822 | 0,38 |
| Optimal (gzip e br `Optimal`, zstd qualidade 3) | 30.121 | 1,05 | 25.867 | 1,01 | 27.305 | 0,53 |
| SmallestSize (gzip, br no nível máximo, zstd qualidade 19) | 29.637 | 2,18 | 18.054 | 396,08 | 19.645 | 168,82 |

Como referência, a mesma requisição sem compressão levou 0,36 ms e enviou os 371.090 bytes inteiros.

O que os números dizem:

- **O Zstandard no nível mais rápido venceu Gzip e Brotli nos deles, em tamanho e em tempo.** 25.822 bytes em 0,38 ms contra 46.433 em 0,59 do Gzip e 49.136 em 1,05 do Brotli. É a razão da ordem padrão: um cliente que aceita `zstd` recebe o melhor tamanho por CPU.
- **No nível do meio os três ficam próximos.** O Brotli é o menor (25.867), o Zstandard é 5,6 por cento maior (27.305) e levou cerca de metade do tempo (0,53 ms contra 1,01), e o Gzip é 16 por cento maior que o Brotli (30.121).
- **O nível máximo é uma armadilha para respostas dinâmicas.** O Brotli no nível máximo economizou mais 30 por cento sobre o nível do meio (18.054 contra 25.867) e custou 396 ms por requisição contra 1 ms. O Zstandard em 19 custou 169 ms. Isso serve para um arquivo comprimido uma vez no build (o que o `MapStaticAssets` faz) e é uma autossabotagem para uma resposta comprimida a cada requisição.
- **O Gzip quase não muda com o nível.** De Optimal para SmallestSize foi de 30.121 para 29.637 bytes e dobrou o tempo.

A leitura prática: para respostas dinâmicas fique nos níveis rápido ou do meio, e deixe a ordem padrão (Zstandard primeiro) escolher. Meça com o seu payload: JSON com chaves longas repetidas, como aqui, comprime muito melhor que um payload de identificadores aleatórios.

### `Vary: Accept-Encoding`

A mesma URL agora tem mais de um corpo possível: o puro, o gzip, o Zstandard. Um cache entre você e o cliente (uma CDN, um proxy, o cache HTTP do navegador) precisa saber que o header de requisição `Accept-Encoding` faz parte da chave, e o jeito de dizer isso é `Vary: Accept-Encoding`.

Antes do .NET 11 o middleware só acrescentava `Vary` às respostas que comprimia. Desde o .NET 11 (uma breaking change documentada) ele o acrescenta às respostas que tratou mesmo quando não comprimiu, então um cache não pode guardar a versão pura e servi-la a um cliente que pediu gzip, nem o contrário. No teste, uma requisição sem nenhum `Accept-Encoding` voltou com `Vary: Accept-Encoding` e um corpo puro de 371.090 bytes.

Um detalhe não bateu com a documentação. A documentação diz que o header é acrescentado a toda resposta que passa pelo middleware, inclusive tipos de conteúdo fora de `MimeTypes`. No teste, uma resposta `image/png` de 50.000 bytes com `Accept-Encoding: br` voltou sem `Vary` nenhum. O texto da página da breaking change e o comportamento observado divergem nesse caso; isso não afeta JSON nem HTML, que são os tipos comprimidos, e uma CDN costuma usar a codificação na chave de qualquer forma. A ação que a documentação recomenda é conferir se a CDN ou o proxy normaliza o `Accept-Encoding`, para não guardar uma variante por grafia do header.

### HTTPS e BREACH

`EnableForHttps` é `false` por padrão, e a documentação diz o porquê: comprimir respostas sobre TLS pode expor um app a ataques CRIME e BREACH. O BREACH precisa de uma resposta que contenha um segredo (um token CSRF, um identificador de sessão no corpo) e um texto que o atacante consiga fazer o servidor refletir, e mede o tamanho comprimido para adivinhar o segredo um caractere por vez. A compressão muda o tamanho, o tamanho vaza, e o TLS não esconde o tamanho.

Isso é uma decisão sobre a resposta, não um interruptor do app:

- Uma lista JSON pública ou uma página quase estática sem segredo e sem entrada refletida pode ser comprimida sem problema.
- Uma página com um formulário com token antiforgery que ecoa uma query string é o caso que o padrão protege.

Com a flag desligada, uma requisição que chega ao app por `https` não é comprimida. O teste do lab usa o endereço base `https://localhost` e confere os dois valores da flag. Uma consequência sutil: quando o TLS termina em um proxy e o app enxerga `http` puro, o app comprime, e o segredo fica igualmente exposto no caminho até o cliente. O esquema que o app vê não é o esquema que o cliente usou.

### Quando o proxy deve fazer isso

A documentação recomenda a compressão baseada em servidor (IIS, Apache, Nginx) em vez do middleware, com o motivo de que o middleware "provavelmente não consegue igualar" os módulos do servidor, e lista os casos em que o middleware é a escolha: o app não pode usar esses módulos, ou está hospedado direto no Kestrel ou no HTTP.sys, que não têm compressão embutida. Na prática:

- **Atrás de uma CDN ou de um Nginx que comprime**, deixe o middleware desligado. Comprimir duas vezes gasta CPU. O proxy também tem o que o middleware não tem: um tamanho mínimo, cache da versão comprimida e compressão de arquivos estáticos feita uma vez.
- **Um proxy que remove o `Accept-Encoding`** faz o middleware não comprimir nada. A documentação cita o Nginx como exemplo (issue 5989) e a correção está na configuração do proxy, não no app.
- **Um container atrás de um load balancer TCP ou HTTP simples** sem compressão é onde o middleware se paga.
- **Quem quer que comprima, faça em um lugar só.** Uma resposta comprimida pelo app e de novo pelo proxy é a falha a evitar, e `curl -s -D - -o /dev/null -H "Accept-Encoding: zstd"` contra o app e contra a URL pública mostra qual camada respondeu.

## Trade-offs

- **CPU no caminho da requisição.** O middleware comprime a cada requisição, na thread que atende. Nos níveis rápidos o custo no teste ficou abaixo de um milissegundo, mas nos níveis máximos foi de 169 a 396 ms para um corpo de 371 KB. Uma cópia comprimida guardada em cache pelo proxy, ou produzida no build, é de graça em tempo de execução; a do middleware não é.
- **Menor nem sempre é mais rápido.** Os bytes economizados só ajudam se o link é o gargalo. Numa rede interna rápida entre dois serviços a transferência economizada pode ser menor que o tempo de compressão, e para corpos minúsculos a resposta fica maior.
- **Uma codificação nova precisa de um cliente que a envie.** O Zstandard é o primeiro na ordem padrão, mas um cliente que não lista `zstd` recebe Brotli ou Gzip, e um proxy que reescreve o `Accept-Encoding` decide por conta própria. O servidor não pode escolher uma codificação que o cliente não ofereceu.
- **Os padrões favorecem segurança sobre tamanho.** A compressão sobre HTTPS vem desligada e os níveis são `Fastest`. O resultado é conservador: perde-se uns 30 por cento no nível do meio do Brotli, e fica-se sem nenhuma compressão em apps atrás de um proxy que termina o TLS e enxerga `http`.
- **`Vary` acrescenta variantes de cache.** Um cache que não normaliza o `Accept-Encoding` guarda uma cópia por grafia do header, então a mesma URL ocupa vários espaços. O conselho da documentação é conferir a configuração da CDN.
- **O risco de segurança está no conteúdo, não no código.** O BREACH não é corrigido por uma versão de biblioteca. Quais páginas misturam segredos com entrada refletida é algo que o time precisa saber, e não está visível na configuração do middleware.
- **Não esqueça de testar.** Um `UseResponseCompression` fora do lugar ou um tipo MIME removido compila, roda e simplesmente envia o corpo grande. Um teste que pede `br` e confere o `Content-Encoding` é a única rede de segurança.

## Lab

Neste lab você recebe uma API com quatro endpoints (370 KB de JSON, o mesmo corpo como `application/x-ndjson`, um corpo JSON de 11 bytes e um `image/png` de 50 KB) e nenhuma compressão. Você registra o middleware, estende os tipos MIME, lê a decisão sobre HTTPS da configuração e torna a ordem dos provedores configurável. Os testes pedem cada codificação e conferem `Content-Encoding`, `Vary` e o tamanho do que trafega. O lab usa `net11.0` e precisa do SDK 11. Sem Docker e sem certificado: os testes simulam HTTPS usando o endereço base `https://localhost`.

**O cenário**

- `Program.cs`: os quatro endpoints e um catálogo gerado de 2.000 produtos.
- Duas chaves de configuração: `Compression:EnableForHttps` e `Compression:PreferBrotli`, definidas pelos testes.

**O que você vai fazer, passo a passo**

1. **Registre a compressão (TODO-00).** Flag de HTTPS vinda da configuração, tipos MIME como os padrões mais `application/x-ndjson`, e Brotli depois Gzip somente quando `PreferBrotli` for true.
2. **Adicione o middleware (TODO-01).** Coloque-o antes dos endpoints.

**Como você sabe que terminou**

`dotnet test` fica verde. Para cada teste você consegue dizer quem decidiu: o `Accept-Encoding` do cliente, a ordem dos provedores, a lista de tipos MIME ou a flag de HTTPS. Também consegue dizer por que o corpo de 11 bytes cresceu.

**Desafios opcionais**

- **TODO-02:** escreva duas formas de deixar corpos pequenos sem comprimir e escolha uma.
- **TODO-03:** defina o nível do Gzip como `SmallestSize`, compare o tamanho com o padrão e diga o que você pagou.

**Pré-requisitos:** Minimal APIs, ordem de middlewares, o que é `Accept-Encoding` e o SDK 11.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O starter compila e os testes de compressão falham até você completar os TODOs.

## Documentation Links

- [Response compression in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/response-compression) (doc)
- [Breaking change: response compression always emits Vary: Accept-Encoding, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/response-compression-always-vary) (doc)
- [RFC 8878: Zstandard Compression and the application/zstd Media Type](https://datatracker.ietf.org/doc/html/rfc8878) (doc)
- [BREACH (security exploit), Wikipedia](https://en.wikipedia.org/wiki/BREACH) (doc)
- [Vary header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary) (doc)
