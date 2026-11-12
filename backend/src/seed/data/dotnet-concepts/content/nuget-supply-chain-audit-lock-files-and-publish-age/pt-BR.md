---
version: 1.0
updatedAt: 2026-11-12
title: "Cadeia de suprimentos do NuGet: audit, lock file e idade mínima de publicação"
summary: Defesa em camadas no NuGet com saídas reais do SDK 11.0.100, incluindo NuGetAudit e seus níveis, packages.lock.json com --locked-mode (NU1004 e NU1403), pinning transitivo, assinaturas e a nova idade mínima de publicação (minPublishAgeHours, NU1020).
---
## Objective

Cada `PackageReference` é código de um desconhecido que roda no seu agente de
build e em produção. O NuGet tem várias defesas contra isso, e cada uma responde
a uma pergunta diferente: esta versão é conhecida como vulnerável (`NuGetAudit`),
este é o mesmo conteúdo que eu restaurei da última vez (o lock file e seus
hashes), veio do feed que eu pretendia (Package Source Mapping), e ela é nova
demais, de modo que ninguém teve tempo de notar uma versão maliciosa (a idade
mínima de publicação que chegou com o SDK do .NET 11). Este concept coloca todas
lado a lado: o que cada uma impede, o que não impede, os avisos e erros exatos
que obtive do SDK 11.0.100 e como combiná-las sem quebrar todo build. Os
fundamentos de restore e a mecânica do lock file estão no concept de restore, e
Central Package Management e source mapping têm concept próprio; este é a visão
de defesa em profundidade e a nova configuração de idade.

## Use Cases

- Falhar um job de CI quando algum pacote do grafo, direto ou transitivo, tem advisory alto ou crítico conhecido.
- Fazer o restore no agente de build falhar se o conteúdo de um pacote difere do que um desenvolvedor restaurou.
- Esperar alguns dias antes que as ferramentas automáticas adotem uma versão recém-publicada.
- Decidir qual defesa responde a qual incidente: uma CVE, uma versão sequestrada, uma colisão de nome, uma versão envenenada.

## Deep Dive

### O que cada defesa impede

| Defesa | Impede | Não impede |
|---|---|---|
| `NuGetAudit` | adotar ou manter uma versão com advisory publicado | uma versão maliciosa que ninguém reportou ainda |
| Lock file, `--locked-mode` | uma versão ou conteúdo que mudou desde o último restore | o primeiro restore, antes de o arquivo existir |
| Package Source Mapping | um ID de pacote vindo do feed errado | um pacote ruim no feed certo |
| Idade mínima de publicação | a escolha automática de uma versão nova demais | um pacote fixado à mão, ou que já está no grafo |

Nenhuma linha cobre o risco inteiro, e é por isso que se empilham as defesas. A
mesma tabela serve de guia de leitura para as seções abaixo.

### NuGetAudit: modos, níveis e de onde vêm os dados

O audit roda durante o restore e baixa os dados de vulnerabilidade do nuget.org
(o log do restore mostra requisições a `api.nuget.org/v3/vulnerabilities/index.json`).
Tudo abaixo é do SDK .NET 11.0.100 com um projeto `net11.0` referenciando
`Microsoft.EntityFrameworkCore` 8.0.0, que depende de
`Microsoft.Extensions.Caching.Memory` 8.0.0. Sem nenhuma configuração de audit:

```text
warning NU1903: Package 'Microsoft.Extensions.Caching.Memory' 8.0.0 has a known high severity vulnerability,
https://github.com/advisories/GHSA-qj66-m88j-hmgj
```

O pacote é transitivo, e o aviso apareceu por padrão: em projetos que miram um
framework recente `NuGetAuditMode` é `all`. Mudando as configurações:

| Configuração | Resultado neste projeto |
|---|---|
| nenhuma | `NU1903` |
| `<NuGetAuditMode>direct</NuGetAuditMode>` | sem aviso (o pacote é transitivo) |
| `<NuGetAuditLevel>critical</NuGetAuditLevel>` | sem aviso (o advisory é alto) |
| `<NuGetAudit>false</NuGetAudit>` | sem aviso |
| `WarningsAsErrors` com `NU1901;NU1902;NU1903;NU1904` | `error NU1903: Warning As Error: ...` e o restore falha |

Os quatro códigos seguem a severidade: `NU1901` baixa, `NU1902` moderada,
`NU1903` alta, `NU1904` crítica. `direct` é um ponto cego por definição, então
use `all` no CI. Para ver o quadro todo, `dotnet list package --vulnerable --include-transitive`
imprimiu `Transitive Package ... Microsoft.Extensions.Caching.Memory 8.0.0 High`
com a URL do advisory, e `dotnet nuget why app.csproj Microsoft.Extensions.Caching.Memory`
imprimiu o caminho `Microsoft.EntityFrameworkCore@8.0.0 > Microsoft.Extensions.Caching.Memory@8.0.0`,
que diz quem você precisa atualizar.

Para aceitar um advisory que você ainda não consegue corrigir, suprima aquela
URL. É um **item**: `<NuGetAuditSuppress Include="https://github.com/advisories/GHSA-qj66-m88j-hmgj" />`
silenciou o aviso, enquanto a mesma URL escrita como propriedade
(`<NuGetAuditSuppress>...</NuGetAuditSuppress>`) não fez nada e o aviso continuou.
Uma supressão é uma dívida: acrescente um comentário com o motivo e uma data.

### Corrigindo um pacote transitivo vulnerável

Atualizar o pai é o melhor caminho, mas nem sempre é possível. O Central Package
Management pode subir o pacote transitivo para você (a mecânica está no concept
anterior). Com `CentralPackageTransitivePinningEnabled` e
`<PackageVersion Include="Microsoft.Extensions.Caching.Memory" Version="8.0.1" />`
no `Directory.Packages.props`, o restore ficou limpo e `dotnet package list --include-transitive`
mostrou `Microsoft.Extensions.Caching.Memory 8.0.1`. No lock file a entrada
virou `"type": "CentralTransitive"` com `"requested": "[8.0.1, )"`, então o pin
fica visível no code review.

### O lock file e o modo locked

`RestorePackagesWithLockFile` grava o `packages.lock.json` com a versão resolvida
e um `contentHash` de cada pacote, direto e transitivo. No modo locked
(`dotnet restore --locked-mode`, ou a propriedade `RestoreLockedMode`; a forma
por propriedade restaurou normalmente na minha execução) o NuGet compara o lock
file com o que o projeto pede e com o que baixa. Quebrei de duas formas:

```text
# editei um contentHash e removi aquele pacote do cache local
error NU1403: Package content hash validation failed for Microsoft.Extensions.Logging.8.0.0.
The package is different than the last restore.

# subi uma versão central sem regenerar o lock file
error NU1004: Mistmatch between the requestedVersion of a lock file dependency marked as CentralTransitive
and the the version specified in the central package management file. ...
The packages lock file is inconsistent with the project dependencies so restore can't be run in locked mode.
```

Os dois erros significam coisas diferentes. `NU1004` é deriva: o projeto e o
lock discordam, normalmente um regenerate esquecido. `NU1403` é o que importa
para a cadeia de suprimentos: mesmo ID e versão, bytes diferentes. Removi o
pacote do meu cache local para que o restore precisasse baixá-lo de novo e
comparar; não testei o que acontece quando o pacote já está no cache. (Os erros
de digitação do `NU1004` estão na mensagem real.) Faça commit do lock file,
revise o diff como código e deixe só um `dotnet restore` deliberado, sem
`--locked-mode`, reescrevê-lo.

### Assinaturas

O nuget.org assina os pacotes. `dotnet nuget verify <arquivo.nupkg> --all` no
`Newtonsoft.Json` 13.0.3 imprimiu duas assinaturas: `Signature type: Author`
(subject `Json.NET (.NET Foundation)`) e `Signature type: Repository` (subject
`NuGet.org Repository by Microsoft`), cada uma com o hash do certificado. Isso
diz quem assinou e que os bytes não foram alterados depois da assinatura. Não
diz que o código é seguro. Exigir assinaturas no restore é uma configuração de
confiança separada que não testei; veja a página de boas práticas de segurança.

### Idade mínima de publicação, novidade do SDK do .NET 11

A ideia mais nova é emprestada de outros ecossistemas: não adotar uma versão até
que ela esteja pública há algum tempo, para que a comunidade tenha chance de
notar uma versão maliciosa. Ela exige NuGet 8.0 e o SDK .NET 11.0.100 (ou Visual
Studio 18.12), e é opt-in. A configuração é `minPublishAgeHours`, por fonte, no
`nuget.config`:

```xml
<packageSources>
  <clear />
  <add key="nuget.org" value="https://api.nuget.org/v3/index.json" minPublishAgeHours="72" />
</packageSources>
<minPublishAgeExceptions>
  <package pattern="Contoso.*" />
</minPublishAgeExceptions>
```

`dotnet nuget update source nuget.org --min-publish-age-hours 72` grava o
atributo (e `add source` aceita a mesma opção). As exceções usam a sintaxe de
padrões do Package Source Mapping e valem para todas as versões e todas as
fontes; um `<minPublishAgeExceptions />` vazio impede exceções herdadas de
arquivos de configuração externos.

Para ver funcionando num feed real sem esperar uma versão nova, configurei uma
idade longa, 15000 horas (cerca de 625 dias). No nuget.org o `Newtonsoft.Json`
13.0.3 foi publicado em 2023-03-08 e o 13.0.4 em 2025-09-16, então só o 13.0.3
é antigo o bastante:

```text
$ dotnet package add Newtonsoft.Json
... PackageReference for package 'Newtonsoft.Json' version '13.0.3' added ...

$ dotnet package add Newtonsoft.Json --version 13.0.4      # pedido explícito
... version '13.0.4' added ...                              # ignora a idade

$ dotnet package update Newtonsoft.Json                    # a partir da 12.0.1
Packages with newer versions that have not reached the configured minimum publish age: Newtonsoft.Json.
    Updating Newtonsoft.Json 12.0.1 to 13.0.3.
```

A versão estável mais nova no nuget.org é a 13.0.4, então a idade mudou a
escolha. Com `minPublishAgeExceptions` para `Newtonsoft.*`, o mesmo update foi
para a 13.0.4. `dotnet package update --vulnerable` a partir da 12.0.1 escolheu
a 13.0.1, a menor versão sem advisory conhecido. Segundo a documentação do
NuGet, a idade ainda vale nesse caminho, então uma correção recém-publicada não
é adotada automaticamente e você decide se espera ou pede a versão pelo nome.

Três limites importam mais que o recurso:

- **O restore não impõe a idade.** Com a referência 13.0.4 acima no projeto, `dotnet restore` funcionou. A documentação diz o mesmo para pacotes transitivos e para uma versão digitada à mão: a idade filtra só escolhas automáticas.
- **Versões flutuantes são rejeitadas.** Uma referência `Version="13.0.*"` com idade na fonte falhou no restore: `error NU1020: The following PackageReference items cannot specify a floating version because package source cooldown is enabled: Newtonsoft.Json.` A exceção para `Newtonsoft.*` fez a mesma referência restaurar. A documentação acrescenta que, com Package Source Mapping, só as fontes mapeadas para o pacote são consideradas; não testei isso.
- **Depende da data de publicação.** A documentação diz que uma fonte que não devolve datas faz o comando falhar em vez de adivinhar, e que espelhos podem informar a data da cópia em vez da original. Confira o seu feed interno.

A documentação também diz que cada fonte é avaliada de forma independente (uma
versão antiga o bastante numa fonte pode ser escolhida mesmo que outra fonte a
tenha como nova demais), então combine com source mapping.

### Uma mudança de restore no .NET 11

Mais uma mudança vai na mesma direção. Quando a versão pedida não existe, o
restore costumava escolher a "próxima melhor" versão nas fontes e também na pasta
global de pacotes. No .NET 11 ele olha só as fontes (NU1603 como aviso, ou NU1102
quando nenhuma fonte tem uma versão maior), então duas máquinas com caches
diferentes escolhem a mesma versão. Não reproduzi; vem da página de breaking
change linkada abaixo. O conselho prático é o mesmo de todo o resto: referencie
versões que existem nas suas fontes.

## Trade-offs

- **Audit como erro bloqueia releases que você não consegue corrigir ainda.** Um
  advisory novo quebra todo build no mesmo dia. Mantenha os avisos visíveis
  localmente e torne `NU1901` a `NU1904` erros num job só, com supressão e um
  motivo como saída.
  ```xml
  <WarningsAsErrors>$(WarningsAsErrors);NU1903;NU1904</WarningsAsErrors>
  ```
- **`NuGetAuditMode` `direct` esconde o suspeito de sempre.** A maioria dos
  advisories está em pacotes transitivos, como mostra o exemplo do `Caching.Memory`.
- **Um lock file move o trabalho para o review.** Toda atualização toca dois
  arquivos e o `--locked-mode` falha até alguém regenerar o lock. Esse atrito é o
  objetivo, mas precisa de um dono.
- **`NU1403` também pode ser uma republicação legítima.** Trate como "pare e
  investigue", não como "tente de novo".
- **Uma idade de publicação atrasa correções também.** Um patch novo para uma
  vulnerabilidade espera junto com o resto. Use uma versão explícita depois de
  ler o release, o que não remove a idade dos outros pacotes, em vez de uma
  exceção, que remove.
- **A idade é um quebra-molas, não um veredito.** Ela exige que o pacote seja
  notado dentro da sua janela e não vale para o restore. Não confie nela para
  pacotes que já estão no grafo.
- **Versões flutuantes e idade não combinam.** Troque `1.2.*` por uma versão fixa
  mais um lock file.

## Lab

Neste lab você recebe `SupplyChain` com **métodos vazios** (`NotImplementedException`). Sua tarefa é escrever as propriedades de projeto para audit e lock file, um `nuget.config` com idade mínima de publicação e source mapping, e as regras por trás da escolha de versão, dos códigos de audit e do restore locked. A ideia central é que cada defesa é uma regra pequena e verificável, e que as armadilhas estão nos detalhes: um item que parece propriedade, uma seção vazia que mesmo assim precisa ser escrita, e dois erros diferentes para dois tipos diferentes de deriva.

**O cenário**

Nada baixa pacote. Os testes escrevem o texto do seu projeto numa pasta temporária e deixam o `dotnet msbuild -getProperty -getItem` avaliá-lo (sem restore, sem rede), leem o seu `nuget.config` como XML e rodam as regras puras sobre dados em memória.

- `ProjectFile`: configurações de audit e lock file.
- `NuGetConfig`: fontes, idade, exceções e mapeamento.
- `PickLatest`, `CheckFloating`: as regras de idade.
- `Audit`: advisories para códigos de aviso.
- `VerifyLock`: verificações do restore locked.

**O que você vai fazer, passo a passo**

1. **Escrever o arquivo de projeto (TODO-00).** `NuGetAuditMode`, `NuGetAuditLevel`, as propriedades do lock file e `WarningsAsErrors` para `NU1901` a `NU1904`. A supressão é um item.
2. **Escrever o nuget.config (TODO-01).** `minPublishAgeHours` só nas fontes que têm idade, a seção de exceções sempre (mesmo vazia) e o source mapping.
3. **Escolher uma versão com idade (TODO-02).** A maior versão estável que atingiu a idade, limite inclusivo, comparada numericamente. Nada elegível devolve `null`.
4. **Rejeitar versões flutuantes (TODO-03).** `NU1020` quando há idade e o pacote não é exceção.
5. **Audit (TODO-04).** Casar por ID e versão, respeitar `direct` versus `all`, o nível mínimo e a supressão, e mapear a severidade para `NU1901` a `NU1904`.
6. **Verificar o lock (TODO-05).** `NU1004` quando o conjunto de dependências ou uma versão mudou, `NU1403` quando só um hash difere.

**Como você sabe que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `NuGetAuditSuppress` como propriedade não faz nada, por que o restore não impõe a idade e qual dos dois, `NU1004` ou `NU1403`, é o sinal de cadeia de suprimentos.

**Desafios opcionais**

- **TODO-06:** com o SDK do .NET 11, configure `--min-publish-age-hours 15000` no nuget.org numa pasta descartável e rode `dotnet package add Newtonsoft.Json`. Qual versão é escolhida, e qual seria sem a idade?
- **TODO-07:** restaure `Microsoft.EntityFrameworkCore` 8.0.0 com `NuGetAuditMode` `all` e depois `direct`, então fixe o pacote transitivo vulnerável com o Central Package Management e restaure de novo.

**Pré-requisitos:** C# e LINQ básicos, a ideia de `PackageReference`, `nuget.config` e `packages.lock.json`, e o .NET 10 SDK. Os desafios opcionais precisam do SDK do .NET 11 e do nuget.org.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Minimum package publish age, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/minimum-package-publish-age) (doc)
- [Auditing packages for security vulnerabilities, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) (doc)
- [Best practices for a secure software supply chain, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices) (doc)
- [Restore doesn't search the global packages folder for a higher package version, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/11/restore-global-packages-folder-version-search) (doc)
- [Package Source Mapping, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/package-source-mapping) (doc)
- [dotnet nuget verify, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-nuget-verify) (doc)
