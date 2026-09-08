---
version: 1.0
updatedAt: 2026-08-22
title: "Uploads de Arquivo Multipart com RESTEasy Reactive"
summary: "O Quarkus REST lida com uploads multipart/form-data via @RestForm e FileUpload, desserializando partes mistas de texto/JSON/arquivo em uma única requisição, com limites de tamanho configuráveis e limpeza do diretório de upload."
---
## Objective

O Quarkus REST (construído sobre o RESTEasy Reactive) lida com requisições `multipart/form-data`, o formato que navegadores e clientes de API usam para enviar um arquivo junto com campos de formulário comuns em uma única requisição, através da anotação `@RestForm` e de um tipo dedicado `FileUpload`, em vez de fazer você analisar o corpo multipart à mão.

## Use Cases

- Aceitar um upload de arquivo (um trajeto GPX, uma foto de perfil, uma importação CSV) ao lado de metadados de texto simples (uma descrição, um nome) em uma única requisição POST.
- Impor limites de tamanho em campos de formulário individuais ou no próprio arquivo, antes mesmo de o método handler rodar.
- Desserializar uma parte de uma requisição multipart como JSON (por exemplo, um objeto `Person` enviado como uma parte de formulário) enquanto outras partes continuam strings simples ou arquivos.
- Ler o conteúdo enviado imediatamente no handler, já que o arquivo temporário que o apoia desaparece assim que a requisição termina, a menos que seja explicitamente movido.

## Deep Dive

### O handler multipart básico

```java
@POST
@Path("/upload")
@Consumes(MediaType.MULTIPART_FORM_DATA)
public void multipart(@RestForm String description,
                       @RestForm("track") FileUpload file,
                       @RestForm @PartType(MediaType.APPLICATION_JSON) Person uploader) {
    // description is a plain form field
    // file exposes the uploaded file's metadata and content
    // uploader is deserialized from a JSON part via @PartType
}
```

`@RestForm` liga uma parte nomeada da requisição multipart a um parâmetro de método; `@PartType` diz ao Quarkus como desserializar uma parte que não é texto simples.

### Lendo o arquivo enviado

`FileUpload` expõe o nome do arquivo da parte, o content type, e um caminho para onde o Quarkus armazenou temporariamente os bytes enviados em disco; leia-o dentro do handler, já que esse arquivo temporário só tem garantia de existir pela duração da requisição:

```java
@RestForm("track") FileUpload file;

// inside the handler:
Path staged = file.uploadedFile();
String original = file.fileName();
try (InputStream in = Files.newInputStream(staged)) {
    // parse the GPX content here
}
```

### Aceitando um número arbitrário de arquivos

Quando os nomes das partes não são conhecidos antecipadamente, `FileUpload.ALL` coleta toda parte de arquivo em uma lista:

```java
@RestForm(FileUpload.ALL) List<FileUpload> files;
```

### Limites de tamanho

Toda parte, não só arquivos, tem um teto máximo configurável, e uma requisição que o excede nunca chega ao handler:

```properties
quarkus.http.limits.max-form-attribute-size=2048
```

Uma requisição com uma parte grande demais recebe uma resposta HTTP 413 automaticamente.

### Onde os arquivos enviados ficam, e a limpeza

```properties
quarkus.http.body.uploads-directory=/tmp/uploads
quarkus.http.body.delete-uploaded-files-on-end=true
```

Com `delete-uploaded-files-on-end` habilitado (postura comum em produção por padrão), o Quarkus apaga o arquivo temporário assim que a resposta é enviada; então qualquer coisa que você precise manter tem que ser copiada para fora (para um banco de dados, armazenamento de objetos, ou um caminho permanente) durante o handler, não lida preguiçosamente depois.

## Trade-offs

- **O arquivo temporário tem escopo de requisição, não é durável**: tratar `FileUpload.uploadedFile()` como um caminho estável que você pode ler mais tarde (um job em background, uma tarefa enfileirada) quebra no momento em que `delete-uploaded-files-on-end` o limpa; mova ou persista o conteúdo antes de o handler retornar.
- **`@PartType(MediaType.APPLICATION_JSON)` acopla uma parte de formulário a um formato específico de serialização**: conveniente para uma única parte no formato JSON entre campos de arquivo, mas se todo campo é JSON, um corpo JSON simples sem multipart costuma ser o design mais simples.
- **Um `max-form-attribute-size` padrão baixo (2048 bytes) é fácil de atingir de surpresa**: ele se aplica a toda parte, incluindo campos de texto comuns, não só arquivos; um campo de texto moderadamente longo pode levar a um 413 até a propriedade ser elevada.
```properties
quarkus.http.limits.max-form-attribute-size=1048576
```
- **`FileUpload.ALL` troca estrutura por flexibilidade**: é a escolha certa quando o conjunto de arquivos é genuinamente dinâmico, mas para um conjunto fixo e conhecido de partes nomeadas, parâmetros individuais `@RestForm("name")` dão mais para o compilador e para quem lê o código trabalhar.

## Documentation Links

- [Guia Quarkus REST: seção de dados de formulário multipart](https://quarkus.io/guides/rest) (doc)
