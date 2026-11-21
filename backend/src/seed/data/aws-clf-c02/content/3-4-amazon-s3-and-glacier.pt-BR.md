---
version: 1.0
updatedAt: 2026-11-21
---
# Armazenamento de objetos: Amazon S3, classes de armazenamento, ciclo de vida e S3 Glacier

> Domínio do exame: **Tecnologia e Serviços de Nuvem (34%)**, objetivo 3.6 *Identificar os serviços de armazenamento da AWS*.

---

## O que o exame quer

Do objetivo 3.6, esta lição cobre **usos do armazenamento de objetos**, as **diferenças entre as classes de armazenamento do S3** e **casos de uso de políticas de ciclo de vida**, além do Amazon S3 Glacier. A lição 3-5 cobre armazenamento em bloco, de arquivos e híbrido, e o AWS Backup. As questões descrevem um padrão de acesso e pedem uma classe: aprenda a ler o padrão.

---

## Armazenamento de objetos em um parágrafo

O Amazon S3 armazena **objetos** (dados mais uma chave e metadados) em **buckets**. Você acessa os objetos pela API do S3 via HTTP(S), e não como um disco anexado a uma instância. Um bucket não tem tamanho máximo nem limite para o número de objetos. Usos típicos: backups e arquivamento, data lakes, arquivos de mídia, ativos de sites estáticos, armazenamento de logs.

- O nome de um bucket de uso geral precisa ser único entre todas as contas e Regiões **dentro de uma partição** (a partição padrão da AWS, a da China, a do GovCloud e outras). Se outra conta já é dona do nome, você não pode criá-lo.
- Os nomes têm de 3 a 63 caracteres, entre letras minúsculas, números, pontos e hifens, e devem começar e terminar com uma letra ou um número.
- Um bucket é criado em **uma Região**, e seu nome e sua Região não podem ser alterados depois.
- O S3 não é um dispositivo de bloco nem um volume do EC2. (Ferramentas como o Mountpoint for Amazon S3 podem apresentar um bucket como um sistema de arquivos local, traduzindo operações de arquivo em chamadas da API do S3, mas os dados continuam sendo objetos.)

---

## Escolha a classe de armazenamento pelo padrão de acesso

Todas as classes abaixo são projetadas para **11 noves (99,999999999%) de durabilidade**. As classes diferem em disponibilidade, número de AZs, duração mínima de armazenamento e custo de recuperação.

| Classe | AZs | Duração mínima de armazenamento | Acesso | Escolha quando |
|--------|-----|---------------------------------|--------|----------------|
| **S3 Standard** | 3 ou mais | Nenhuma | Milissegundos, sem taxa de recuperação | Dados acessados com frequência |
| **S3 Intelligent-Tiering** | 3 ou mais | Nenhuma | Milissegundos (camadas de acesso frequente e infrequente), sem taxa de recuperação, pequena taxa de monitoramento por objeto | Padrão de acesso **desconhecido ou variável** |
| **S3 Standard-IA** | 3 ou mais | 30 dias | Milissegundos, taxa de recuperação por GB | Raramente lidos, mas precisam estar **disponíveis imediatamente** |
| **S3 One Zone-IA** | **1** | 30 dias | Milissegundos, taxa de recuperação por GB | Raramente lidos e **fáceis de recriar** (a perda de uma AZ perde os dados) |
| **S3 Glacier Instant Retrieval** | 3 ou mais | 90 dias | **Milissegundos**, taxa de recuperação | Arquivo raramente lido, mas que ainda precisa de acesso instantâneo |
| **S3 Glacier Flexible Retrieval** | 3 ou mais | 90 dias | **Restauração primeiro**: de minutos a horas | Arquivo em que uma espera de minutos ou horas é aceitável |
| **S3 Glacier Deep Archive** | 3 ou mais | 180 dias | **Restauração primeiro**: em até 12 ou 48 horas | Retenção de longo prazo de menor custo, lida talvez uma vez por ano |

- Todas as classes, exceto a One Zone-IA (e a S3 Express One Zone), são projetadas para sobreviver à perda física de uma AZ.
- O **Intelligent-Tiering** move um objeto para uma camada de acesso infrequente após 30 dias consecutivos sem acesso e para uma camada de acesso instantâneo de arquivamento após 90 dias, e o traz de volta quando ele é lido. As camadas de arquivamento opcionais exigem uma restauração.
- O **Reduced Redundancy Storage** ainda aparece em material antigo; a AWS recomenda não usá-lo.

```text
 hot ----------------------------------------------------------------> cold
 Standard  ->  Standard-IA / One Zone-IA  ->  Glacier Instant  ->  Glacier Flexible  ->  Deep Archive
 (no min)      (30 days)                       (90 days)           (90 days)             (180 days)
 unknown pattern?  ->  Intelligent-Tiering
```

**Não citado no guia do exame (apenas contexto):** o S3 Express One Zone é uma classe mais recente, de AZ única, com acesso em milissegundos de um dígito, armazenada em buckets de diretório. O guia não a lista.

---

## Restauração a partir das classes Glacier

| Classe | Expedited | Standard | Bulk |
|--------|-----------|----------|------|
| **Glacier Flexible Retrieval** | 1 a 5 minutos | 3 a 5 horas (padrão) | 5 a 12 horas, gratuita |
| **Glacier Deep Archive** | Não disponível | Em até 12 horas | Em até 48 horas |

- **O Glacier Instant Retrieval não precisa de restauração**: um GET normal funciona em milissegundos.
- A capacidade provisionada apenas garante que as recuperações Expedited estejam disponíveis; ela não é uma camada de recuperação.
- Você pode enviar um objeto diretamente com a classe de armazenamento `GLACIER` ou `DEEP_ARCHIVE`, ou movê-lo para lá com uma regra de ciclo de vida.

> Material de estudo antigo ensina "Amazon Glacier" com cofres (vaults) e arquivos como um serviço separado. A documentação oficial atual diz que o serviço Glacier autônomo, baseado em cofres, não aceita mais novos clientes; use as classes de armazenamento S3 Glacier dentro do S3.

---

## Ciclo de vida, versionamento e replicação

As **regras de ciclo de vida** fazem a transição dos objetos para classes mais baratas conforme envelhecem e os expiram (excluem) quando não são mais necessários. As transições seguem em um único sentido, descendo a cascata: o Standard pode ir para qualquer classe, o Standard-IA pode ir para o Intelligent-Tiering, o One Zone-IA ou qualquer classe Glacier, e nada sai do Deep Archive por uma regra de ciclo de vida. Por padrão, objetos menores que 128 KB não sofrem transição.

Exemplo: os logs de uma aplicação são lidos diariamente por 30 dias, mantidos para auditoria por 7 anos e depois excluídos.

```json
{ "Rules": [ { "ID": "logs", "Status": "Enabled", "Filter": { "Prefix": "logs/" },
  "Transitions": [ { "Days": 30, "StorageClass": "STANDARD_IA" },
                   { "Days": 90, "StorageClass": "DEEP_ARCHIVE" } ],
  "Expiration": { "Days": 2555 } } ] }
```

A etapa IA dura 60 dias aqui, mais que o mínimo de 30 dias, então nenhuma cobrança por exclusão antecipada se aplica na mudança para o Deep Archive.

| Recurso | O que faz |
|---------|-----------|
| **Versionamento** | Mantém todas as versões de um objeto, protegendo contra sobrescritas e exclusões. Desabilitado por padrão; um bucket é não versionado, com versionamento habilitado ou com versionamento suspenso. Um simples DELETE em um objeto versionado adiciona um marcador de exclusão (delete marker) |
| **Replicação** | Copia objetos de forma assíncrona para outro bucket: **Cross-Region Replication** (Região diferente) ou **Same-Region Replication**. Os dois buckets precisam ter o versionamento habilitado |
| **Transfer Acceleration** | Acelera uploads e downloads de longa distância por meio dos pontos de presença do CloudFront |
| **Hospedagem de site estático** | Serve arquivos estáticos de um bucket; os endpoints de site são somente HTTP. A AWS agora recomenda o AWS Amplify Hosting (com CloudFront e HTTPS) para sites estáticos armazenados no S3 |

---

## Atenção

- **Acesso raro, mas leitura instantânea a baixo custo: Standard-IA ou Glacier Instant Retrieval**, não Glacier Flexible nem Deep Archive, que exigem uma restauração primeiro.
- **Padrão de acesso desconhecido ou variável: Intelligent-Tiering.** Ele não tem taxa de recuperação nem duração mínima.
- **O One Zone-IA mantém os dados em uma única AZ.** Use-o apenas para dados que você pode recriar. A durabilidade dele continua sendo de 11 noves; o que é menor é a resiliência à perda da AZ.
- **A duração mínima de armazenamento** se aplica ao IA (30 dias), ao Glacier Instant e Flexible (90 dias) e ao Deep Archive (180 dias). Excluir antes ainda cobra o mínimo.
- **A replicação exige versionamento nos dois buckets.**
- **Marcadores de exclusão existem apenas em buckets versionados.**
- **Os nomes de bucket são únicos dentro da partição**, então um nome usado por qualquer outra conta fica indisponível.

> Material de estudo antigo cita um limite de objeto de 5 TB, uma cota padrão de 100 buckets e "seis" classes do S3. A documentação oficial atual traz limites maiores e mais classes; os limites mudam, então não os memorize.

## Verificação rápida

1. Os dados são lidos algumas vezes por ano, mas cada leitura precisa retornar em milissegundos, pelo menor custo. Qual classe? **S3 Glacier Instant Retrieval.**
2. Ninguém consegue prever com que frequência um conjunto de dados será acessado. Qual classe? **S3 Intelligent-Tiering.**
3. Registros de conformidade são mantidos por anos e uma espera de 12 horas é aceitável. Classe mais barata? **S3 Glacier Deep Archive.**
4. O que precisa estar habilitado nos dois buckets para a Cross-Region Replication? **Versionamento.**
5. O que move objetos para classes mais baratas automaticamente conforme envelhecem? **Uma regra de ciclo de vida do S3.**

## Documentação oficial

- [Amazon S3 storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html)
- [Amazon S3 storage classes (product page)](https://aws.amazon.com/s3/storage-classes/)
- [General purpose bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)
- [Lifecycle transitions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)
- [Archive retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)
- [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [Replicating objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)
