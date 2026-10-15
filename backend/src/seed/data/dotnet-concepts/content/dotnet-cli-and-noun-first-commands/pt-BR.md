---
version: 1.0
updatedAt: 2026-10-15
title: "A CLI do dotnet e os Comandos Noun-First"
summary: Anatomia da CLI, os comandos noun-first do .NET 10 (e um bug visto no SDK 10.0.100), -p: e onde ele quebra, tools locais com manifesto, dotnet tool exec e dnx, dotnet watch com hot reload, --cli-schema e completions, tudo medido no SDK 10.0.100.
---
## Objective

Quase tudo da toolchain do .NET é acessível por um único executável, o
`dotnet`. A maioria dos desenvolvedores conhece cinco comandos e copia o resto
de blog posts. Este conceito explica o formato da CLI (driver, comando,
argumentos, opções), os comandos noun-first que o .NET 10 trouxe
(`dotnet package add`, `dotnet reference add`), incluindo um bug visto no SDK
10.0.100, como o `-p:` passa propriedades do MSBuild e onde isso quebra, como as
tools são instaladas, fixadas num manifesto e executadas sem instalar
(`dotnet tool exec`, `dnx`), e o que o hot reload do `dotnet watch` realmente
faz. Tudo foi executado no SDK 10.0.100 em macOS; as afirmações de versão vêm
das páginas oficiais do SDK.

## Use Cases

- Escrever scripts de CI legíveis e que sobrevivam ao próximo SDK.
- Fixar ferramentas de desenvolvimento (`dotnet-ef`, formatadores) por
  repositório, para todas as máquinas rodarem a mesma versão.
- Rodar uma tool pontual num pipeline sem deixá-la instalada.
- Iterar no código com `dotnet watch` em vez de parar, compilar e rodar.

## Deep Dive

### Anatomia: driver, comando, argumentos, opções

O `dotnet` é um driver com dois trabalhos: rodar um app dependente de framework
(`dotnet app.dll`) ou executar um comando do SDK (`dotnet build`). Antes de
executar o comando, o driver escolhe o SDK: o mais recente instalado, ou o que o
`global.json` selecionar (veja o conceito do ciclo de suporte). Por isso
`dotnet build` se comporta diferente em duas pastas da mesma máquina. O que vem
depois do comando é argumento (`dotnet publish app.csproj`) ou opção
(`--output`). `dotnet <comando> -h` sempre mostra a sintaxe real do SDK
instalado, mais confiável que uma página web de outra versão.

### Comandos noun-first

O .NET 10 adicionou aliases para que os comandos de pacote e referência comecem
pelo substantivo: `dotnet package add|list|remove` no lugar de
`dotnet add|list|remove package`, e `dotnet reference add|list|remove` para as
formas de `reference`. A documentação diz que as formas verb-first continuam
funcionando e recomenda as novas em scripts. No SDK 10.0.100 o help também lista
`dotnet package search` e `dotnet package update`; o `package update` é
documentado como parte do SDK do .NET 10, e o `package download` como 10.0.2xx
em diante, e por isso ele não aparece no help do 10.0.100 aqui:

```text
$ dotnet package add Humanizer.Core --version 2.14.1
$ dotnet package add Newtonsoft.Json              # resolve a última: 13.0.4
$ dotnet package update
    Updating Humanizer.Core 2.14.1 to 3.0.10.     # salto de versão major
$ dotnet package list --outdated
   > Newtonsoft.Json      13.0.3      13.0.3     13.0.4
```

Repare que um `dotnet package update` sem argumentos levou um pacote da 2.x para
a 3.x. A documentação diz que, sem versão, ele busca "a maior versão
disponível"; revise o diff como qualquer mudança de dependência. O
`--vulnerable` limita a atualização a pacotes com advisories conhecidos.

Uma coisa não funcionou como documentado. No SDK 10.0.100, `dotnet reference add
../lib/lib.csproj` falhou com `Could not find project or directory ``.` (o mesmo
para `dotnet reference remove`), enquanto o verb-first `dotnet add reference` e
a forma noun-first com projeto explícito funcionaram:

```text
$ dotnet reference add ../lib/lib.csproj
Could not find project or directory ``.
$ dotnet reference add --project app.csproj ../lib/lib.csproj
Reference `..\lib\lib.csproj` added to the project.
$ dotnet reference list        # aqui não precisou de --project
../lib/lib.csproj
```

O `dotnet package add` achou o projeto da pasta atual sem `--project`. Só
reproduzi isso no 10.0.100; confira num SDK mais novo antes de assumir que
continua assim. É um bom motivo para manter os scripts de CI em uma versão de
SDK fixa.

Em file-based apps os mesmos comandos aceitam `--file`: `dotnet package add
Humanizer.Core@2.14.1 --file s.cs` inseriu `#:package Humanizer.Core@2.14.1` no
topo de `s.cs`. Ele também gravou um BOM UTF-8 (bytes `ef bb bf`), o que importa
porque a documentação pede arquivos sem BOM quando há shebang.

### Propriedades com -p:

`-p:Nome=Valor` passa uma propriedade do MSBuild para `build`, `run`,
`publish`, `test`. `dotnet build -p:Configuration=Release -p:Version=1.2.3
-getProperty:Version` imprimiu `1.2.3`: a linha de comando sobrescreve o arquivo
de projeto, e o `-getProperty` é a forma barata de ver o que o MSBuild avaliou.
O exemplo do livro de sobrescrever o target framework é onde isso morde.
`dotnet build -p:TargetFramework=net9.0` falhou com `NETSDK1005: Assets file ...
doesn't have a target for 'net9.0'`, e o mesmo aconteceu com `dotnet build -f
net9.0` num projeto que só declara `net10.0`. O restore implícito não restaurou
para `net9.0`; a sequência que funcionou foi:

```text
$ dotnet restore -p:TargetFramework=net9.0
$ dotnet build --no-restore -p:TargetFramework=net9.0    # app -> bin/Debug/net9.0/app.dll
```

Trate uma sobrescrita que muda o grafo de dependências como operação em dois
passos, e coloque escolhas permanentes no arquivo de projeto ou no
`Directory.Build.props`.

### Tools: manifesto, run, exec, dnx

Uma tool local vive num manifesto. `dotnet new tool-manifest` cria
`.config/dotnet-tools.json`; `dotnet tool install dotnetsay` adiciona uma
entrada com a versão resolvida (3.0.3 aqui), e `dotnet tool run dotnetsay` ou
`dotnet dotnetsay` a executa. Versione o manifesto e `dotnet tool restore`
reproduz o conjunto em outra máquina; a instalação global (`-g`) é por usuário e
invisível para o repositório.

O .NET 10 trouxe a execução pontual: `dotnet tool exec <pacote>[@versão] --
<args>` baixa o pacote para o cache do NuGet e o executa sem instalar nada.
Depois de rodar, `dotnet tool list` estava vazio. Ele pergunta antes de baixar e,
num shell não interativo, se recusa:

```text
$ echo y | dotnet tool exec dotnetsay@2.1.7 -- hello
Tool package download needs confirmation. Run in interactive mode or use the "--yes" command-line option to confirm.
$ dotnet tool exec --yes dotnetsay@2.1.7 -- hello      # roda
```

A página de referência diz que o `--yes` existe a partir do .NET 11, mas ele
funcionou e aparece no help do SDK 10.0.100; confie no help instalado mais que
na página. O `dnx` é um shell script ao lado do `dotnet` que só executa
`dotnet dnx "$@"`, um alias de `tool exec`, então `dnx dotnetsay@2.1.7 --yes --
hi` é a forma curta. Se houver um manifesto perto da pasta atual, a versão
fixada vence: com o `dotnetsay` fixado em 2.1.7 num manifesto, `dotnet tool exec
--yes dotnetsay` produziu saída idêntica byte a byte à de `dotnetsay@2.1.7` (e
diferente da última versão numa pasta sem manifesto).

### dotnet watch e hot reload

O `dotnet watch` recompila e reinicia quando arquivos mudam e, para edições
suportadas, aplica a mudança no processo em execução em vez de reiniciar. Num
console app que imprime `tick v1` a cada segundo, trocar o literal para `"v2"`
produziu:

```text
dotnet watch ⌚ Files updated: ./Program.cs
dotnet watch 🔥 [watch (net10.0)] Hot reload succeeded.
tick v2
```

O loop nunca reiniciou. Edições que o runtime não consegue aplicar (a
documentação fala em "supported edits") caem num restart, que não exercitei.

### Introspecção e shells

O `--cli-schema` imprime a definição de um comando em JSON. `dotnet build
--cli-schema` listou 34 opções, e `dotnet package add --cli-schema` mostrou a
opção `--file` descrita acima. No `dotnet --cli-schema` puro este SDK imprimiu um
erro sem relação ("shell application 'zsh' is not supported"), então use-o num
comando. `dotnet completions script zsh` gera um script de completion nativo
(bash, fish, nushell, powershell e zsh são documentados). A documentação também
diz que os comandos são interativos por padrão em terminais interativos; passe
`--interactive false` em pipelines.

## Trade-offs

- **Noun-first lê melhor, verb-first é mais seguro hoje.** As duas funcionam,
  mas a falha do `reference add` no 10.0.100 mostra que superfície nova traz
  bugs novos.
  ```text
  dotnet add reference ../lib/lib.csproj    # funcionou onde dotnet reference add falhou
  ```
- **`-p:` é rápido e fácil de usar errado.** Ele sobrescreve o arquivo em
  silêncio, e tudo que muda o restore precisa de um restore próprio.
- **`tool exec` troca reprodutibilidade por conveniência.** Sem manifesto ele
  pega a última versão do momento; fixe a versão (`pkg@1.2.3`) ou use um
  manifesto no CI.
- **Hot reload esconde reinícios.** Mudanças de estado que exigem restart
  parecem boas até você reiniciar; mantenha uma execução limpa no seu ciclo de
  testes.
- **A CLI é o contrato, a página é uma cópia.** As páginas atrasam em relação
  às faixas do SDK (`--yes`, `package download`); `dotnet <comando> -h` no SDK
  fixado é a verdade.

## Documentation Links

- [.NET CLI overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/) (doc)
- [What's new in the SDK and tooling for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/sdk) (doc)
- [dotnet tool exec, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-exec) (doc)
- [dotnet package update, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-update) (doc)
- [dotnet package download, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-download) (doc)
- [dotnet watch, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-watch) (doc)
- [.NET tools overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/global-tools) (doc)
