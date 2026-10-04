---
version: 1.0
updatedAt: 2026-09-06
title: "Listas de Controle de Acesso e Permissões Unix"
summary: "Uma lista de controle de acesso anexa a cada objeto a lista exata de sujeitos autorizados a tocá-lo e como: os bits de permissão de leitura/escrita/execução do Unix são uma versão deliberadamente simplificada e de três grupos dessa ideia, e o mecanismo concreto que o SO usa para impor as políticas de autorização já discutidas de forma abstrata em outros lugares."
---
## Objetivos de Aprendizagem

- Definir uma lista de controle de acesso (ACL) como uma resposta centrada no objeto para "quem pode fazer o quê com este objeto", expressa como uma lista anexada ao próprio objeto.
- Explicar os bits de permissão de leitura/escrita/execução do Unix como uma ACL deliberadamente simplificada de três grupos, e precisamente o que cada bit significa para um arquivo versus para um diretório.
- Descrever o modelo de imposição de "verificar a cada acesso, não apenas uma vez" do qual uma ACL depende, e conectá-lo à validação na fronteira do kernel já abordada anteriormente nesta disciplina.
- Distinguir a imposição de autorização (o tema deste conceito) da teoria de autenticação e autorização já abordada em `security-cryptography`, enquadrando este conceito como o mecanismo concreto do SO do qual essa teoria depende.

## Contexto e Motivação

O agrupamento de virtualização desta disciplina mostrou como o kernel pode dar a um processo uma *visão* restrita da máquina. Este agrupamento final volta-se para uma questão relacionada mas distinta: dado um processo que consegue ver um determinado arquivo, dispositivo ou outro objeto gerenciado pelo kernel, o que de fato decide se ele está *autorizado* a ler, escrever ou atuar de outra forma sobre esse objeto, e como essa decisão é de fato imposta, mecanicamente, pelo kernel, a cada vez que o processo tenta um acesso?

`security-cryptography` já desenvolveu a autenticação (provar quem você é) e a autorização (decidir o que você pode fazer) como conceitos gerais de segurança, e as distinguiu cuidadosamente uma da outra. Este conceito retoma especificamente de onde essa teoria para: a lista de controle de acesso é a estrutura de dados concreta que sistemas operacionais reais anexam a objetos para codificar uma política de autorização, e os bits de permissão do Unix são a instância específica, deliberadamente mínima, dessa ideia que aparece em todo arquivo, diretório e dispositivo de tipo Unix que o conceito anterior de sistema de arquivos desta disciplina já apresentou.

## Teoria Central

### A lista de controle de acesso: uma política anexada ao objeto, não ao sujeito

Uma lista de controle de acesso é, conceitualmente, exatamente o que seu nome sugere: uma lista, anexada a um objeto específico, nomeando quais sujeitos (usuários, ou mais geralmente, princípios de segurança) podem realizar quais operações sobre esse objeto. Esta é uma forma *centrada no objeto* de expressar uma política de autorização: para responder "a Alice pode ler este arquivo", o kernel consulta a ACL do próprio arquivo e verifica se Alice (ou um grupo ao qual Alice pertence) aparece nela com permissão de leitura, em oposição a uma abordagem *centrada no sujeito* (perguntar "o que a Alice pode fazer", consultando uma lista anexada a Alice em vez de ao objeto), que o próximo conceito, segurança baseada em capacidades, desenvolve como um modelo genuinamente diferente.

### Bits de permissão Unix: uma ACL real e deliberadamente mínima

Os sistemas Unix e de tipo Unix (Linux, macOS, BSD) implementam a autorização com uma simplificação específica, extremamente difundida, da ideia geral de ACL: cada arquivo ou diretório carrega exatamente três trincas de permissão, uma para seu usuário dono, uma para seu grupo dono e uma para todos os outros, cada trinca feita de exatamente três bits: leitura, escrita e execução. Esta é uma ACL real, só que com um conjunto fixo e deliberadamente pequeno de "entradas" possíveis (dono, grupo, outros) em vez de uma lista arbitrariamente longa nomeando usuários individuais, uma escolha de projeto que troca expressividade (uma ACL completa pode nomear arbitrariamente muitos sujeitos individuais) por simplicidade e compacidade (nove bits, armazenados diretamente junto aos outros metadados do arquivo, respondem à vasta maioria das perguntas reais de autorização que um sistema Unix precisa responder).

O significado de cada bit difere de uma forma genuinamente importante entre um arquivo comum e um diretório, uma distinção que confunde muitos aprendizes precisamente porque os nomes dos bits (leitura, escrita, execução) soam como se devessem significar a mesma coisa em ambos os casos, mas não significam:

```text
Bit de permissão   Em um arquivo comum                Em um diretório
----------------  --------------------------------  --------------------------------------
leitura (r)       Pode ler o conteúdo do arquivo     Pode LISTAR as entradas do diretório
escrita (w)       Pode modificar o conteúdo          Pode CRIAR/EXCLUIR entradas dentro dele
execução (x)      Pode executar o arquivo como       Pode ENTRAR no diretório (fazer cd nele,
                  programa                             ou acessar arquivos dentro pelo nome)
```

Um diretório com permissão de leitura mas não de execução, por exemplo, permite listar os nomes de arquivos dentro dele mas não acessar de fato nenhum arquivo por esse nome, uma consequência real, por vezes surpreendente, do que "execução" significa concretamente para um diretório em vez de um arquivo comum.

### Imposição: verificada a cada acesso, na fronteira do kernel

Uma ACL (ou os bits de permissão do Unix) só é significativa se for de fato verificada, de modo confiável, a cada vez que um processo tenta um acesso, e essa verificação acontece exatamente na mesma fronteira do kernel que os conceitos anteriores desta disciplina já estabeleceram como a única porta de entrada entre o código em modo usuário e qualquer recurso mediado pelo kernel. Quando um processo chama `open()` em um arquivo, o código de sistema de arquivos do kernel (já abordado em `operating-systems-i`) compara a identidade de usuário e grupo do processo chamador com o dono, o grupo e os bits de permissão do arquivo, antes de retornar um descritor de arquivo válido, precisamente a mesma disciplina de "nunca confiar, sempre validar na fronteira" que o conceito anterior de validação na fronteira do kernel desta disciplina já estabeleceu, agora aplicada a uma decisão de autorização em vez de à validade de um ponteiro bruto.

```mermaid
flowchart TB
    A["Processo chama open(\"secret.txt\", O_RDWR)"] --> B{"Kernel verifica:\no uid/gid do processo\nchamador casa com os bits de\npermissão de dono/grupo do arquivo?"}
    B -->|Permissão negada| C["open() falha,\nretorna -EACCES"]
    B -->|Permitido| D["open() tem sucesso,\nretorna um descritor de arquivo válido"]
```

### Onde a teoria de autorização termina e o mecanismo deste conceito começa

`security-cryptography` estabeleceu a autorização como um conceito geral: decidir o que um sujeito já autenticado pode fazer. Este conceito é a maquinaria concreta que um sistema operacional real usa para tomar essa decisão para o caso específico, extremamente comum, de "este processo pode acessar este arquivo, diretório ou dispositivo": a ACL como estrutura de dados, os bits de permissão do Unix como sua instância simplificada amplamente difundida, e o próprio código de sistema de arquivos do kernel como o ponto de imposição que a consulta a cada tentativa de acesso, nunca apenas uma vez no momento do login.

## Exemplos Resolvidos

### Exemplo 1: Lendo bits de permissão Unix, concretamente

```text
Listagem de arquivo: -rw-r--r-- 1 alice staff  1024 report.txt

Decodificado:
  -            arquivo comum (não um diretório)
  rw-          dono (alice): leitura + escrita, não execução
  r--          grupo (staff): só leitura
  r--          outros (todos os demais): só leitura

Concretamente: alice pode ler e modificar report.txt; qualquer um no
grupo staff pode lê-lo mas não modificá-lo; todos os demais também podem
lê-lo mas não modificá-lo; ninguém além de alice pode executá-lo como
programa (o que é apropriado aqui, já que é um relatório de texto, não
um executável).
```

### Exemplo 2: A distinção de bit de permissão de diretório, tornada concreta

```text
Diretório: drwxr-x---  alice  staff  reports/

Decodificado: dono (alice) tem rwx; grupo (staff) tem r-x; outros tem ---.

Um membro de "staff" que NÃO é alice:
  Pode LISTAR o conteúdo de reports/ (tem leitura no diretório)
  Pode ENTRAR em reports/ e acessar arquivos dentro dele PELO NOME
    (tem execução no diretório)
  NÃO PODE criar ou excluir arquivos dentro de reports/
    (não tem escrita no diretório)

Um usuário em nenhum de alice ou staff:
  Não pode listar, entrar ou acessar nada dentro de reports/ de forma alguma
    (nenhum bit de permissão definido para "outros")
```

### Exemplo 3: A verificação exata do kernel, rastreada através de uma chamada `open()` real

```text
Processo (uid=1002, gid=20) chama: open("secret.txt", O_WRONLY)

Metadados do arquivo: dono uid=1001, grupo dono gid=20,
                  bits de permissão rw-r-----

Verificação do kernel:
  O uid chamador (1002) == uid do dono (1001)?  Não.
  O gid chamador (20) == gid do dono (20)?      Sim -> usar bits de GRUPO.
  Bits de grupo: r-- (só leitura, sem escrita)
  Acesso solicitado: O_WRONLY (escrita)

Resultado: PERMISSÃO NEGADA (-EACCES) -- o processo chamador está no
grupo certo, mas esse grupo só tem permissão de leitura, não de escrita,
então o open() em modo de escrita falha mesmo que o arquivo SEJA legível
para este mesmo processo.
```

## Equívocos Comuns e Armadilhas

- **"Bits de permissão Unix e listas de controle de acesso são dois mecanismos de autorização não relacionados."** Os bits de permissão Unix SÃO uma lista de controle de acesso, uma real e deliberadamente mínima, com exatamente três entradas fixas (dono, grupo, outros) em vez de uma lista arbitrária de sujeitos nomeados individualmente, mas estruturalmente a mesma ideia centrada no objeto de "quem pode fazer o quê com este objeto".
- **"Permissão de leitura e execução significam a mesma coisa para um diretório que significam para um arquivo comum."** Para um diretório, a permissão de leitura significa listar suas entradas, e a permissão de execução significa poder entrar nele ou acessar arquivos dentro dele pelo nome, significados genuinamente diferentes de "ler os bytes do arquivo" e "rodar o arquivo como programa", uma distinção que causa confusão real e comum.
- **"Uma vez que um processo abre um arquivo com sucesso, a permissão não é mais relevante para aquele descritor de arquivo."** A verificação de permissão relevante acontece no momento do `open()` para aquele modo de acesso específico; um processo que mantém um descritor de arquivo aberto não precisa ser reverificado a cada leitura/escrita subsequente sobre aquele mesmo descritor, mas uma NOVA tentativa de acesso (uma chamada `open()` nova) é verificada novamente, de forma independente, contra os bits de permissão atuais do arquivo.
- **"Listas de controle de acesso são apenas uma ideia específica do Unix, sem base teórica mais ampla."** O modelo de ACL centrado no objeto de "quem pode fazer o quê" é um conceito geral que aparece em muitos sistemas reais (as ACLs do Windows são consideravelmente mais ricas que a simplificação de três grupos do Unix, por exemplo), a implementação específica de nove bits do Unix é uma instância deliberadamente mínima e extremamente difundida de uma ideia mais ampla.

## Resumo

Uma lista de controle de acesso anexa, a cada objeto, uma política nomeando quais sujeitos podem realizar quais operações sobre ele, uma resposta centrada no objeto à questão de autorização que `security-cryptography` já apresentou de forma abstrata. Os bits de permissão de leitura/escrita/execução do Unix são uma ACL real e deliberadamente mínima, com exatamente três entradas fixas (dono, grupo, outros) em vez de uma lista arbitrária por sujeito, e um significado para cada bit que difere de uma forma genuinamente importante entre arquivos comuns (ler o conteúdo, modificar o conteúdo, executar como programa) e diretórios (listar entradas, criar/excluir entradas, entrar no diretório ou acessar arquivos pelo nome). Essa política é imposta exatamente na fronteira do kernel que os conceitos anteriores desta disciplina já estabeleceram como a única porta de entrada para recursos mediados pelo kernel, verificada de forma nova a cada nova tentativa de acesso em vez de apenas uma vez, a resposta concreta e mecânica a uma questão que a teoria de autorização de `security-cryptography` deixou em aberto: como, precisamente, um sistema operacional decide e impõe quem pode fazer o quê com um dado arquivo. O próximo conceito desenvolve um modelo genuinamente diferente para a mesma questão subjacente.

## Documentation Links

- [OSTEP: Access Control](https://pages.cs.wisc.edu/~remzi/OSTEP/security-access.pdf): o modelo de ACL e a mecânica dos bits de permissão Unix que este conceito desenvolve em detalhe.
- [ACM/IEEE CS2013: Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/): situa o controle de acesso como um tópico central de Sistemas Operacionais dentro do currículo mais amplo.
